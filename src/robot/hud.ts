// Robot Mode's HUD: live-policy badge, the active mode, measured rates, joint telemetry, the
// bundle's own controls as buttons, and the provenance notice the bundle asks a host to show.
import './hud.css';
import type { ClassId, CrabSpec, RaceId } from '../crab/types';
import { CLASSES, CLASS_ORDER } from '../data/classes';
import { RACES, RACE_ORDER } from '../data/races';
import { h } from '../ui/dom';
import type { Binding, FrameMsg, ReadyInfo } from './protocol';

export const MODE_LABEL: Record<string, string> = {
  locomotion: 'Walk',
  jump: 'Jump',
  dance_crab: 'Crab Dance',
  dance_brazilian: 'Brazilian',
  dance_maze: 'Maze',
  dance_dream_wings: 'Dream Wings',
  gesture_hello: 'Hello',
  gesture_bow: 'Bow',
  gesture_paw: 'Paw',
  gesture_salute: 'Salute',
  claw_left: 'Left Claw',
  claw_right: 'Right Claw',
  skill_swipe: 'Swipe',
  skill_slam: 'Slam',
  skill_cast: 'Cast',
  skill_flinch: 'Flinch',
  skill_powerdown: 'Power Down',
  skill_sit: 'Sit',
  break_toprock: 'Toprock',
  break_sixstep: 'Six-step',
  break_clawstand: 'Claw Stand',
  break_oneclaw: 'One Claw',
  power_spin: 'Spin',
  safe: 'Safe Hold',
};

const KEY_LABEL: Record<string, string> = {
  key_space: 'Space', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', key_escape: 'Esc',
};
const keyLabel = (k: string): string => KEY_LABEL[k] ?? k.replace(/^key(pad)?_/, '').toUpperCase();

/** A choice from the crab picker (shown when the player has no saved crab). */
export interface CrabPick {
  race?: RaceId;
  classId?: ClassId;
  random?: boolean;
}

/** What the appearance card shows. */
export interface AppearanceState {
  kind: 'bare' | 'crab';
  /** The crab the crab layer wears (or is being dressed in). */
  spec: CrabSpec | null;
  /** `spec` is the player's own crab from character creation. */
  own: boolean;
  loading: boolean;
  xray: boolean;
}

export interface HudActions {
  request(mode: string): void;
  release(): void;
  reset(): void;
  toggleFollow(): boolean;
  toggleSlow(): boolean;
  /** Appearance card: bare robot or crab, the picker, and the x-ray overlay. */
  appearance?(kind: 'bare' | 'crab'): void;
  pickCrab?(pick: CrabPick): void;
  toggleXray?(): boolean;
  back?: () => void;
}

interface DockButton {
  mode: string;
  el: HTMLButtonElement;
  binding: Binding | undefined;
}

export class Hud {
  readonly root: HTMLElement;
  private loading: HTMLElement;
  private loadBar: HTMLElement;
  private loadLabel: HTMLElement;
  private loadBytes: HTMLElement;
  private loadErr: HTMLElement;
  private badge!: HTMLElement;
  private modeName!: HTMLElement;
  private modeState!: HTMLElement;
  private progressEl!: HTMLElement;
  private cmd: Record<string, HTMLElement> = {};
  private stat: Record<string, HTMLElement> = {};
  private joints: { q: HTMLElement; tg: HTMLElement; tq: HTMLElement; lo: number; hi: number }[] = [];
  private log!: HTMLElement;
  private dock: DockButton[] = [];
  private stopBtn!: HTMLButtonElement;
  private dockFit: ResizeObserver | null = null;
  private info: ReadyInfo | null = null;
  private lastMode = '';
  private lastRunning = false;
  private pending: { mode: string; until: number } | null = null;
  private lastText = new Map<HTMLElement, string>();
  private tAcc = 0;
  private followBtn: HTMLElement | null = null;
  private digestLine: HTMLElement | null = null;
  private look: {
    root: HTMLElement;
    seg: Record<'bare' | 'crab', HTMLButtonElement>;
    who: HTMLElement;
    pick: HTMLElement;
    races: Map<RaceId, HTMLButtonElement>;
    classes: Map<ClassId, HTMLButtonElement>;
    xray: HTMLButtonElement;
  } | null = null;
  private lookState: AppearanceState | null = null;

  constructor(parent: HTMLElement, private readonly actions: HudActions) {
    this.loadBar = h('div');
    this.loadLabel = h('span', null, 'Fetching the bundle');
    this.loadBytes = h('span', { class: 'num' }, '');
    this.loadErr = h('div', { class: 'err' });
    this.loading = h(
      'div',
      { class: 'rm-loading' },
      h(
        'div',
        { class: 'box' },
        h('div', { class: 'eyes' }, h('i'), h('i')),
        h('div', { class: 't1' }, 'Waking the robot'),
        h(
          'div',
          { class: 't2' },
          'Loading the files a real Jumper loads: its controller, the trained policy for every mode and the physics model they learned in.',
        ),
        h('div', { class: 'bar' }, this.loadBar),
        h('div', { class: 'meta' }, this.loadLabel, this.loadBytes),
        this.loadErr,
      ),
    );
    this.root = h('div', { class: 'rm' }, this.loading);
    parent.append(this.root);
  }

  progress(loaded: number, total: number, label: string): void {
    const p = total > 0 ? Math.min(1, loaded / total) : 0;
    this.loadBar.style.width = `${(p * 100).toFixed(1)}%`;
    this.loadLabel.textContent = label;
    this.loadBytes.textContent = `${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
  }

  error(message: string): void {
    this.loadErr.textContent = `Robot Mode could not start.\n${message}`;
    this.loadErr.classList.add('on');
    (this.loading.querySelector('.t1') as HTMLElement).textContent = 'The robot did not wake up';
  }

  /** Builds the live HUD once the worker is ready. */
  ready(info: ReadyInfo): void {
    this.info = info;
    const r = this.root;

    // Brand.
    this.badge = h('span', { class: 'rm-badge live' }, h('i'), 'Live policy');
    r.append(
      h(
        'div',
        { class: 'rm-brand' },
        h('div', { class: 'rm-eyebrow' }, 'Robot Mode'),
        h('div', { class: 'rm-title' }, 'The real robot, ', h('b', null, 'live.')),
        h(
          'div',
          { class: 'rm-sub' },
          'The same controller, policies and physics model a physical Jumper runs, in your browser. Nothing here is an animation.',
        ),
        h(
          'div',
          { class: 'rm-badges' },
          this.badge,
          h('span', { class: 'rm-badge' }, `MuJoCo ${info.mujocoVersion} WASM`),
          h('span', { class: 'rm-badge' }, `ONNX Runtime Web ${info.ortVersion}`),
        ),
      ),
    );

    // Mode card.
    this.modeName = h('div', { class: 'name' }, 'Walk');
    this.modeState = h('div', { class: 'state' });
    this.progressEl = h('div', { class: 'rm-progress' }, h('div'));
    const cmdCell = (k: string, label: string) => {
      this.cmd[k] = h('div', { class: 'v' }, '0');
      return h('div', null, this.cmd[k], h('div', { class: 'l' }, label));
    };
    r.append(
      h(
        'div',
        { class: 'rm-mode rm-panel' },
        h('div', { class: 'k' }, 'Active mode'),
        this.modeName,
        this.modeState,
        this.progressEl,
        h('div', { class: 'rm-cmd' }, cmdCell('speed', 'm/s'), cmdCell('height', 'height mm'), cmdCell('tilt', 'tilt deg')),
      ),
    );

    // Telemetry.
    const stat = (k: string, label: string, cls = '') => {
      this.stat[k] = h('div', { class: 'v' }, '0');
      return h('div', { class: `rm-stat ${cls}` }, this.stat[k], h('div', { class: 'l' }, label));
    };
    const legs = h('div', { class: 'rm-legs' });
    const groups: Record<string, number[]> = {};
    info.joints.forEach((j, i) => (groups[j.slice(0, 2)] ??= []).push(i));
    const legName: Record<string, string> = { LF: 'Left claw', RF: 'Right claw', LM: 'Left mid', RM: 'Right mid', LR: 'Left rear', RR: 'Right rear' };
    for (const [leg, idx] of Object.entries(groups)) {
      const box = h('div', { class: 'rm-leg' }, h('div', { class: 't' }, leg, h('span', null, legName[leg] ?? '')));
      for (const i of idx) {
        const [lo, hi] = info.jointRanges[i];
        const q = h('div', { class: 'q' });
        const tg = h('div', { class: 'tg' });
        const tq = h('div', { class: 'tq' });
        const home = h('div', { class: 'home' });
        home.style.left = `${((0 - lo) / (hi - lo)) * 100}%`;
        box.append(h('div', { class: 'rm-joint', title: info.joints[i] }, tq, home, tg, q));
        this.joints[i] = { q, tg, tq, lo, hi };
      }
      legs.append(box);
    }
    r.append(
      h(
        'div',
        { class: 'rm-tele rm-panel' },
        h('h4', null, 'Telemetry', h('span', { class: 'num' }, '22 joints')),
        h(
          'div',
          { class: 'rm-stats' },
          stat('rate', 'Control rate: policy inferences per second, measured live', 'hero'),
          stat('infer', 'Policy inference (onnxruntime-web)'),
          stat('phys', 'Physics step, MuJoCo WASM'),
          stat('ratio', 'Sim time / real time'),
          stat('dt', 'Substeps per control tick'),
        ),
        legs,
        h(
          'div',
          { class: 'rm-legend' },
          h('span', null, h('i', { style: 'background:#fff' }), 'angle'),
          h('span', null, h('i', { style: 'background:#53f2e4' }), 'target'),
          h('span', null, h('i', { style: 'background:#ff4a57' }), 'torque'),
        ),
      ),
    );

    // Tools.
    const follow = h('button', { class: 'rm-tool on', tabindex: '-1' }, 'Follow cam');
    follow.onclick = () => follow.classList.toggle('on', this.actions.toggleFollow());
    this.followBtn = follow;
    const slow = h('button', { class: 'rm-tool', tabindex: '-1' }, 'Slow motion');
    slow.onclick = () => slow.classList.toggle('on', this.actions.toggleSlow());
    const reset = h('button', { class: 'rm-tool', tabindex: '-1' }, 'Reset');
    reset.onclick = () => this.actions.reset();
    const tools = h('div', { class: 'rm-tools' }, follow, slow, reset);
    if (this.actions.back) {
      const back = h('button', { class: 'rm-tool back', tabindex: '-1' }, 'Back to Title');
      back.onclick = () => this.actions.back?.();
      tools.append(back);
    }
    r.append(tools);

    // Dock: the bundle's own mode switches, labelled with the keys its FSM binds.
    const binding = (mode: string) => info.bindings.find((b) => b.name === mode && b.key && !/^keypad_/.test(b.key));
    const btn = (mode: string, label: string) => {
      const b = binding(mode);
      const kb = b ? `${b.with ? `${keyLabel(b.with)}+` : ''}${keyLabel(b.key!)}` : '';
      const el = h('button', { class: 'rm-btn', tabindex: '-1', title: mode }, label, h('span', { class: 'kb' }, kb));
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.onclick = () => {
        // Pressing the active mode's button again ends it, as its own toggle would.
        if (this.lastMode === mode) return this.actions.release();
        this.pending = { mode, until: performance.now() + 2500 };
        this.actions.request(mode);
      };
      this.dock.push({ mode, el, binding: b });
      if (!info.policiesReady.includes(mode)) el.classList.add('loading');
      return el;
    };
    this.stopBtn = h('button', { class: 'rm-btn', tabindex: '-1' }, 'Walk', h('span', { class: 'kb' }, 'WASD'));
    this.stopBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.stopBtn.onclick = () => this.actions.release();
    const group = (label: string, ...els: HTMLElement[]) =>
      h('div', { class: 'rm-group' }, h('div', { class: 'gl' }, label), h('div', { class: 'row' }, ...els));
    const has = (m: string) => info.modes.includes(m);
    const dock = h('div', { class: 'rm-dock rm-panel' });
    dock.append(group('Move', this.stopBtn, ...(has('jump') ? [btn('jump', 'Jump')] : [])));
    const dances = ['dance_crab', 'dance_brazilian', 'dance_maze', 'dance_dream_wings'].filter(has);
    if (dances.length) dock.append(group('Dances', ...dances.map((m) => btn(m, MODE_LABEL[m]))));
    const gestures = ['gesture_hello', 'gesture_bow', 'gesture_paw', 'gesture_salute'].filter(has);
    if (gestures.length) dock.append(group('Gestures', ...gestures.map((m) => btn(m, MODE_LABEL[m]))));
    // The six skills trained for this game (jumper.skill_*), the same moves the RPG plays.
    const skills = ['skill_swipe', 'skill_slam', 'skill_cast', 'skill_flinch', 'skill_powerdown', 'skill_sit'].filter(has);
    if (skills.length) dock.append(group('Skills', ...skills.map((m) => btn(m, MODE_LABEL[m]))));
    // The game's breakdance, the moves the bundle can run: the four tracked ones (jumper.break_*)
    // and the spin. The 720 and the back flip are recordings in the game only: neither policy
    // takes off from a robot a mode switch has stood at HOME, so they are not modes here.
    const breaks = ['break_toprock', 'break_sixstep', 'break_clawstand', 'break_oneclaw', 'power_spin'].filter(has);
    if (breaks.length) dock.append(group('Breaking', ...breaks.map((m) => btn(m, MODE_LABEL[m]))));
    const claws = ['claw_left', 'claw_right'].filter(has);
    if (claws.length) dock.append(group('Claw', ...claws.map((m) => btn(m, m === 'claw_left' ? 'Left' : 'Right'))));
    r.append(dock);
    // With the skills the dock takes two rows; the help line and the appearance card sit above
    // whatever height it has (hud.css, --rm-dock-h).
    this.dockFit = new ResizeObserver(() => r.style.setProperty('--rm-dock-h', `${dock.offsetHeight}px`));
    this.dockFit.observe(dock);
    const kbd = (k: string, t: string) => h('span', null, h('kbd', null, k), t);
    r.append(
      h(
        'div',
        { class: 'rm-help' },
        kbd('WASD', 'walk and strafe'),
        kbd('Q E', 'turn'),
        kbd('N M', 'body height'),
        kbd('Ctrl', 'end a motion'),
        ...(has('power_spin') ? [kbd('Shift+5', 'spin, again to stop')] : []),
        kbd('Esc', 'let go'),
        ...(this.actions.appearance ? [kbd('T', 'robot or crab')] : []),
        kbd('Drag', 'orbit'),
      ),
    );

    // Log.
    this.log = h('div', { class: 'rm-log' });
    r.append(this.log);

    if (this.actions.appearance) r.append(this.buildLook());

    // Provenance notice. The bundle asks a consumer running its controller to say so where the
    // person can see it (bundle.json runtimes.web.unverifiedByTheConsumer).
    const checks = h('div', { class: 'checks' });
    const ok = (good: boolean, text: string) => checks.append(h('div', { class: good ? 'ok' : 'bad' }, text));
    if (info.reference) {
      const rr = info.reference;
      ok(rr.observation <= 1e-6 && rr.target <= 1e-6 && rr.modeMismatches === 0,
        `reference.json replay: ${rr.frames} frames, diff ${Math.max(rr.observation, rr.target)}`);
    }
    if (info.actDiff !== null) ok(info.actDiff < 1e-4, `policy outputs vs recorded actions: ${info.actDiff.toExponential(1)}`);
    if (info.digests) {
      ok(info.digests.mismatched.length === 0, `${info.digests.checked} bundle files match their SHA-256`);
      this.digestLine = checks.lastElementChild as HTMLElement;
    }
    r.append(
      h(
        'div',
        { class: 'rm-notice rm-panel' },
        h('div', { class: 'h' }, 'Unverified runtime'),
        h(
          'div',
          null,
          `This page runs the bundle's own controller.wasm (commit ${info.web.commit.slice(0, 7)}, ${info.web.wasmBindgen}). The bundle says:`,
        ),
        h('q', null, info.web.unverifiedByTheConsumer),
        checks,
        info.notes.length
          ? h(
              'details',
              { class: 'notes' },
              h('summary', null, `${info.notes.length} notes from the bundle`),
              h('ul', null, ...info.notes.map((n) => h('li', null, n))),
            )
          : null,
      ),
    );

    this.loading.classList.add('done');
  }

  /** Per render frame. `base` is the body speed/height/tilt measured on the page. */
  update(f: FrameMsg, kin: { speed: number; height: number; tilt: number }, dt: number): void {
    if (!this.info) return;
    const info = this.info;
    this.tAcc += dt;
    const mode = f.mode;
    if (mode !== this.lastMode || f.running !== this.lastRunning) {
      this.lastMode = mode;
      this.lastRunning = f.running;
      this.set(this.modeName, MODE_LABEL[mode] ?? mode);
      const hz = info.controlHz[mode];
      this.badge.className = `rm-badge ${f.running ? 'live' : 'hold'}`;
      this.badge.lastChild!.textContent = f.running ? 'Live policy' : mode === 'safe' ? 'Safe hold' : 'Mode switch';
      this.modeState.className = `state${f.running ? '' : ' ramp'}`;
      this.modeState.replaceChildren(
        ...(f.running
          ? ['Policy ', h('em', null, mode), ` running at ${hz ?? '?'} Hz`]
          : mode === 'safe'
            ? ['Damping only. ', h('em', null, 'Tilted or no feedback'), '.']
            : ['Ramping to ', h('em', null, `${mode}`), "'s home pose. The policy starts when the measured pose arrives."]),
      );
      for (const d of this.dock) {
        d.el.classList.toggle('on', d.mode === mode);
        const from = d.binding?.from;
        d.el.disabled = !!from && !from.includes(mode) && d.mode !== mode;
      }
      this.stopBtn.classList.toggle('on', mode === 'locomotion');
      if (this.pending && this.pending.mode === mode) this.pending = null;
    }
    for (const d of this.dock) d.el.classList.toggle('pending', !!this.pending && this.pending.mode === d.mode && performance.now() < this.pending.until);
    const dur = info.motionDuration[mode];
    this.progressEl.classList.toggle('on', f.motionLeft !== null && !!dur);
    if (f.motionLeft !== null && dur) {
      (this.progressEl.firstChild as HTMLElement).style.width = `${(100 * (1 - f.motionLeft / dur)).toFixed(1)}%`;
    }

    if (this.tAcc > 0.1) {
      this.tAcc = 0;
      const s = f.stats;
      this.setHtml(this.stat.rate, `${s.inferHz.toFixed(0)}<small>Hz</small>`);
      this.setHtml(this.stat.infer, `${s.inferMs.toFixed(3)}<small>ms</small>`);
      this.setHtml(this.stat.phys, `${s.physicsStepMs.toFixed(3)}<small>ms</small>`);
      this.setHtml(this.stat.ratio, `${s.ratio.toFixed(2)}<small>x</small>`);
      this.setHtml(this.stat.dt, `${s.substeps}<small>x ${(s.timestep * 1000).toFixed(1)} ms</small>`);
      this.set(this.cmd.speed, kin.speed.toFixed(2));
      this.set(this.cmd.height, (kin.height * 1000).toFixed(0));
      this.set(this.cmd.tilt, kin.tilt.toFixed(1));
    }
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i];
      const span = j.hi - j.lo;
      const pq = ((f.q[i] - j.lo) / span) * 100;
      const pt = ((f.target[i] - j.lo) / span) * 100;
      j.q.style.left = `${pq.toFixed(1)}%`;
      j.tg.style.left = `${pt.toFixed(1)}%`;
      const t = Math.min(1, Math.abs(f.tau[i]) / 1.7464);
      j.tq.style.left = `${Math.min(pq, pq + (f.tau[i] >= 0 ? 0 : -t * 30)).toFixed(1)}%`;
      j.tq.style.width = `${(t * 30).toFixed(1)}%`;
    }
    for (const tr of f.transitions) {
      const line = h('div', null, h('span', null, `${f.simTime.toFixed(1)}s `), h('b', null, `${tr.from} > ${tr.to}`), h('span', null, `  ${tr.why}`));
      this.log.append(line);
      while (this.log.childElementCount > 5) this.log.firstElementChild!.remove();
    }
  }

  /** A policy finished streaming in (or failed its digest). */
  policyReady(mode: string, ok: boolean, checked: number, mismatched: string[]): void {
    for (const d of this.dock) if (d.mode === mode) d.el.classList.toggle('loading', false);
    for (const d of this.dock) if (d.mode === mode && !ok) d.el.classList.add('failed');
    if (this.digestLine) {
      this.digestLine.textContent = `${checked} bundle files match their SHA-256`;
      this.digestLine.className = mismatched.length ? 'bad' : 'ok';
      if (mismatched.length) this.digestLine.textContent = `SHA-256 mismatch: ${mismatched.join(', ')}`;
    }
  }

  /** A fault reported by the simulation after start. */
  fault(message: string): void {
    this.log.append(h('div', null, h('b', null, 'fault '), h('span', null, message)));
  }

  /** The appearance card: a two-way switch, the point it makes, and a picker without a saved crab. */
  private buildLook(): HTMLElement {
    const a = this.actions;
    const segBtn = (kind: 'bare' | 'crab', label: string) => {
      const b = h('button', { class: 'rm-seg-b', tabindex: '-1', 'data-kind': kind }, label);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.onclick = () => a.appearance?.(kind);
      return b;
    };
    const seg = { bare: segBtn('bare', 'Bare robot'), crab: segBtn('crab', 'Your crab') };
    const chip = (label: string, title: string, on: () => void) => {
      const b = h('button', { class: 'rm-chip', tabindex: '-1', title }, label);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.onclick = on;
      return b;
    };
    const races = new Map<RaceId, HTMLButtonElement>();
    for (const id of RACE_ORDER) races.set(id, chip(RACES[id].name, RACES[id].tagline, () => a.pickCrab?.({ race: id })));
    const classes = new Map<ClassId, HTMLButtonElement>();
    for (const id of CLASS_ORDER) classes.set(id, chip(CLASSES[id].name, CLASSES[id].weapon, () => a.pickCrab?.({ classId: id })));
    const rnd = chip('Random crab', 'Roll a race, class, paint, crest and LED colour', () => a.pickCrab?.({ random: true }));
    rnd.classList.add('rnd');
    const xray = h('button', { class: 'rm-xray', tabindex: '-1', title: 'Draw the physics robot over the crab' }, 'X-ray');
    xray.addEventListener('mousedown', (e) => e.preventDefault());
    xray.onclick = () => xray.classList.toggle('on', !!a.toggleXray?.());
    const who = h('div', { class: 'who' });
    const pick = h(
      'div',
      { class: 'rm-pick' },
      h('div', { class: 'row' }, ...races.values()),
      h('div', { class: 'row' }, ...classes.values(), rnd),
    );
    const root = h(
      'div',
      { class: 'rm-look rm-panel' },
      h('div', { class: 'rm-look-head' }, h('span', { class: 'k' }, 'Appearance'), xray, h('kbd', { title: 'Keyboard: T' }, 'T')),
      h('div', { class: 'rm-seg' }, h('i', { class: 'thumb' }), seg.bare, seg.crab),
      h('div', { class: 'rm-look-cap' }, h('b', null, 'Same live policy, any appearance.'), who),
      pick,
    );
    this.look = { root, seg, who, pick, races, classes, xray };
    if (this.lookState) this.setAppearance(this.lookState);
    return root;
  }

  /** Reflects the appearance (from the card, the T key or the page). */
  setAppearance(st: AppearanceState): void {
    this.lookState = st;
    const l = this.look;
    if (!l) return;
    l.root.classList.toggle('crab', st.kind === 'crab');
    l.seg.bare.classList.toggle('on', st.kind === 'bare');
    l.seg.crab.classList.toggle('on', st.kind === 'crab');
    l.seg.crab.classList.toggle('loading', st.loading);
    l.xray.disabled = st.kind !== 'crab' || st.loading;
    l.xray.classList.toggle('on', st.xray);
    const s = st.spec;
    if (st.kind === 'crab' && s) {
      const race = RACES[s.race];
      const paint = race.shellColors[Math.max(0, Math.min(race.shellColors.length - 1, s.shell))]?.hex ?? '#d2202f';
      const led = race.ledColors[Math.max(0, Math.min(race.ledColors.length - 1, s.led))]?.hex ?? '#53f2e4';
      l.who.replaceChildren(
        h('i', { class: 'sw', style: `background:${paint};box-shadow:0 0 0 2px rgba(0,0,0,0.35), 0 0 10px ${led}` }),
        h('span', { class: 'name' }, s.name),
        h('span', null, `, ${race.name} ${CLASSES[s.classId].name}. `),
        st.loading ? 'Dressing the robot.' : "Posed every frame from the robot's 22 simulated joints.",
      );
    } else {
      l.who.replaceChildren(
        st.loading ? 'Dressing the robot.' : "Jumper's own meshes, posed by the physics. Press T to dress it.",
      );
    }
    // Without a saved crab, the picker stands in for character creation.
    l.pick.style.display = st.own ? 'none' : '';
    this.root.classList.toggle('rm-picking', !st.own);
    for (const [id, b] of l.races) b.classList.toggle('on', !st.own && st.kind === 'crab' && s?.race === id);
    for (const [id, b] of l.classes) b.classList.toggle('on', !st.own && st.kind === 'crab' && s?.classId === id);
  }

  /** Reflects a camera toggle made from the keyboard. */
  setFollow(on: boolean): void {
    this.followBtn?.classList.toggle('on', on);
  }

  private set(el: HTMLElement, t: string): void {
    if (this.lastText.get(el) === t) return;
    this.lastText.set(el, t);
    el.textContent = t;
  }

  private setHtml(el: HTMLElement, t: string): void {
    if (this.lastText.get(el) === t) return;
    this.lastText.set(el, t);
    el.innerHTML = t;
  }

  dispose(): void {
    this.dockFit?.disconnect();
    this.root.remove();
  }
}
