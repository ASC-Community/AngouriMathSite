import { $, html, setChip, presets, collapsible, tex, token, debounce, linkProgram, fullscreenTriangle, FULLSCREEN_VS, fitCanvas, loop, rgb } from '../shared.js';

const sin = Math.sin, cos = Math.cos;
const PENDULUM = {
  coords: ['a'], rates: ['w'], kinds: ['angle'], params: { m: 1, l: 1, g: 9.81 }, size: 1.1,
  starts: [[1.0, 0], [2.0, 0], [2.9, 0]],
  bobs: (s, P) => [[P.l * sin(s[0]), -P.l * cos(s[0])]],
  vars: 'a is the angle from straight down and w its rate; m, l and g are 1 kg, 1 m and 9.81 m/s².',
};
const SYSTEMS = [
  { label: 'Pendulum', lagrangian: 'm l^2 w^2 / 2 + m g l cos(a)', ...PENDULUM,
    note: 'Three swings of different size. Bigger swings take longer: the period is not constant, and the phase portrait shows why.' },
  { label: 'Double pendulum', lagrangian: '(m_1 + m_2)/2 l_1^2 w_1^2 + m_2/2 l_2^2 w_2^2 + m_2 l_1 l_2 w_1 w_2 cos(a_1 - a_2) + (m_1 + m_2) g l_1 cos(a_1) + m_2 g l_2 cos(a_2)',
    coords: ['a_1', 'a_2'], rates: ['w_1', 'w_2'], kinds: ['angle', 'angle'], params: { m_1: 1, m_2: 1, l_1: 1, l_2: 1, g: 9.81 }, size: 2.15,
    starts: [[2.0, 2.5, 0, 0], [2.000001, 2.5, 0, 0], [2.000002, 2.5, 0, 0]],
    bobs: (s, P) => { const p1 = [P.l_1 * sin(s[0]), -P.l_1 * cos(s[0])]; return [p1, [p1[0] + P.l_2 * sin(s[1]), p1[1] - P.l_2 * cos(s[1])]]; },
    vars: 'a_1 and a_2 are the angles of the two arms, w_1 and w_2 their rates. Names carry an underscore because AngouriMath reads m1 as m to the power 1.',
    note: 'Three copies started a millionth of a radian apart. They agree for a few seconds, then go their own ways: chaos.' },
  { label: 'Spring pendulum', lagrangian: 'm/2 (v^2 + r^2 w^2) + m g r cos(a) - k/2 (r - l_0)^2',
    coords: ['r', 'a'], rates: ['v', 'w'], kinds: ['length', 'angle'], params: { m: 1, g: 9.81, k: 40, l_0: 1 }, size: 2.0, spring: true,
    starts: [[1.3, 1.0, 0, 0]],
    bobs: (s) => [[s[0] * sin(s[1]), -s[0] * cos(s[1])]],
    vars: 'r is the spring’s length and v its rate, a the angle and w its rate; k is 40 N/m and the spring’s rest length l_0 is 1 m.',
    note: 'Stretching and swinging trade energy back and forth.' },
  { label: 'A typo', lagrangian: 'm l w^2 / 2 + m g l cos(a)', ...PENDULUM,
    note: 'The kinetic energy lost a length. The units check stops it before any motion is computed.' },
];

const MARKUP = `
<canvas class="stage" role="img" aria-label="The system moving, integrated from the equations AngouriMath derived"></canvas>
<div data-phase-box style="position:absolute;right:calc(16px + env(safe-area-inset-right, 0px));bottom:16px;width:min(300px,40%);aspect-ratio:4/3;border:1px solid var(--rule);border-radius:12px;overflow:hidden;background:var(--surface);box-shadow:0 10px 30px var(--shadow)">
  <canvas data-phase style="position:absolute;inset:0;width:100%;height:100%"></canvas>
  <canvas data-phase-dots style="position:absolute;inset:0;width:100%;height:100%"></canvas>
  <p class="foot" data-phase-label style="position:absolute;left:8px;top:6px;margin:0"></p>
</div>
<aside class="panel" aria-label="Lagrangian and results">
  <header class="panel-head">
    <div>
      <p class="eyebrow">From energy to motion</p>
      <h1>Motion from a Lagrangian</h1>
    </div>
    <button type="button" class="ghost" data-collapse aria-expanded="true">Hide</button>
  </header>
  <div class="panel-body">
    <div class="section" style="border:0;padding:0">
      <div class="presets" role="group" aria-label="Systems"></div>
      <label class="field-label" for="motion-input">L = kinetic energy − potential energy</label>
      <div class="formula"><span aria-hidden="true">L =</span><input id="motion-input" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
      <p class="foot" data-vars></p>
      <p class="note" data-note></p>
      <div class="status"><span class="chip" data-chip>Waiting for AngouriMath</span><span class="timing" data-timing></span></div>
      <p class="error" data-error></p>
    </div>
    <div class="section">
      <div class="labelled"><span>Units of L, checked by AngouriMath</span><div class="foot" data-units style="font-family:var(--font-mono)"></div></div>
      <div class="labelled"><span>Equations of motion, d/dt ∂L/∂w = ∂L/∂q, derived by AngouriMath</span><div class="tex" data-equation></div><p class="foot" data-mass></p></div>
      <div class="labelled"><span>Conserved energy, Σ w ∂L/∂w − L</span><div class="tex" data-energy></div></div>
    </div>
    <div class="section">
      <dl class="stats">
        <div><dt>Time</dt><dd data-time>0.0 s</dd></div>
        <div><dt>Energy drift</dt><dd data-drift>–</dd></div>
        <div><dt>Step</dt><dd>RK4, 1/240 s</dd></div>
      </dl>
      <div class="row"><button type="button" class="ghost" data-play>Pause</button><button type="button" class="ghost" data-reset>Start again</button></div>
      <p class="foot">The motion is integrated in AngouriMath’s worker from the compiled equations; the page only draws it.</p>
    </div>
  </div>
</aside>`;

const PHASE_FS = (fn) => `#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec2 uHalf;
uniform float uLevel;
uniform vec3 uLo, uHi, uMid, uInk;
out vec4 outColor;
${fn}
void main() {
  vec2 p = vNdc * uHalf;
  float e = energy(p);
  float t = tanh(e / uLevel);
  vec3 col = t < 0.0 ? mix(uMid, uLo, -t * 0.7) : mix(uMid, uHi, t * 0.7);
  float k = e / uLevel * 3.0;
  float line = abs(fract(k + 0.5) - 0.5) / max(fwidth(k), 1e-5);
  col = mix(col, uInk, 0.45 * (1.0 - min(line, 1.0)));
  outColor = vec4(col, 1.0);
}`;

export function mount(section, am) {
  html(section, MARKUP);
  const canvas = $(section, 'canvas'), phase = $(section, '[data-phase]'), dots = $(section, '[data-phase-dots]');
  const chip = $(section, '[data-chip]');
  collapsible($(section, '.panel'));
  const pgl = phase.getContext('webgl2', { antialias: false });
  const pvao = pgl && fullscreenTriangle(pgl);
  let phaseProg = null;

  let system = SYSTEMS[0], states = [], trails = [], phaseTrails = [], time = 0, e0 = null, ready = false;
  let busy = false, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W_HALF = 9;

  function reset() {
    states = system.starts.map((s) => [...s]);
    trails = states.map(() => []);
    phaseTrails = states.map(() => []);
    time = 0;
    e0 = null;
    $(section, '[data-drift]').textContent = '–';
  }

  async function derive(text) {
    ready = false;
    setChip(chip, '', 'Deriving');
    const t0 = performance.now();
    let r;
    try {
      r = await am.json('MotionJs', 'Derive', [text, system.coords, system.rates, system.kinds, Object.keys(system.params), Object.values(system.params)]);
    } catch (e) { setChip(chip, 'bad', 'AngouriMath stopped'); $(section, '[data-error]').textContent = e.message; return; }
    $(section, '[data-timing]').textContent = `${Math.round(performance.now() - t0)} ms`;
    if (!r.ok) {
      setChip(chip, 'bad', r.error.startsWith('Could not read') ? 'Not a formula yet' : 'Rejected');
      $(section, '[data-error]').textContent = r.error;
      $(section, '[data-units]').textContent = '';
      tex($(section, '[data-equation]'), '');
      tex($(section, '[data-energy]'), '');
      $(section, '[data-mass]').replaceChildren();
      states = [];
      return;
    }
    setChip(chip, 'ok', 'An energy: equations derived');
    $(section, '[data-error]').textContent = '';
    $(section, '[data-units]').textContent = r.units;
    tex($(section, '[data-equation]'), r.equation);
    tex($(section, '[data-energy]'), `E = ${r.energy}`);
    // The matrix on the left, as AngouriMath writes it, can be taken apart in the Matrices tab.
    $(section, '[data-mass]').innerHTML = r.mass
      ? `<a href="#matrices?a=${encodeURIComponent(r.mass)}">The mass matrix in the Matrices tab</a>: its determinant, inverse and eigenvalues.`
      : '';
    phaseProg = null;
    if (pgl && r.energyGlsl) {
      try { phaseProg = linkProgram(pgl, FULLSCREEN_VS, PHASE_FS(r.energyGlsl)); } catch { phaseProg = null; }
    }
    $(section, '[data-phase-label]').textContent = system.coords.length === 1
      ? `Phase portrait: ${system.coords[0]} across, ${system.rates[0]} up; curves of equal energy, drawn from E on the GPU`
      : `Configuration: ${system.coords[0]} across, ${system.coords[1]} up`;
    reset();
    ready = true;
  }

  // ------------------------------------------------------------ simulation and drawing
  const colours = ['--plot-1', '--plot-2', '--plot-3'];
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  async function step(dt) {
    if (!ready || busy || !playing || !states.length) return;
    busy = true;
    const steps = Math.max(1, Math.min(10, Math.round(dt * 240)));
    try {
      const flat = await am.call('MotionJs', 'Step', [states.flat(), 1 / 240, steps]);
      const size = states[0].length;
      states = states.map((_, i) => flat.slice(i * size, (i + 1) * size));
      time += steps / 240;
      states.forEach((s, i) => {
        const end = system.bobs(s, system.params).at(-1);
        trails[i].push(end);
        if (trails[i].length > 360) trails[i].shift();
        phaseTrails[i].push(system.coords.length === 1 ? [wrap(s[0]), s[1]] : [wrap(s[0]), wrap(s[1])]);
        if (phaseTrails[i].length > 900) phaseTrails[i].shift();
      });
    } catch { /* stopped; the chip says so on the next derive */ }
    busy = false;
  }

  let energyClock = 0;
  async function energyCheck() {
    if (!ready || !states.length) return;
    try {
      const es = await am.call('MotionJs', 'Energies', [states.flat()]);
      if (e0 === null) { e0 = es; return; }
      const drift = Math.max(...es.map((e, i) => Math.abs(e - e0[i]) / Math.max(Math.abs(e0[i]), 1e-9)));
      $(section, '[data-drift]').textContent = drift < 1e-12 ? '< 1e-12' : drift.toExponential(1);
    } catch { /* ignore */ }
  }

  function drawScene() {
    const [w, h] = fitCanvas(canvas, 2);
    const ctx = canvas.getContext('2d'), s = w / canvas.clientWidth;
    ctx.fillStyle = token('--surface');
    ctx.fillRect(0, 0, w, h);
    if (!states.length) return;
    const wide = canvas.clientWidth > 900;
    // The pivot sits mid-height: a pendulum swinging over the top needs as much room above as below.
    const ox = wide ? w * 0.6 : w * 0.5, oy = wide ? h * 0.47 : h * 0.3;
    const scale = Math.min(w * (wide ? 0.3 : 0.42), h * (wide ? 0.4 : 0.26)) / system.size;
    const X = (p) => ox + p[0] * scale, Y = (p) => oy - p[1] * scale;
    ctx.fillStyle = token('--ink');
    ctx.fillRect(ox - 40 * s, oy - 3 * s, 80 * s, 3 * s);
    states.forEach((st, i) => {
      const colour = token(colours[i % colours.length]);
      const trail = trails[i];
      ctx.lineWidth = 1.6 * s;
      for (let k = 1; k < trail.length; k++) {
        ctx.strokeStyle = colour;
        ctx.globalAlpha = (k / trail.length) * 0.6;
        ctx.beginPath(); ctx.moveTo(X(trail[k - 1]), Y(trail[k - 1])); ctx.lineTo(X(trail[k]), Y(trail[k])); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      let prev = [0, 0];
      for (const b of system.bobs(st, system.params)) {
        ctx.strokeStyle = token('--ink');
        ctx.lineWidth = 2.4 * s;
        ctx.beginPath();
        if (system.spring) {
          // A zigzag between the pivot and the bob.
          const n = 14, dx = b[0] - prev[0], dy = b[1] - prev[1], len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
          ctx.moveTo(X(prev), Y(prev));
          for (let k = 1; k < n; k++) {
            const t = k / n, o = (k % 2 ? 1 : -1) * 0.06;
            ctx.lineTo(X([prev[0] + dx * t + nx * o, 0]), Y([0, prev[1] + dy * t + ny * o]));
          }
          ctx.lineTo(X(b), Y(b));
        } else { ctx.moveTo(X(prev), Y(prev)); ctx.lineTo(X(b), Y(b)); }
        ctx.stroke();
        ctx.fillStyle = colour;
        ctx.beginPath(); ctx.arc(X(b), Y(b), 11 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = token('--surface');
        ctx.lineWidth = 2 * s;
        ctx.stroke();
        prev = b;
      }
    });
    ctx.fillStyle = token('--ink');
    ctx.beginPath(); ctx.arc(ox, oy, 4 * s, 0, Math.PI * 2); ctx.fill();
  }

  function drawPhase() {
    const [pw, ph] = fitCanvas(phase, 2);
    const [dw, dh] = fitCanvas(dots, 2);
    const one = system.coords.length === 1;
    const hx = Math.PI, hy = one ? W_HALF : Math.PI;
    if (pgl) {
      pgl.viewport(0, 0, pw, ph);
      if (one && phaseProg) {
        pgl.useProgram(phaseProg.program);
        pgl.uniform2f(phaseProg.loc.uHalf, hx, hy);
        const P = system.params;
        pgl.uniform1f(phaseProg.loc.uLevel, (P.m ?? 1) * (P.g ?? 9.81) * (P.l ?? 1));
        pgl.uniform3fv(phaseProg.loc.uLo, rgb('--plot-1'));
        pgl.uniform3fv(phaseProg.loc.uHi, rgb('--plot-2'));
        pgl.uniform3fv(phaseProg.loc.uMid, rgb('--surface'));
        pgl.uniform3fv(phaseProg.loc.uInk, rgb('--ink'));
        pgl.bindVertexArray(pvao);
        pgl.drawArrays(pgl.TRIANGLES, 0, 3);
      } else {
        pgl.clearColor(...rgb('--surface'), 1);
        pgl.clear(pgl.COLOR_BUFFER_BIT);
      }
    }
    const ctx = dots.getContext('2d'), s = dw / dots.clientWidth;
    ctx.clearRect(0, 0, dw, dh);
    const X = (x) => (x + hx) / (2 * hx) * dw, Y = (y) => dh - (y + hy) / (2 * hy) * dh;
    ctx.strokeStyle = token('--rule');
    ctx.lineWidth = s;
    ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), dh); ctx.moveTo(0, Y(0)); ctx.lineTo(dw, Y(0)); ctx.stroke();
    phaseTrails.forEach((trail, i) => {
      const colour = token(colours[i % colours.length]);
      if (!one) {
        ctx.strokeStyle = colour;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.2 * s;
        ctx.beginPath();
        trail.forEach((p, k) => {
          const jump = k > 0 && (Math.abs(p[0] - trail[k - 1][0]) > Math.PI || Math.abs(p[1] - trail[k - 1][1]) > Math.PI);
          (k === 0 || jump) ? ctx.moveTo(X(p[0]), Y(p[1])) : ctx.lineTo(X(p[0]), Y(p[1]));
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const p = trail.at(-1);
      if (!p) return;
      ctx.fillStyle = colour;
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = token('--surface');
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();
    });
  }

  const animation = loop((dt) => {
    step(dt);
    energyClock += dt;
    if (energyClock > 0.5) { energyClock = 0; energyCheck(); }
    $(section, '[data-time]').textContent = `${time.toFixed(1)} s`;
    drawScene();
    drawPhase();
  });

  // ------------------------------------------------------------ controls
  const input = $(section, '#motion-input'), note = $(section, '[data-note]');
  const press = presets($(section, '.presets'), SYSTEMS, (p) => {
    system = p;
    input.value = p.lagrangian;
    note.textContent = p.note || '';
    $(section, '[data-vars]').textContent = p.vars;
    press(p.label);
    derive(p.lagrangian);
  });
  system = SYSTEMS[0];
  input.value = system.lagrangian;
  note.textContent = system.note;
  $(section, '[data-vars]').textContent = system.vars;
  press(system.label);
  const later = debounce(() => derive(input.value), 500);
  input.addEventListener('input', () => { press(null); note.textContent = ''; later(); });
  const play = $(section, '[data-play]');
  const syncPlay = () => { play.textContent = playing ? 'Pause' : 'Play'; };
  play.addEventListener('click', () => { playing = !playing; syncPlay(); });
  syncPlay();
  $(section, '[data-reset]').addEventListener('click', reset);

  derive(input.value);
  return { show: () => animation.start(), hide: () => animation.stop(), restarted: () => derive(input.value) };
}
