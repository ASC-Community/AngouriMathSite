import { $, html, setChip, presets, codeBlock, CODE_BLOCK, collapsible, linkProgram, fullscreenTriangle, FULLSCREEN_VS, fitCanvas, loop, tex, debounce } from '../shared.js';

const PRESETS = [
  { label: 'Torus', formula: 'sqrt((sqrt(x^2 + z^2) - 1)^2 + y^2) - 0.4',
    note: 'A true distance: f is the distance to the surface. Its mean curvature is positive all round; switch to Gaussian curvature to see the saddle-shaped inside turn negative.' },
  { label: 'Heart', formula: '(x^2 + 9/4 z^2 + y^2 - 1)^3 - x^2 y^3 - 9/80 z^2 y^3',
    note: 'Taubin’s heart, a degree-6 polynomial and no distance at all: marching steps by f / |∇f|, which only works with the exact gradient.' },
  { label: 'Blobs', formula: '-log(e^(-8 (sqrt((x - 0.55)^2 + y^2 + z^2) - 0.5)) + e^(-8 (sqrt((x + 0.55)^2 + y^2 + z^2) - 0.5)) + e^(-8 (sqrt(x^2 + (y - 0.6)^2 + z^2) - 0.42))) / 8',
    note: 'Three spheres joined by a smooth minimum (log-sum-exp), which AngouriMath differentiates like anything else.' },
  { label: 'Gyroid', formula: 'sin(4x) cos(4y) + sin(4y) cos(4z) + sin(4z) cos(4x)',
    note: 'A triply periodic minimal-like surface, cut by the bounding sphere. Mean curvature near zero everywhere: try the Gaussian colouring.' },
  { label: 'Rounded cube', formula: 'x^8 + y^8 + z^8 - 1',
    note: 'Flat faces, curvature concentrated along the edges.' },
  { label: 'Hard max', formula: 'max(max(abs(x), abs(y)), abs(z)) - 1',
    note: 'A cube as a max of distances. AngouriMath does not differentiate max, and says so instead of guessing.' },
];

const FS = (fns) => `#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec3 uEye, uFwd, uRight, uUp;
uniform vec2 uTan;
uniform float uShift;
uniform int uMode;
uniform float uRadius;
uniform vec3 uBg0, uBg1;
out vec4 outColor;
${fns}
vec3 diverging(float t) {
  vec3 neg = vec3(0.16, 0.42, 0.78), mid = vec3(0.93, 0.92, 0.88), pos = vec3(0.86, 0.36, 0.12);
  return t < 0.0 ? mix(mid, neg, -t) : mix(mid, pos, t);
}
void main() {
  vec3 rd = normalize(uFwd + (vNdc.x * uTan.x - uShift) * uRight + vNdc.y * uTan.y * uUp);
  vec3 ro = uEye;
  vec3 bg = mix(uBg0, uBg1, 0.5 + 0.5 * vNdc.y);
  float b = dot(ro, rd), c = dot(ro, ro) - uRadius * uRadius, disc = b * b - c;
  if (disc < 0.0) { outColor = vec4(bg, 1.0); return; }
  float t = max(-b - sqrt(disc), 0.0), tEnd = -b + sqrt(disc);
  // March by f / |grad f|, the first-order distance the exact gradient gives; a sign change
  // brackets the surface, and bisection finds it.
  vec4 prev = fieldGrad(ro + rd * t);
  float tPrev = t;
  bool hit = false;
  for (int i = 0; i < 240; i++) {
    vec4 r = fieldGrad(ro + rd * t);
    if (i > 0 && sign(r.x) != sign(prev.x)) {
      float a = tPrev, z = t, s0 = sign(prev.x);
      for (int k = 0; k < 16; k++) {
        float m = 0.5 * (a + z);
        if (sign(field(ro + rd * m)) == s0) a = m; else z = m;
      }
      t = 0.5 * (a + z);
      hit = true;
      break;
    }
    float d = r.x / max(length(r.yzw), 1e-3);
    if (abs(d) < 1e-4) { hit = true; break; }
    tPrev = t;
    prev = r;
    t += clamp(abs(d) * 0.8, 2e-3, 0.06);
    if (t > tEnd) break;
  }
  if (!hit) { outColor = vec4(bg, 1.0); return; }
  vec3 p = ro + rd * t;
  vec3 g = fieldGrad(p).yzw;
  vec3 Hd, Ho;
  fieldHess(p, Hd, Ho);
  mat3 H = mat3(Hd.x, Ho.x, Ho.y, Ho.x, Hd.y, Ho.z, Ho.y, Ho.z, Hd.z);
  float gn = max(length(g), 1e-6);
  vec3 n = g / gn;
  if (dot(n, rd) > 0.0) n = -n;
  // Mean curvature (|g|^2 tr H - g.Hg) / 2|g|^3 and Gaussian g.adj(H)g / |g|^4.
  float mean = (gn * gn * (Hd.x + Hd.y + Hd.z) - dot(g, H * g)) / (2.0 * gn * gn * gn);
  mat3 adj = mat3(
    Hd.y * Hd.z - Ho.z * Ho.z, Ho.y * Ho.z - Ho.x * Hd.z, Ho.x * Ho.z - Ho.y * Hd.y,
    Ho.y * Ho.z - Ho.x * Hd.z, Hd.x * Hd.z - Ho.y * Ho.y, Ho.x * Ho.y - Hd.x * Ho.z,
    Ho.x * Ho.z - Ho.y * Hd.y, Ho.x * Ho.y - Hd.x * Ho.z, Hd.x * Hd.y - Ho.x * Ho.x);
  float gauss = dot(g, adj * g) / (gn * gn * gn * gn);
  vec3 base = uMode == 0 ? diverging(tanh(mean * 0.5)) : uMode == 1 ? diverging(tanh(gauss * 0.4)) : 0.5 + 0.5 * n;
  vec3 light = normalize(vec3(0.5, 0.8, 0.4));
  float diff = max(dot(n, light), 0.0);
  float spec = pow(max(dot(reflect(rd, n), light), 0.0), 40.0);
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  vec3 col = base * (0.28 + 0.72 * diff) + 0.25 * spec + 0.12 * rim;
  if (isnan(col.x)) col = vec3(0.95, 0.12, 0.55);
  outColor = vec4(col, 1.0);
}`;

const MARKUP = `
<canvas class="stage" role="img" aria-label="The surface, ray-marched on the GPU with the exact gradient and coloured by curvature. Drag to turn it; scroll to zoom."></canvas>
<aside class="panel" aria-label="Surface formula and controls">
  <header class="panel-head">
    <div>
      <p class="eyebrow">Exact gradients and Hessians on the GPU</p>
      <h1>Shapes from f(x, y, z) = 0</h1>
    </div>
    <button type="button" class="ghost" data-collapse aria-expanded="true">Hide</button>
  </header>
  <div class="panel-body">
    <div class="section" style="border:0;padding:0">
      <label class="field-label" for="shapes-input">The surface where this is zero</label>
      <div class="formula"><span aria-hidden="true">f =</span><input id="shapes-input" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
      <div class="presets" role="group" aria-label="Example shapes"></div>
      <p class="note" data-note></p>
    </div>
    <div class="section" aria-live="polite">
      <div class="status"><span class="chip" data-chip>Waiting for AngouriMath</span><span class="timing" data-timing></span></div>
      <p class="error" data-error></p>
      <div class="tex" data-latex></div>
    </div>
    <div class="section">
      <label class="field-label" for="shapes-mode">Colour by</label>
      <select id="shapes-mode">
        <option value="0">Mean curvature, from the Hessian</option>
        <option value="1">Gaussian curvature, from the Hessian</option>
        <option value="2">Normal direction, from the gradient</option>
      </select>
      <p class="foot">Blue is negative, orange positive. Nothing here is a finite difference: the gradient and all six second derivatives are AngouriMath’s, printed as GLSL.</p>
      <div class="row"><button type="button" class="ghost" data-spin>Stop turning</button></div>
    </div>
    <details class="section code" data-code>
      <summary>Generated shader</summary>
      ${CODE_BLOCK}
    </details>
  </div>
</aside>`;

export function mount(section, am) {
  html(section, MARKUP);
  const canvas = $(section, 'canvas'), panel = $(section, '.panel'), chip = $(section, '[data-chip]');
  collapsible(panel);
  const setCode = codeBlock($(section, '[data-code]'));
  const gl = canvas.getContext('webgl2', { antialias: false });
  const vao = gl && fullscreenTriangle(gl);
  let prog = null;
  const view = { yaw: 0.6, pitch: 0.35, dist: 5.6, spinning: !matchMedia('(prefers-reduced-motion: reduce)').matches, mode: 0 };

  const animation = loop((dt) => {
    if (!gl || !prog) return;
    if (view.spinning) view.yaw += dt * 0.25;
    const [w, h] = fitCanvas(canvas, 1.5);
    gl.viewport(0, 0, w, h);
    const cp = Math.cos(view.pitch), eye = [view.dist * cp * Math.sin(view.yaw), view.dist * Math.sin(view.pitch), view.dist * cp * Math.cos(view.yaw)];
    const fwd = eye.map((v) => -v / view.dist);
    const rl = Math.hypot(fwd[2], fwd[0]);
    const right = [-fwd[2] / rl, 0, fwd[0] / rl];
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    const tanY = Math.tan(22 * Math.PI / 180);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
    gl.useProgram(prog.program);
    gl.uniform3fv(prog.loc.uEye, eye);
    gl.uniform3fv(prog.loc.uFwd, fwd);
    gl.uniform3fv(prog.loc.uRight, right);
    gl.uniform3fv(prog.loc.uUp, up);
    gl.uniform2f(prog.loc.uTan, tanY * w / h, tanY);
    // With the panel on the left, centre the shape in the space to its right.
    gl.uniform1f(prog.loc.uShift, canvas.clientWidth > 900 ? 0.22 * tanY * w / h : 0);
    gl.uniform1i(prog.loc.uMode, view.mode);
    gl.uniform1f(prog.loc.uRadius, 2.0);
    gl.uniform3fv(prog.loc.uBg0, dark ? [0.03, 0.06, 0.09] : [0.80, 0.86, 0.89]);
    gl.uniform3fv(prog.loc.uBg1, dark ? [0.07, 0.12, 0.16] : [0.95, 0.97, 0.98]);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });

  let generation = 0;
  async function generate(text) {
    const mine = ++generation, t0 = performance.now();
    setChip(chip, '', 'Differentiating');
    let r;
    try {
      r = await am.json('ShapesJs', 'Generate', [text]);
    } catch (e) {
      if (mine === generation) { setChip(chip, 'bad', 'AngouriMath stopped'); $(section, '[data-error]').textContent = e.message; }
      return;
    }
    if (mine !== generation) return;
    $(section, '[data-timing]').textContent = `${Math.round(performance.now() - t0)} ms`;
    if (!r.ok) {
      setChip(chip, 'bad', 'No shader for this one');
      $(section, '[data-error]').textContent = `${r.error} The picture keeps the last shape that worked.`;
      return;
    }
    if (!gl) { setChip(chip, 'warn', 'No WebGL2 here'); return; }
    try {
      const next = linkProgram(gl, FULLSCREEN_VS, FS(r.glsl));
      if (prog) gl.deleteProgram(prog.program);
      prog = next;
    } catch (e) {
      setChip(chip, 'bad', 'The GPU did not accept the shader');
      $(section, '[data-error]').textContent = e.message;
      return;
    }
    setChip(chip, 'ok', 'Gradient and Hessian generated');
    $(section, '[data-error]').textContent = '';
    tex($(section, '[data-latex]'), r.latex);
    setCode(r.glsl, r.hlsl, 'field() for the sign test, fieldGrad() for each step, fieldHess() once at the surface.');
  }

  const input = $(section, '#shapes-input'), note = $(section, '[data-note]');
  const press = presets($(section, '.presets'), PRESETS, (p) => {
    input.value = p.formula;
    note.textContent = p.note;
    press(p.label);
    generate(p.formula);
  });
  input.value = PRESETS[0].formula;
  note.textContent = PRESETS[0].note;
  press(PRESETS[0].label);
  const later = debounce(() => generate(input.value), 450);
  input.addEventListener('input', () => { press(null); note.textContent = ''; later(); });

  $(section, '#shapes-mode').addEventListener('change', (e) => { view.mode = +e.target.value; });
  const spin = $(section, '[data-spin]');
  const syncSpin = () => { spin.textContent = view.spinning ? 'Stop turning' : 'Turn'; };
  spin.addEventListener('click', () => { view.spinning = !view.spinning; syncSpin(); });
  syncSpin();
  if (matchMedia('(min-width: 900px)').matches) $(section, '[data-code]').open = false;

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw -= (e.clientX - drag.x) * 0.008;
    view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + (e.clientY - drag.y) * 0.008));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = Math.max(2.4, Math.min(9, view.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

  generate(input.value);
  return { show: () => animation.start(), hide: () => animation.stop() };
}
