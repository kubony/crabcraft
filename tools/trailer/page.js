// In-page helpers for trailer capture (injected by tools/trailer/lib.mjs with addInitScript).
// Camera paths through keyframes, evaluated on every engine frame after the game has moved its
// crabs, so a scripted camera always wins over the game's own follow or cinematic cameras.
(() => {
  const T = {};
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  T.clamp01 = clamp01;
  T.lerp = (a, b, k) => a + (b - a) * k;
  T.lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const EASE = {
    linear: (x) => x,
    in: (x) => x * x * x,
    out: (x) => 1 - (1 - x) ** 3,
    inout: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
    smooth: (x) => x * x * (3 - 2 * x),
    sine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  };
  T.ease = (name, x) => (EASE[name] ?? EASE.smooth)(clamp01(x));

  /** Uniform Catmull-Rom between p1 and p2 with neighbours p0 and p3. */
  const cr = (p0, p1, p2, p3, u) => {
    const u2 = u * u;
    const u3 = u2 * u;
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      out[i] = 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3);
    }
    return out;
  };

  /**
   * Keyframed camera: keys = [{ t, p: [x,y,z], l: [x,y,z], fov?, roll? }], times in seconds.
   * One global easing (`ease`, default 'inout') runs over the whole path, so the camera starts and
   * stops softly and moves through the middle keys without stopping; `spline` (default true)
   * rounds the corners.
   */
  T.path = (keys, t, opts = {}) => {
    const t0 = keys[0].t;
    const t1 = keys[keys.length - 1].t;
    const g = t1 > t0 ? T.ease(opts.ease ?? 'inout', (t - t0) / (t1 - t0)) : 0;
    const tt = t0 + g * (t1 - t0);
    let i = 0;
    while (i < keys.length - 2 && tt > keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[Math.min(i + 1, keys.length - 1)];
    const k = b.t > a.t ? clamp01((tt - a.t) / (b.t - a.t)) : 0;
    const prev = keys[Math.max(0, i - 1)];
    const next = keys[Math.min(keys.length - 1, i + 2)];
    const spline = opts.spline !== false && keys.length > 2;
    const p = spline ? cr(prev.p, a.p, b.p, next.p, k) : T.lerp3(a.p, b.p, k);
    const l = spline ? cr(prev.l, a.l, b.l, next.l, k) : T.lerp3(a.l, b.l, k);
    const fov = T.lerp(a.fov ?? 0, b.fov ?? 0, k);
    const roll = T.lerp(a.roll ?? 0, b.roll ?? 0, k);
    return { p, l, fov, roll };
  };

  /** Place a three.js camera. */
  T.place = (cam, p, l, fov, roll = 0) => {
    T.cam = cam;
    cam.position.set(p[0], p[1], p[2]);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.lookAt(l[0], l[1], l[2]);
    if (fov && Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  };

  /** Small hand-held wobble (deterministic), metres and radians. */
  T.wobble = (t, amp = 0.02) => [
    amp * (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.9 + 1) * 0.4),
    amp * (Math.sin(t * 1.7 + 2) * 0.6 + Math.sin(t * 3.7) * 0.4) * 0.6,
    amp * (Math.sin(t * 1.1 + 4) * 0.6 + Math.sin(t * 2.3 + 3) * 0.4),
  ];

  let cb = null;
  let start = 0;
  let off = null;
  /** Run fn(t, dt) on every engine frame after the screen's own update; t is seconds since this call. */
  T.onFrame = (fn) => {
    cb = fn;
    start = performance.now();
    if (!off) {
      const engine = window.__robotMode?.engine ?? window.app.engine;
      off = engine.onFrame((f) => {
        if (cb) cb((performance.now() - start) / 1000, f.dt);
        // A re-render of a frame that came out blank turns the camera by a hair (see record()).
        if (T.nudge && T.cam) T.cam.rotateY(T.nudge);
      });
    }
  };
  T.clear = () => {
    cb = null;
  };
  /** Restart shot time at 0 (record() calls it after its pre-roll). */
  T.rebase = () => {
    start = performance.now();
  };
  /** Shot time, seconds. */
  T.now = () => (performance.now() - start) / 1000;
  window.__T = T;
})();
