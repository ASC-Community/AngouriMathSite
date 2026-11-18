import { $, html, escapeHtml, setChip, presets, collapsible, tex, token, debounce, linkProgram, fullscreenTriangle, FULLSCREEN_VS, fitCanvas, rgb, codeBlock, CODE_BLOCK } from '../shared.js';
import { numberLine, niceStep } from './representations.js';

const PRESETS = [
  { label: 'Disk and half-plane', formula: 'x^2 + y^2 < 4 and y > x - 1',
    note: 'The two boundaries meet where AngouriMath solves the circle and the line together: exactly, with square roots.' },
  { label: 'Lens', formula: 'y > x^2 - 2 and y < 2 - x^2' },
  { label: 'Ring', formula: 'x^2 + y^2 > 1 and x^2 + y^2 < 4' },
  { label: 'Hyperbolas', formula: 'x y > 1 or x y < -1' },
  { label: 'Under a wave', formula: 'y < sin(x) + x / 3 and y > -2',
    note: 'The boundary is drawn exactly by its gradient, though AngouriMath cannot solve sin(x) + x/3 = -2 for x.' },
  { label: 'On the line: x³ − x > 0', formula: 'x^3 - x > 0', note: 'With only x, the answer is a set of numbers.' },
  { label: 'On the line: a set', formula: '[1; 3) \\/ (2; 5] \\/ {7}', note: 'Intervals and points; AngouriMath merges the overlap.' },
];

const MARKUP = `
<canvas class="stage" role="img" aria-label="The region in the plane, shaded on the GPU, with its exact boundaries. Drag to pan; scroll to zoom."></canvas>
<canvas class="stage" data-overlay style="pointer-events:none" aria-hidden="true"></canvas>
<aside class="panel" aria-label="Region formula and results">
  <header class="panel-head">
    <div>
      <p class="eyebrow">Comparisons, solved and drawn</p>
      <h1>Regions and sets</h1>
    </div>
    <button type="button" class="ghost" data-collapse aria-expanded="true">Hide</button>
  </header>
  <div class="panel-body">
    <div class="section" style="border:0;padding:0">
      <label class="field-label" for="regions-input">A comparison in x and y, one in x alone, or a set</label>
      <div class="formula"><span aria-hidden="true">R :</span><input id="regions-input" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
      <div class="presets" role="group" aria-label="Examples"></div>
      <p class="note" data-note></p>
      <div class="status"><span class="chip" data-chip>Waiting for AngouriMath</span><span class="timing" data-timing></span></div>
      <p class="error" data-error></p>
    </div>
    <div class="section" data-plane>
      <div class="labelled"><span>Solved for y by AngouriMath</span><div class="tex" data-solved></div></div>
      <div class="labelled"><span>Boundaries, each drawn from its exact gradient</span><div data-edges></div></div>
      <div class="labelled"><span>Where boundaries cross, solved exactly (dots)</span><div data-points></div></div>
    </div>
    <div class="section" data-line hidden>
      <div class="labelled"><span data-how>Result</span><div class="tex" data-set></div></div>
      <div data-numberline></div>
    </div>
    <details class="section code" data-code>
      <summary>Generated shader</summary>
      ${CODE_BLOCK}
    </details>
  </div>
</aside>`;

const FS = (fns, edgeCount) => `#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec2 uCenter, uHalf;
uniform float uPixel, uStep;
uniform vec3 uBg, uFill, uInk, uRule, uEdge;
out vec4 outColor;
${fns}
void main() {
  vec2 p = uCenter + vNdc * uHalf;
  vec3 col = regionInside(p) ? mix(uBg, uFill, 0.32) : uBg;
  vec2 g = abs(fract(p / uStep + 0.5) - 0.5) * uStep / uPixel;
  col = mix(col, uRule, 0.55 * (1.0 - smoothstep(0.0, 1.0, min(g.x, g.y))));
  vec2 a = abs(p) / uPixel;
  col = mix(col, uInk, 0.5 * (1.0 - smoothstep(0.5, 1.5, min(a.x, a.y))));
  float lines = 0.0;
  ${Array.from({ length: edgeCount }, (_, i) => `{
    vec3 r = edge${i}(p);
    // |g| / |grad g| is the distance to the curve g = 0, to first order: exact-width lines.
    float d = abs(r.x) / max(length(r.yz), 1e-6) / uPixel;
    lines = max(lines, 1.0 - smoothstep(0.8, 2.0, d));
  }`).join('\n  ')}
  col = mix(col, uEdge, lines);
  outColor = vec4(col, 1.0);
}`;

export function mount(section, am) {
  html(section, MARKUP);
  const [canvas, overlay] = section.querySelectorAll('canvas');
  const chip = $(section, '[data-chip]');
  collapsible($(section, '.panel'));
  const setCode = codeBlock($(section, '[data-code]'));
  const gl = canvas.getContext('webgl2', { antialias: false });
  const vao = gl && fullscreenTriangle(gl);
  let prog = null, points = [], dims = 2;
  const view = { cx: 0, cy: 0, half: 3.2 };

  function draw() {
    const [w, h] = fitCanvas(canvas, 1.75);
    const [ow, oh] = fitCanvas(overlay, 1.75);
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, ow, oh);
    if (!gl) return;
    gl.viewport(0, 0, w, h);
    if (dims !== 2 || !prog) { gl.clearColor(...rgb('--surface'), 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const aspect = w / h, hx = aspect >= 1 ? view.half * aspect : view.half, hy = aspect >= 1 ? view.half : view.half / aspect;
    const pixel = 2 * hx / w, step = niceStep(hy / 4);
    // With the panel on the left, the origin sits in the middle of the uncovered part.
    const cx = view.cx - hx * (canvas.clientWidth > 900 ? 450 / canvas.clientWidth : 0), cy = view.cy;
    gl.useProgram(prog.program);
    gl.uniform2f(prog.loc.uCenter, cx, cy);
    gl.uniform2f(prog.loc.uHalf, hx, hy);
    gl.uniform1f(prog.loc.uPixel, pixel);
    gl.uniform1f(prog.loc.uStep, step);
    gl.uniform3fv(prog.loc.uBg, rgb('--surface'));
    gl.uniform3fv(prog.loc.uFill, rgb('--plot-1'));
    gl.uniform3fv(prog.loc.uInk, rgb('--ink'));
    gl.uniform3fv(prog.loc.uRule, rgb('--rule'));
    gl.uniform3fv(prog.loc.uEdge, rgb('--plot-2'));
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Labels and the exact crossing points, on a 2D canvas above.
    const s = ow / overlay.clientWidth;
    const X = (x) => (x - cx + hx) / (2 * hx) * ow, Y = (y) => oh - (y - cy + hy) / (2 * hy) * oh;
    ctx.font = `${11 * s}px ${token('--font-body')}`;
    ctx.fillStyle = token('--ink-soft');
    for (let x = Math.ceil((cx - hx) / step) * step; x <= cx + hx; x += step)
      if (Math.abs(x) > step / 2) ctx.fillText(+x.toFixed(6) + '', X(x) + 3 * s, Math.min(Math.max(Y(0) + 13 * s, 13 * s), oh - 4 * s));
    for (let y = Math.ceil((cy - hy) / step) * step; y <= cy + hy; y += step)
      if (Math.abs(y) > step / 2) ctx.fillText(+y.toFixed(6) + '', Math.min(Math.max(X(0) + 4 * s, 4 * s), ow - 40 * s), Y(y) - 3 * s);
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 5 * s, 0, Math.PI * 2);
      ctx.fillStyle = token('--surface');
      ctx.fill();
      ctx.lineWidth = 2.2 * s;
      ctx.strokeStyle = token('--ink');
      ctx.stroke();
    }
  }

  let generation = 0;
  async function analyze(text) {
    const mine = ++generation, t0 = performance.now();
    setChip(chip, '', 'Working');
    let r;
    try {
      r = await am.json('RegionsJs', 'Analyze', [text]);
    } catch (e) {
      if (mine === generation) { setChip(chip, 'bad', 'AngouriMath stopped'); $(section, '[data-error]').textContent = e.message; }
      return;
    }
    if (mine !== generation) return;
    $(section, '[data-timing]').textContent = `${Math.round(performance.now() - t0)} ms`;
    if (!r.ok) { setChip(chip, 'warn', 'Nothing to draw yet'); $(section, '[data-error]').textContent = r.error; return; }
    $(section, '[data-error]').textContent = '';
    dims = r.dims;
    $(section, '[data-plane]').hidden = dims !== 2;
    $(section, '[data-line]').hidden = dims !== 1;
    $(section, '[data-code]').hidden = dims !== 2;
    if (dims === 1) {
      setChip(chip, 'ok', 'A set of numbers');
      $(section, '[data-how]').textContent = `AngouriMath, ${r.how}`;
      tex($(section, '[data-set]'), r.setLatex);
      $(section, '[data-numberline]').replaceChildren(r.intervals ? numberLine(r.intervals) : document.createTextNode(r.set));
      points = [];
      draw();
      return;
    }
    try {
      const next = linkProgram(gl, FULLSCREEN_VS, FS(r.glsl, r.edges.length));
      if (prog) gl.deleteProgram(prog.program);
      prog = next;
    } catch (e) {
      setChip(chip, 'bad', 'The GPU did not accept the shader');
      $(section, '[data-error]').textContent = e.message;
      return;
    }
    setChip(chip, 'ok', 'Region drawn on the GPU');
    tex($(section, '[data-solved]'), r.solvedYLatex || '\\text{not solved}');
    $(section, '[data-edges]').replaceChildren(...r.edges.map((e) => { const d = document.createElement('div'); d.className = 'tex'; tex(d, e.latex); return d; }));
    points = r.points;
    $(section, '[data-points]').innerHTML = r.points.length
      ? r.points.map((p) => `<div class="foot" style="font-family:var(--font-mono)">${escapeHtml(p.text)} ≈ (${p.x.toPrecision(5)}, ${p.y.toPrecision(5)})</div>`).join('')
      : '<p class="foot">None found.</p>';
    setCode(r.glsl, '', 'regionInside() is the statement itself; each edgeN() returns g, ∂g/∂x and ∂g/∂y for one boundary g = 0.');
    draw();
  }

  const input = $(section, '#regions-input'), note = $(section, '[data-note]');
  const press = presets($(section, '.presets'), PRESETS, (p) => {
    input.value = p.formula;
    note.textContent = p.note || '';
    press(p.label);
    view.cx = 0; view.cy = 0; view.half = 3.2;
    analyze(p.formula);
  });
  input.value = PRESETS[0].formula;
  note.textContent = PRESETS[0].note;
  press(PRESETS[0].label);
  const later = debounce(() => analyze(input.value), 450);
  input.addEventListener('input', () => { press(null); note.textContent = ''; later(); });

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = 2 * view.half / Math.min(canvas.clientWidth, canvas.clientHeight);
    view.cx -= (e.clientX - drag.x) * k;
    view.cy += (e.clientY - drag.y) * k;
    drag = { x: e.clientX, y: e.clientY };
    draw();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.half = Math.max(0.05, Math.min(200, view.half * Math.exp(e.deltaY * 0.0012))); draw(); }, { passive: false });
  const ro = new ResizeObserver(draw);
  ro.observe(canvas);

  analyze(input.value);
  return { show: () => draw(), hide() {} };
}
