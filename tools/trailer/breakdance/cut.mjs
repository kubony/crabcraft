// What the breakdance videos' edits share (edit.mjs, the contest cut; reel.mjs, the showcase of
// every move): reading the shots' probes (where a move's events, a policy's start, a jump's
// landing or a bar of the live routine fall in a clip) and rendering a planned cut: the picture
// cut frame-exact from the shots, an original beat (beat.py, at the toprock's 107.14 bpm) arranged
// on the cut with impacts on the landings, the game's own sound effects and, where a plan asks
// for it, the live routine's own music under the routine; two-pass loudness normalisation to
// -14 LUFS; burned-in English and Chinese captions, move names and lower thirds; H.264 high + AAC;
// English and Chinese SRT files.
//
// A plan (see edit.mjs and reel.mjs) is { segs, captions, tags, lowers, flashes, music, tracks,
// sfx, cards, total }: `segs` [{ src, in, t0, end }] in timeline seconds, `src` a shot name or a
// card (`card-logo`, `card-end`); `captions`, `tags` and `lowers` [id, from, to], their PNGs
// rendered by tools/trailer/cards.mjs from the cut's captions file; `music` beat.py's arrangement;
// `tracks` [{ file, at, from, to, fadeOut }] audio files laid on the timeline (`at` is where the
// file's `from` second plays), matched to the beat's loudness; `sfx` [name, at, gain] from
// public/audio; `cards` [id, from, to] text that a card shows, for the SRT.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOVE } from './routine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
export const AUDIO = resolve(repo, 'public', 'audio');
export const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
export const FPS = 60;
/** The toprock's step, 0.56 s (src/motion/breakClips.ts break_toprock beat1 to beat8): 107.14 bpm. */
export const B = 0.56;
export const T = (n) => n * B;
export const BAR = 4 * B;

export function ff(argv, label, level = 'error') {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-v', level, '-y', ...argv], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    console.error(r.stderr.toString());
    throw new Error(`ffmpeg failed: ${label}`);
  }
  return r.stderr.toString();
}

// ---------------------------------------------------------------------------------- the shots

/**
 * Probe readers over a shots folder. `S(name)` is a shot's file name in this cut (the portrait
 * takes carry -port).
 */
export function shotTools(shotsDir, S) {
  const meta = {};
  const shot = (name) => (meta[name] ??= JSON.parse(readFileSync(resolve(shotsDir, `${S(name)}.json`), 'utf8')));

  /**
   * Clip time (s) of a move's event in a game shot: where the move's own clock (the probe's `st`,
   * BreakRoutine's step time) reaches the event's offset into the move (routine.mjs, from
   * src/motion/breakClips.ts), interpolated between frames. The routine starts a move on the frame
   * its predecessor's window runs out, so a move's start on the routine clock drifts from the ideal
   * by up to a frame per move; its own clock does not.
   */
  function atMove(name, move, event) {
    const m = MOVE[move];
    const want = m.ev[event];
    const p = shot(name).probe;
    const first = p.findIndex((x) => x.step === m.index && x.active !== false);
    // An event before the move's first recorded frame (its start, say): one frame's step back.
    if (first >= 0 && first + 1 < p.length && want <= p[first].st && p[first + 1].step === m.index) {
      return (first - (p[first].st - want) / (p[first + 1].st - p[first].st)) / FPS;
    }
    for (let i = 1; i < p.length; i++) {
      if (p[i].step !== m.index || p[i - 1].step !== m.index || p[i].active === false) continue;
      const a = p[i - 1].st;
      const b = p[i].st;
      if (a <= want && b >= want && b > a) return (i - 1 + (want - a) / (b - a)) / FPS;
    }
    throw new Error(`${S(name)}: ${m.id} never reaches ${event} (${want.toFixed(3)} s in)`);
  }

  /** Clip time (s) of the frame where a Robot Mode shot's simulated time reaches `sim`, interpolated. */
  function atSim(name, sim) {
    const p = shot(name).probe;
    for (let i = 1; i < p.length; i++) {
      if (p[i - 1].sim <= sim && p[i].sim >= sim && p[i].sim > p[i - 1].sim) return (i - 1 + (sim - p[i - 1].sim) / (p[i].sim - p[i - 1].sim)) / FPS;
    }
    throw new Error(`${S(name)}: simulated time ${sim.toFixed(3)} is not in the shot`);
  }

  /**
   * The `n`th run of `mode` in a Robot Mode shot: simulated time of its policy's start (the first
   * frame it runs, less nothing: the probe is per frame) and the frame index there.
   */
  function run(name, mode, n = 0) {
    const p = shot(name).probe;
    let k = -1;
    for (let i = 0; i < p.length; i++) {
      if (p[i].mode === mode && p[i].run && !(i > 0 && p[i - 1].mode === mode && p[i - 1].run)) {
        if (++k === n) return { i, sim: p[i].sim };
      }
    }
    throw new Error(`${S(name)}: ${mode} run ${n} never started`);
  }

  /** Clip time (s) of the first frame the robot runs `mode`'s policy (its `n`th run). */
  const runStart = (name, mode, n = 0) => run(name, mode, n).i / FPS;

  /**
   * A jump in a Robot Mode shot (the `n`th run of `mode`): clip times of its policy's start, its
   * take-off (the body origin 20 mm above its height at the start), apex and touchdown. The
   * touchdown is the impact: after the apex, where the body's fall is checked hardest (the
   * largest rise of its vertical speed per simulated second), within 0.4 s of falling below its
   * take-off height.
   */
  function jump(name, mode, n = 0) {
    const p = shot(name).probe;
    const r = run(name, mode, n);
    let end = r.i;
    while (end + 1 < p.length && p[end + 1].mode === mode) end++;
    const y0 = p[r.i].y;
    let apex = r.i;
    for (let i = r.i; i <= end; i++) if (p[i].y > p[apex].y) apex = i;
    let off = r.i;
    while (off < apex && p[off].y < y0 + 0.02) off++;
    const v = (i) => (p[i + 1].y - p[i].y) / Math.max(1e-6, p[i + 1].sim - p[i].sim);
    let down = apex;
    while (down < end && p[down].y > y0 + 0.02) down++;
    let land = down;
    let best = -Infinity;
    for (let i = Math.max(apex + 1, down - 30); i + 2 <= end && p[i].sim - p[down].sim < 0.4; i++) {
      const dv = (v(i + 1) - v(i)) / Math.max(1e-6, p[i + 2].sim - p[i].sim);
      if (dv > best) {
        best = dv;
        land = i + 1;
      }
    }
    return {
      start: r.i / FPS,
      takeoff: off / FPS,
      apex: apex / FPS,
      land: land / FPS,
      sim: { start: r.sim, takeoff: p[off].sim - r.sim, apex: p[apex].sim - r.sim, land: p[land].sim - r.sim, rise: p[apex].y - y0 },
    };
  }

  /**
   * Clip time (s) of a moment of the live routine (src/robot/sim/routine.ts), in seconds since its
   * bar 0 (the probe's `routine.t0`, simulated time).
   */
  function atRoutine(name, r) {
    const p = shot(name).probe;
    const first = p.find((x) => x.routine && Number.isFinite(x.routine.t0));
    if (!first) throw new Error(`${S(name)}: the routine never started`);
    return atSim(name, first.routine.t0 + r);
  }

  return { shot, atMove, atSim, run, runStart, jump, atRoutine };
}

// ---------------------------------------------------------------------------------- render

/** The end card's own text, for the subtitles. */
export const CARD_TEXT = {
  endcard: {
    en: 'World of Crabcraft. Play in your browser: github.com/kubony/crabcraft\n#Jumper #CrabRobot #OpenSourceRobot @KingKong Robotics. Trained in simulation; not yet run on a physical Jumper.',
    zh: 'World of Crabcraft，在浏览器里直接玩：github.com/kubony/crabcraft\n#Jumper #CrabRobot #OpenSourceRobot @KingKong Robotics。仿真训练结果，尚未在实体 Jumper 上运行。',
  },
};

const ts = (s) => {
  const ms = Math.round(s * 1000);
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${hh}:${mm}:${ss},${String(ms % 1000).padStart(3, '0')}`;
};

/**
 * Render plan `P` to `outFile` (and its .en.srt and .zh.srt). `cut` names the layout ('land',
 * 'port'); `S` maps a shot name to its file name; `captions` is the cut's captions file (id, en,
 * zh); `cardText` the text of each card in P.cards, per language, for the SRT.
 */
export function render(P, { cut, S, shotsDir, cardsDir, work, outFile, captions, cardText }) {
  mkdirSync(work, { recursive: true });
  mkdirSync(dirname(outFile), { recursive: true });
  const port = cut === 'port';
  const [W, H] = port ? [1080, 1920] : [1920, 1080];
  const CAP = Object.fromEntries(JSON.parse(readFileSync(captions, 'utf8')).map((c) => [c.id, c]));
  const { shot } = shotTools(shotsDir, S);

  // -------------------------------------------------------------------------------- picture

  const srcFile = (name) => (name.startsWith('card-') ? resolve(cardsDir, `${S(name)}.mp4`) : resolve(shotsDir, `${S(name)}.mp4`));
  const frames = (s) => Math.round(s * FPS);
  // The captures are Chrome JPEG screenshots: full-range BT.601 YCbCr. Deliver limited-range BT.709.
  const SCALE = `scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709`;
  const TAGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  const list = [];
  let t = 0;
  P.segs.forEach((s, i) => {
    const start = frames(t);
    const stop = frames(s.end);
    const n = stop - start;
    if (n <= 0) throw new Error(`segment ${i} (${s.src}) has no length`);
    const f0 = Math.round(s.in * FPS);
    if (f0 < 0) throw new Error(`segment ${i} (${s.src}) starts before its clip: in ${s.in.toFixed(3)}`);
    const srcFrames = s.src.startsWith('card-') ? Infinity : shot(s.src).frames;
    if (f0 + n > srcFrames) throw new Error(`segment ${i} (${s.src}) runs past its clip: ${f0}+${n} > ${srcFrames}`);
    const file = resolve(work, `seg-${String(i).padStart(2, '0')}.mp4`);
    // Re-render a segment only when its source or range changed.
    const key = JSON.stringify([srcFile(s.src), statSync(srcFile(s.src)).mtimeMs, f0, n, SCALE]);
    const keyFile = `${file}.key`;
    if (!existsSync(file) || !existsSync(keyFile) || readFileSync(keyFile, 'utf8') !== key) {
      ff(
        ['-i', srcFile(s.src), '-vf', `trim=start_frame=${f0}:end_frame=${f0 + n},setpts=PTS-STARTPTS,${SCALE},fps=${FPS},format=yuv420p`,
          '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'fast', '-crf', '9', '-g', '60', ...TAGS, '-an', file],
        `segment ${i}`,
      );
      writeFileSync(keyFile, key);
    }
    list.push(`file '${file}'`);
    console.log(`  seg ${String(i).padStart(2)} ${S(s.src).padEnd(22)} in ${s.in.toFixed(3).padStart(7)}  ${t.toFixed(3)} -> ${s.end.toFixed(3)} (${n} frames)`);
    t = stop / FPS;
  });
  writeFileSync(resolve(work, 'list.txt'), `${list.join('\n')}\n`);
  const body = resolve(work, 'body.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', resolve(work, 'list.txt'), '-c', 'copy', body], 'concat');
  const total = t;

  // -------------------------------------------------------------------------------- sound

  // The beat, arranged on the cut (sections in bars, impacts on the landings).
  const arrFile = resolve(work, 'beat.json');
  const beatWav = resolve(work, 'beat.wav');
  writeFileSync(arrFile, JSON.stringify(P.music, null, 1));
  const r = spawnSync('uv', ['run', '-q', '--with', 'numpy', '--with', 'scipy', 'python', resolve(here, 'beat.py'), arrFile, beatWav], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('beat.py failed');

  const loudness = (file) => {
    const o = ff(['-i', file, '-af', 'ebur128', '-f', 'null', '-'], `loudness of ${file}`, 'info');
    return Number(o.match(/I:\s+(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0]);
  };
  const audioIn = ['-i', beatWav];
  const aChains = [`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.0`];
  // Tracks: an audio file played from its `from` second at timeline `at`, up to its `to`, matched
  // to the beat's integrated loudness so the cut keeps one level across them.
  if (P.tracks?.length) {
    const beatI = loudness(beatWav);
    for (const tr of P.tracks) {
      const trI = loudness(tr.file);
      const gain = 10 ** ((beatI - trI + (tr.gainDb ?? 0)) / 20);
      const d = tr.to - tr.from;
      audioIn.push('-i', tr.file);
      const k = audioIn.length / 2 - 1;
      const fo = tr.fadeOut ?? 0.3;
      aChains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${tr.from.toFixed(4)}:duration=${d.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=out:st=${(d - fo).toFixed(4)}:d=${fo},volume=${gain.toFixed(4)},adelay=${Math.round(tr.at * 1000)}:all=1`);
      console.log(`  track ${tr.file.split('/').pop()} ${tr.from.toFixed(2)}-${tr.to.toFixed(2)} s at ${tr.at.toFixed(3)} s, gain ${(beatI - trI).toFixed(1)} dB (beat ${beatI} LUFS, track ${trI} LUFS)`);
    }
  }
  for (const [name, at, gain] of P.sfx) {
    if (at < 0 || at > total) continue;
    audioIn.push('-i', resolve(AUDIO, `${name}.ogg`));
    const k = audioIn.length / 2 - 1;
    aChains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${gain},adelay=${Math.round(at * 1000)}:all=1`);
  }
  const labels = aChains.map((_, i) => `[a${i}]`);
  const aGraph = `${aChains.map((c, i) => `${c}${labels[i]}`).join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,atrim=duration=${total.toFixed(4)},afade=t=out:st=${(total - 0.25).toFixed(3)}:d=0.25[mix]`;
  const rawMix = resolve(work, 'mix-raw.wav');
  ff([...audioIn, '-filter_complex', aGraph, '-map', '[mix]', '-c:a', 'pcm_f32le', '-ar', '48000', rawMix], 'audio mix');
  // A limiter for the transients, then two-pass EBU R128 normalisation to -14 LUFS (linear gain),
  // true peak under -2 dBTP so the AAC encode stays under -1.
  const LN = 'I=-14:TP=-2:LRA=11';
  const limited = resolve(work, 'mix-limited.wav');
  ff(['-i', rawMix, '-af', 'alimiter=limit=0.5:attack=3:release=80:level=false,aresample=192000,alimiter=limit=0.5:attack=1:release=50:level=false,aresample=48000', '-c:a', 'pcm_f32le', limited], 'limiter');
  const m1 = ff(['-i', limited, '-af', `loudnorm=${LN}:print_format=json`, '-f', 'null', '-'], 'loudnorm measure', 'info');
  const js = JSON.parse(m1.slice(m1.lastIndexOf('{'), m1.lastIndexOf('}') + 1));
  const normMix = resolve(work, 'mix.wav');
  const m2 = ff(['-i', limited, '-af', `loudnorm=${LN}:measured_I=${js.input_i}:measured_TP=${js.input_tp}:measured_LRA=${js.input_lra}:measured_thresh=${js.input_thresh}:offset=${js.target_offset}:linear=true:print_format=json`, '-ar', '48000', '-c:a', 'pcm_f32le', normMix], 'loudnorm apply', 'info');
  const js2 = JSON.parse(m2.slice(m2.lastIndexOf('{'), m2.lastIndexOf('}') + 1));
  console.log(`  mix measured ${js.input_i} LUFS, ${js.input_tp} dBTP; normalised ${js2.output_i} LUFS, ${js2.output_tp} dBTP (${js2.normalization_type})`);

  // -------------------------------------------------------------------------------- overlays and encode

  const vIn = ['-i', body, '-i', normMix];
  const vChains = [];
  let base = '[0:v]';
  let k = 2;
  let n = 0;
  const overlays = [
    ...P.captions.map((c) => [...c, 0.24]),
    ...(P.tags ?? []).map((c) => [...c, 0.12]),
    ...(P.lowers ?? []).map((c) => [...c, 0.2]),
  ];
  for (const [id, a, b, fd] of overlays) {
    const d = b - a;
    vIn.push('-loop', '1', '-framerate', String(FPS), '-t', d.toFixed(3), '-i', resolve(cardsDir, `cap-${id}-${cut}.png`));
    vChains.push(`[${k}:v]format=rgba,fade=t=in:st=0:d=${fd}:alpha=1,fade=t=out:st=${(d - fd).toFixed(3)}:d=${fd}:alpha=1,setpts=PTS-STARTPTS+${a.toFixed(3)}/TB[c${k}]`);
    vChains.push(`${base}[c${k}]overlay=0:0:eof_action=pass:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[b${n}]`);
    base = `[b${n++}]`;
    k++;
  }
  for (const f of P.flashes) {
    // On the frame grid, so a flash on a cut starts on the cut's first frame.
    const at = frames(f.at) / FPS;
    vChains.push(`color=c=white:s=${W}x${H}:r=${FPS}:d=${f.d},format=rgba,colorchannelmixer=aa=${f.a},fade=t=out:st=0:d=${f.d}:alpha=1,setpts=PTS-STARTPTS+${at.toFixed(4)}/TB[f${n}]`);
    vChains.push(`${base}[f${n}]overlay=0:0:eof_action=pass:enable='between(t,${(at - 0.001).toFixed(4)},${(at + f.d).toFixed(4)})'[b${n}]`);
    base = `[b${n++}]`;
  }
  vChains.push(`${base}format=yuv420p[vout]`);
  ff(
    [...vIn, '-filter_complex', vChains.join(';'), '-map', '[vout]', '-map', '1:a', '-t', total.toFixed(3),
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', port ? '18' : '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-x264-params', 'keyint=120:min-keyint=60', ...TAGS, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', outFile],
    'final encode',
  );
  console.log(`  wrote ${outFile} (${total.toFixed(2)} s)`);

  // -------------------------------------------------------------------------------- subtitles

  for (const lang of ['en', 'zh']) {
    const text = (id) => {
      const c = CAP[id];
      if (!c) throw new Error(`no caption ${id} in ${captions}`);
      return c[`${lang}Line`] ? `${c[lang]}: ${c[`${lang}Line`]}` : c[lang];
    };
    const rows = [
      ...P.captions.map(([id, a, b]) => [a, b, text(id)]),
      ...(P.lowers ?? []).map(([id, a, b]) => [a, b, text(id)]),
      ...P.cards.map(([id, a, b]) => [a, b, cardText[id][lang]]),
    ].sort((x, y) => x[0] - y[0]);
    const srt = rows.map(([a, b, txt], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${txt}\n`).join('\n');
    const file = outFile.replace(/\.mp4$/, `.${lang}.srt`);
    writeFileSync(file, srt);
    console.log(`  wrote ${file}`);
  }
  writeFileSync(resolve(work, 'plan.json'), JSON.stringify({ ...P, total }, null, 1));
  return total;
}
