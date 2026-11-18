import { $, html, setChip, presets, codeBlock, CODE_BLOCK, collapsible, linkProgram, fitCanvas, loop, fullscreenTriangle, FULLSCREEN_VS } from '../shared.js';

// A wind sea as WAVE_COUNT wave trains, longest first. A handful of plane waves interfere into a
// lattice the eye finds at once; a sea is a spectrum. So the wavelengths are one per band of a
// logarithmic split of LONGEST..SHORTEST, jittered within the band so that none is a multiple of
// another; the headings spread about the wind, wider for shorter waves; each train starts at a
// random phase (an offset of the surface point); and the weights follow Pierson–Moskowitz.
// In deep water that spectrum gives each logarithmic band the same slope variance above the peak
// and exp(-1.25 (λ/λp)²) of it below, so weight² is that factor, normalised to a sum of 1: the
// slider is then the sea's RMS slope. Seeded, so the sea is the same on every visit.
const WAVE_COUNT = 32, LONGEST = 80, SHORTEST = 1.2, PEAK = 35;
const WAVES = () => {
  let seed = 0x5eed;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const waves = Array.from({ length: WAVE_COUNT }, (_, i) => {
    const lambda = LONGEST * Math.pow(SHORTEST / LONGEST, (i + random()) / WAVE_COUNT);
    const spread = 0.25 + 0.55 * i / (WAVE_COUNT - 1);
    return {
      lambda, k: 2 * Math.PI / lambda, turn: spread * gaussian(), off: [2000 * random(), 2000 * random()],
      weight: Math.exp(-0.625 * (lambda / PEAK) ** 2), t: 0, omega: NaN,
    };
  });
  const norm = Math.hypot(...waves.map((w) => w.weight));
  for (const w of waves) w.weight /= norm;
  return waves;
};
const LONG_LABEL = `${Math.round(WAVES()[0].lambda)} m`, SHORT_LABEL = `${WAVES()[WAVE_COUNT - 1].lambda.toFixed(1)} m`;

const PRESETS = [
  { label: 'Any depth', formula: 'sqrt(g k (1 - 2/(e^(2 k h) + 1)))',
    note: 'ω² = g k tanh(k h), with tanh written so that 32-bit floats never overflow.' },
  { label: 'tanh as typed', formula: 'sqrt(g k tanh(k h))',
    note: 'AngouriMath reads tanh(x) as (e^2x − 1)/(e^2x + 1), and on the GPU e^2x overflows once k h passes 44. The shader printer writes the ratio as 1 − 2/(e^2x + 1), which is 1 there: drag the depth past 14 m.' },
  { label: 'Deep water', formula: 'sqrt(g k)', note: 'The depth drops out, and long waves outrun short ones.' },
  { label: 'Shallow water', formula: 'k sqrt(g h)', note: 'Every wave travels at √(g h), whatever its length.' },
  { label: 'A typo', formula: 'sqrt(g k h)', note: 'The depth in the wrong place. The units check finds where.' },
];

// The default formula's shader, printed by the same code before this page was built, so the
// sea is there while AngouriMath loads.
const INITIAL_GLSL = `vec3 waveHeightSlope(vec2 p, float t, float A, float k, float h, vec2 dir)
{
    vec3 r;
    float am0 = ((k * ((dir.x * p.x) + (dir.y * p.y))) - (sqrt(((WAVE_G * k) * (1.0 - (2.0 / (exp(((2.0 * k) * h)) + 1.0))))) * t));
    float am1 = cos(am0);
    r.x = (A * sin(am0));
    r.y = ((am1 * (dir.x * k)) * A);
    r.z = ((am1 * (dir.y * k)) * A);
    return r;
}
`;
const INITIAL_HLSL = `float3 waveHeightSlope(float2 p, float t, float A, float k, float h, float2 dir)
{
    float3 r;
    float am0 = ((k * ((dir.x * p.x) + (dir.y * p.y))) - (sqrt(((WAVE_G * k) * (1.0 - (2.0 / (exp(((2.0 * k) * h)) + 1.0))))) * t));
    float am1, am2;
    sincos(am0, am1, am2);
    r.x = (A * am1);
    r.y = ((am2 * (dir.x * k)) * A);
    r.z = ((am2 * (dir.y * k)) * A);
    return r;
}
`;

const GRID = 320, EXTENT = 900, FOV = 55 * Math.PI / 180;
const SUN = (() => { const v = [0.0, 0.22, -1.0], l = Math.hypot(...v); return v.map((x) => x / l); })();

const HEADER = `#version 300 es
precision highp float;
precision highp int;
#define WAVE_COUNT ${WAVE_COUNT}
uniform vec4 uWave[WAVE_COUNT];   // A, k, t, unused
uniform vec4 uDirOff[WAVE_COUNT]; // direction of travel, offset of the surface point
uniform float uDepth;
uniform vec3 uCam;
uniform vec3 uSun;
#define WAVE_G 9.81
`;

const SKY = `
vec3 sky(vec3 d) {
  vec3 horizon = vec3(0.72, 0.80, 0.84);
  vec3 zenith = vec3(0.17, 0.37, 0.62);
  vec3 below = vec3(0.03, 0.08, 0.12);
  vec3 c = d.y >= 0.0 ? mix(horizon, zenith, pow(d.y, 0.45)) : mix(horizon, below, smoothstep(0.0, 0.25, -d.y));
  float s = max(dot(d, uSun), 0.0);
  return c + vec3(1.0, 0.86, 0.62) * (0.12 * pow(s, 8.0) + 0.3 * pow(s, 90.0))
           + vec3(1.0, 0.95, 0.86) * 3.0 * smoothstep(0.99984, 0.99993, s);
}
`;

const SEA_VS = `
in vec2 aGrid;
uniform mat4 uViewProj;
uniform float uExtent;
out vec3 vWorld;
void main() {
  // Quadratic spacing: dense under the camera, coarse at the horizon.
  vec2 u = aGrid;
  vec2 xz = uCam.xz + sign(u) * u * u * uExtent;
  float cell = 4.0 * max(abs(u.x), abs(u.y)) * uExtent / ${GRID.toFixed(1)};
  float y = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    float lambda = 6.2831853 / uWave[i].y;
    float w = 1.0 - smoothstep(0.25 * lambda, 0.5 * lambda, cell);
    if (w > 0.0)
      y += w * waveHeightSlope(xz + uDirOff[i].zw, uWave[i].z, uWave[i].x, uWave[i].y, uDepth, uDirOff[i].xy).x;
  }
  vWorld = vec3(xz.x, y, xz.y);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`;

const SEA_FS = `
in vec3 vWorld;
uniform vec3 uBody;
uniform float uMaxA;
out vec4 outColor;
void main() {
  // The normal comes from the exact slope at every pixel, not from the mesh. Waves shorter
  // than the pixel footprint fade out instead of sparkling.
  vec2 xz = vWorld.xz;
  float footprint = max(length(dFdx(xz)), length(dFdy(xz)));
  vec2 slope = vec2(0.0);
  bool broken = false;
  for (int i = 0; i < WAVE_COUNT; i++) {
    float lambda = 6.2831853 / uWave[i].y;
    float w = 1.0 - smoothstep(0.15 * lambda, 0.5 * lambda, footprint);
    if (w <= 0.0) continue;
    vec3 r = waveHeightSlope(xz + uDirOff[i].zw, uWave[i].z, uWave[i].x, uWave[i].y, uDepth, uDirOff[i].xy);
    if (isnan(r.y) || isinf(r.y) || isnan(r.z) || isinf(r.z)) broken = true;
    slope += w * r.yz;
  }
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 v = normalize(uCam - vWorld);
  float fresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  float crest = clamp(vWorld.y / max(uMaxA, 1e-3) * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = uBody * (0.75 + 0.5 * crest);
  vec3 col = mix(body, sky(r), fresnel) + vec3(1.0, 0.9, 0.72) * 2.5 * pow(max(dot(r, uSun), 0.0), 700.0);
  float dist = length(uCam - vWorld);
  col = mix(col, sky(normalize(vec3(-v.x, 0.0, -v.z))), 1.0 - exp(-dist * 0.0022));
  if (broken) col = mix(col, vec3(0.95, 0.12, 0.55), 0.85);
  outColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

const SKY_FS = `
in vec2 vNdc;
uniform vec3 uFwd, uRight, uUp;
uniform vec2 uTan;
out vec4 outColor;
void main() {
  vec3 d = normalize(uFwd + vNdc.x * uTan.x * uRight + vNdc.y * uTan.y * uUp);
  outColor = vec4(min(sky(d), vec3(1.0)), 1.0);
}
`;

const MARKUP = `
<canvas class="stage" role="img" aria-label="A sea surface, drawn by the shader AngouriMath generated from the formula in the panel. Drag to look around."></canvas>
<aside class="panel" aria-label="Wave formula and controls">
  <header class="panel-head">
    <div>
      <p class="eyebrow">Units checking and shader output</p>
      <h1>Waves from ω² = g k tanh(k h)</h1>
    </div>
    <button type="button" class="ghost" data-collapse aria-expanded="true">Hide</button>
  </header>
  <div class="panel-body">
    <div class="section" style="border:0;padding:0">
      <label class="field-label" for="waves-omega">The wave's frequency ω as a formula in g, k and h</label>
      <div class="formula"><span aria-hidden="true">ω =</span><input id="waves-omega" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
      <div class="presets" role="group" aria-label="Example formulas"></div>
      <p class="note" data-note></p>
    </div>
    <div class="section" aria-live="polite">
      <div class="status"><span class="chip" data-chip>Waiting for AngouriMath</span><span class="timing" data-timing></span></div>
      <dl class="checks">
        <dt>ω</dt><dd data-omega>–</dd>
        <dt>in the phase</dt><dd data-phase>–</dd>
      </dl>
      <p class="note" data-kept hidden style="color:var(--warn)">The sea keeps the last formula that passed.</p>
    </div>
    <div class="section">
      <div class="slider">
        <label for="waves-depth">Water depth h</label><output data-depth-out></output>
        <input id="waves-depth" type="range" min="0" max="1000" step="1" value="620">
      </div>
      <div class="slider">
        <label for="waves-steep">Steepness of the sea, RMS of k A</label><output data-steep-out></output>
        <input id="waves-steep" type="range" min="0" max="100" step="1" value="50">
      </div>
      <div class="slider">
        <label for="waves-heading">Wind direction</label><output data-heading-out></output>
        <input id="waves-heading" type="range" min="0" max="359" step="1" value="90">
      </div>
      <div class="row"><button type="button" class="ghost" data-play>Pause</button></div>
    </div>
    <div class="section">
      <dl class="stats">
        <div><dt>${LONG_LABEL} waves travel at</dt><dd data-c-long>–</dd></div>
        <div><dt>${SHORT_LABEL} waves travel at</dt><dd data-c-short>–</dd></div>
        <div><dt>k h ranges over</dt><dd data-kh>–</dd></div>
      </dl>
      <p class="note" data-regime></p>
      <p class="note">Independent knobs, found by AngouriMath (Buckingham π): <code data-groups>k * A, k * h, g * k * t ^ 2</code></p>
    </div>
    <details class="section code" data-code>
      <summary>Generated shader</summary>
      ${CODE_BLOCK}
    </details>
    <p class="foot">Linear (Airy) waves: ${WAVE_COUNT} trains from ${SHORT_LABEL} to ${LONG_LABEL} long, weighted by the Pierson–Moskowitz spectrum with its peak at ${PEAK} m, headings spread about the wind and random phases; amplitudes capped at a fifth of the depth. The phase is k (dx px + dz pz) − ω t, for the surface point (px, pz) and the direction of travel (dx, dz). Units declared to AngouriMath: A, h, px and pz in L; k in L⁻¹; g in L T⁻²; t in T.</p>
  </div>
</aside>`;

export function mount(section, am) {
  html(section, MARKUP);
  const panel = $(section, '.panel'), canvas = $(section, 'canvas');
  collapsible(panel);
  const setCode = codeBlock($(section, '[data-code]'));
  setCode(INITIAL_GLSL, INITIAL_HLSL, 'Generated ahead of time from the default formula; AngouriMath replaces it once it has loaded.');
  if (matchMedia('(min-width: 900px)').matches) $(section, '[data-code]').open = true;

  const waves = WAVES();
  const state = {
    depth: 8, steep: 0.1, heading: Math.PI / 2,
    playing: !matchMedia('(prefers-reduced-motion: reduce)').matches, yaw: 0, pitch: -0.13,
  };

  // ------------------------------------------------------------ WebGL
  const gl = canvas.getContext('webgl2', { antialias: true });
  let sea = null, skyProg = null, seaVao = null, skyVao = null, indexCount = 0;

  function buildSea(fn) {
    const next = linkProgram(gl, HEADER + fn + SEA_VS, HEADER + fn + SKY + SEA_FS, 'aGrid');
    if (sea) gl.deleteProgram(sea.program);
    sea = next;
  }

  if (gl) {
    skyProg = linkProgram(gl, FULLSCREEN_VS, HEADER + SKY + SKY_FS);
    skyVao = fullscreenTriangle(gl);
    const verts = new Float32Array((GRID + 1) * (GRID + 1) * 2);
    let p = 0;
    for (let j = 0; j <= GRID; j++)
      for (let i = 0; i <= GRID; i++) { verts[p++] = i / GRID * 2 - 1; verts[p++] = j / GRID * 2 - 1; }
    const idx = new Uint32Array(GRID * GRID * 6);
    let q = 0;
    for (let j = 0; j < GRID; j++)
      for (let i = 0; i < GRID; i++) {
        const a = j * (GRID + 1) + i, b = a + 1, c = a + GRID + 1, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    indexCount = idx.length;
    seaVao = gl.createVertexArray();
    gl.bindVertexArray(seaVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    buildSea(INITIAL_GLSL);
  }

  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function camera(aspect) {
    const eye = [0, 5.5, 0];
    const fwd = [Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch)];
    const right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
    const f = 1 / Math.tan(FOV / 2), near = 0.1, far = 3000, nf = 1 / (near - far);
    const view = [right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0,
      -dot(right, eye), -dot(up, eye), dot(fwd, eye), 1];
    const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    const vp = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += proj[k * 4 + r] * view[c * 4 + k];
        vp[c * 4 + r] = s;
      }
    return { eye, fwd, right, up, vp, tan: [Math.tan(FOV / 2) * aspect, Math.tan(FOV / 2)] };
  }

  const amplitude = (w) => Math.min(state.steep * w.weight / w.k, 0.2 * state.depth);
  function bodyColour() {
    const t = Math.min(Math.max(Math.log(state.depth / 0.5) / Math.log(40 / 0.5), 0), 1);
    const shallow = [0.10, 0.42, 0.42], deep = [0.02, 0.10, 0.16];
    return shallow.map((s, i) => s + (deep[i] - s) * t);
  }

  const waveData = new Float32Array(4 * WAVE_COUNT), dirData = new Float32Array(4 * WAVE_COUNT);
  const animation = loop((dt) => {
    if (!gl) return;
    if (state.playing) for (const w of waves) w.t += dt;
    const [width, height] = fitCanvas(canvas);
    gl.viewport(0, 0, width, height);
    const cam = camera(width / height);
    // The height the crest shading spans: random phases rarely line up, so not the sum of the
    // amplitudes but a multiple of the RMS height, about the significant wave height.
    let sumSquares = 0;
    waves.forEach((w, i) => {
      const a = amplitude(w), angle = state.heading + w.turn;
      sumSquares += a * a;
      waveData.set([a, w.k, w.t, 0], i * 4);
      dirData.set([Math.cos(angle), Math.sin(angle), w.off[0], w.off[1]], i * 4);
    });
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(skyProg.program);
    gl.uniform3fv(skyProg.loc.uSun, SUN);
    gl.uniform3fv(skyProg.loc.uFwd, cam.fwd);
    gl.uniform3fv(skyProg.loc.uRight, cam.right);
    gl.uniform3fv(skyProg.loc.uUp, cam.up);
    gl.uniform2fv(skyProg.loc.uTan, cam.tan);
    gl.bindVertexArray(skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const L = sea.loc;
    gl.useProgram(sea.program);
    gl.uniformMatrix4fv(L.uViewProj, false, cam.vp);
    gl.uniform3fv(L.uCam, cam.eye);
    gl.uniform3fv(L.uSun, SUN);
    gl.uniform1f(L.uExtent, EXTENT);
    gl.uniform1f(L.uDepth, state.depth);
    gl.uniform1f(L.uMaxA, 2 * Math.sqrt(sumSquares));
    gl.uniform3fv(L.uBody, bodyColour());
    gl.uniform4fv(L.uWave, waveData);
    gl.uniform4fv(L.uDirOff, dirData);
    gl.bindVertexArray(seaVao);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
  });

  // ------------------------------------------------------------ physics readout

  let amReady = false;
  // Each wave keeps its phase when its frequency changes: t is rescaled so that omega t stays.
  async function refreshOmegas() {
    const ks = waves.map((w) => w.k);
    let next;
    try {
      next = amReady ? await am.call('WavesJs', 'Omegas', [ks, state.depth]) : null;
    } catch { next = null; }
    next ??= ks.map((k) => Math.sqrt(9.81 * k * Math.tanh(k * state.depth)));
    waves.forEach((w, i) => {
      const o = next[i];
      if (Number.isFinite(w.omega) && w.omega > 0 && Number.isFinite(o) && o > 0) w.t *= w.omega / o;
      w.omega = o ?? NaN;
    });
    updateReadout();
  }

  const speed = (w) => { const c = w.omega / w.k; return Number.isFinite(c) ? `${c.toFixed(1)} m/s` : 'no speed'; };
  function updateReadout() {
    const long = waves[0], short = waves[waves.length - 1];
    $(section, '[data-c-long]').textContent = speed(long);
    $(section, '[data-c-short]').textContent = speed(short);
    const lo = long.k * state.depth, hi = short.k * state.depth;
    $(section, '[data-kh]').textContent = `${lo < 1 ? lo.toFixed(2) : lo.toFixed(1)} to ${hi < 10 ? hi.toFixed(1) : hi.toFixed(0)}`;
    let regime;
    if (hi < 0.3) regime = 'Shallow for every wave (k h < 0.3): all of them travel at √(g h).';
    else if (lo > Math.PI) regime = 'Deep for every wave (k h > π): the bottom no longer matters.';
    else if (lo < 0.3 && hi > Math.PI) regime = 'Shallow for the longest waves, deep for the shortest.';
    else regime = 'Between shallow and deep water for most of the waves.';
    $(section, '[data-regime]').textContent = regime;
  }

  // ------------------------------------------------------------ AngouriMath

  const chip = $(section, '[data-chip]');
  let generation = 0;
  async function generate(text) {
    const mine = ++generation;
    let r;
    const t0 = performance.now();
    try {
      r = await am.json('WavesJs', 'Generate', [text]);
    } catch (e) {
      if (mine !== generation) return;
      setChip(chip, 'bad', 'AngouriMath stopped');
      $(section, '[data-phase]').textContent = e.message;
      return;
    }
    if (mine !== generation) return;
    $(section, '[data-timing]').textContent = `checked and generated in ${Math.round(performance.now() - t0)} ms`;
    $(section, '[data-omega]').textContent = r.omega || '–';
    $(section, '[data-phase]').textContent = r.phase || '–';
    if (r.ok) {
      try {
        if (gl) buildSea(r.glsl);
        setCode(r.glsl, r.hlsl, `Generated by AngouriMath in this tab from ω = ${text.trim()}`);
        setChip(chip, 'ok', 'Units agree: shader generated');
        $(section, '[data-kept]').hidden = true;
        refreshOmegas();
      } catch (e) {
        setChip(chip, 'bad', 'The GPU did not accept the shader');
        $(section, '[data-phase]').textContent = String(e.message || e);
        $(section, '[data-kept]').hidden = false;
      }
    } else {
      if ((r.omega || '').startsWith('Could not read')) setChip(chip, 'warn', 'Not a formula yet');
      else if (r.kind === 'Undetermined') setChip(chip, 'warn', 'Units unknown');
      else if (r.kind === 'Inconsistent') setChip(chip, 'bad', 'Units disagree: rejected');
      else { setChip(chip, 'bad', 'No shader form'); $(section, '[data-phase]').textContent = r.reason || r.phase; }
      $(section, '[data-kept]').hidden = false;
    }
  }

  // ------------------------------------------------------------ controls

  const input = $(section, '#waves-omega'), note = $(section, '[data-note]');
  const press = presets($(section, '.presets'), PRESETS, (p) => {
    input.value = p.formula;
    note.textContent = p.note;
    press(p.label);
    generate(p.formula);
  });
  input.value = PRESETS[0].formula;
  note.textContent = PRESETS[0].note;
  press(PRESETS[0].label);
  let debounce = 0;
  input.addEventListener('input', () => {
    press(null);
    note.textContent = '';
    clearTimeout(debounce);
    debounce = setTimeout(() => generate(input.value), 350);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(debounce); generate(input.value); } });

  const depth = $(section, '#waves-depth'), steep = $(section, '#waves-steep'), heading = $(section, '#waves-heading');
  const syncDepth = () => {
    state.depth = 0.3 * Math.pow(200, +depth.value / 1000);
    const h = state.depth;
    $(section, '[data-depth-out]').textContent = h < 1 ? `${h.toFixed(2)} m` : h < 10 ? `${h.toFixed(1)} m` : `${h.toFixed(0)} m`;
    refreshOmegas();
  };
  const syncSteep = () => { state.steep = +steep.value / 500; $(section, '[data-steep-out]').textContent = state.steep.toFixed(3); };
  const syncHeading = () => { state.heading = +heading.value * Math.PI / 180; $(section, '[data-heading-out]').textContent = `${heading.value}°`; };
  depth.addEventListener('input', syncDepth);
  steep.addEventListener('input', syncSteep);
  heading.addEventListener('input', syncHeading);
  syncDepth(); syncSteep(); syncHeading();

  const play = $(section, '[data-play]');
  const syncPlay = () => { play.textContent = state.playing ? 'Pause' : 'Play'; };
  play.addEventListener('click', () => { state.playing = !state.playing; syncPlay(); });
  syncPlay();

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.yaw += (e.clientX - drag.x) * 0.004;
    state.pitch = Math.min(0.15, Math.max(-0.75, state.pitch - (e.clientY - drag.y) * 0.004));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });

  am.call('WavesJs', 'Groups').then((groups) => {
    amReady = true;
    $(section, '[data-groups]').textContent = groups.join(', ');
    generate(input.value);
  }).catch(() => {});

  if (!gl) $(section, '[data-regime]').textContent = 'This browser has no WebGL2, so the sea cannot be drawn. AngouriMath still checks the formulas.';
  return { show: () => animation.start(), hide: () => animation.stop() };
}
