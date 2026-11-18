import { $, html, setChip, presets, collapsible, tex, token, debounce, fitCanvas } from '../shared.js';
import { niceStep } from './representations.js';

const PRESETS = [
  { label: 'Cubic', formula: 'x^3 - 3x + 1', area: [-1, 1], range: [-3, 3],
    note: 'Three real roots, which AngouriMath gives exactly by Cardano’s formula: through complex cube roots, although all three are real.' },
  { label: 'sin(x)/x', formula: 'sin(x) / x', area: [0, 2], point: 1, range: [-16, 16], at: '0',
    note: 'Roots come back as a family over every whole n, 2πn and π + 2πn, with the condition that excludes 0. The antiderivative is the sine integral Si.' },
  { label: 'Gaussian bump', formula: 'x e^(-x^2)', area: [0, 2], range: [-3, 3] },
  { label: 'ln(x)/x', formula: 'ln(x) / x', area: [1, 4], point: 1, range: [-1, 9], at: '0', note: 'Defined for x > 0 only; the plot leaves the rest empty.' },
  { label: 'Double well', formula: 'x^4 - 2x^2', area: [-1, 1], range: [-2.2, 2.2] },
  { label: 'e^x', formula: 'e^x', area: [0, 1], range: [-3, 2.5], at: '-oo', note: 'Its own derivative and antiderivative; the Taylor polynomials are the familiar partial sums.' },
  { label: 'Asymptotes', formula: '(2x^2 - 1) / (x^2 - 4)', area: [-1, 1], range: [-6, 6], at: '2',
    note: 'Poles at x = ±2, where the one-sided limits go off to opposite infinities, and the line y = 2 that f approaches at both ends.' },
  { label: 'A hole', formula: '(x^2 - 1) / (x - 1)', area: [-1, 2], range: [-3, 3], at: '1',
    note: 'The line y = x + 1 with the point x = 1 taken out: f has no value there, but its limit is 2.' },
];

const CURVES = [
  { key: 'f', label: 'f', color: '--plot-1', on: true },
  { key: 'd1', label: 'f′', color: '--plot-2', on: true },
  { key: 'd2', label: 'f″', color: '--plot-3', on: false },
  { key: 'F', label: '∫ f dx', color: '--plot-4', on: false },
  { key: 'taylor', label: 'Taylor', color: '--plot-5', on: true, dashed: true },
];

const MARKUP = `
<canvas class="stage" role="img" aria-label="Plot of f with its derivatives, antiderivative, Taylor polynomial, special points and the shaded area. Drag to pan; scroll to zoom; double-click to reset."></canvas>
<aside class="panel" aria-label="Function and results">
  <header class="panel-head">
    <div>
      <p class="eyebrow">Exact derivatives, integrals and solutions</p>
      <h1>Calculus of f(x)</h1>
    </div>
    <button type="button" class="ghost" data-collapse aria-expanded="true">Hide</button>
  </header>
  <div class="panel-body">
    <div class="section" style="border:0;padding:0">
      <label class="field-label" for="calc-input">A function of x</label>
      <div class="formula"><span aria-hidden="true">f =</span><input id="calc-input" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
      <div class="presets" role="group" aria-label="Example functions"></div>
      <p class="note" data-note></p>
      <div class="status"><span class="chip" data-chip>Waiting for AngouriMath</span><span class="timing" data-timing></span></div>
      <p class="error" data-error></p>
    </div>
    <div class="section">
      <div class="row" data-toggles></div>
      <div class="labelled"><span>f′(x)</span><div class="tex" data-d1></div></div>
      <div class="labelled"><span>f″(x)</span><div class="tex" data-d2></div></div>
      <div class="labelled"><span>∫ f(x) dx</span><div class="tex" data-integral></div></div>
    </div>
    <div class="section">
      <div class="labelled"><span>Roots, solving f = 0 (circles)</span><div class="tex" data-roots></div><p class="foot" data-roots-n></p></div>
      <div class="labelled"><span>Extrema, solving f′ = 0 (diamonds)</span><div class="tex" data-extrema></div><p class="foot" data-extrema-n></p></div>
      <div class="labelled"><span>Inflection candidates, solving f″ = 0 (squares)</span><div class="tex" data-inflections></div><p class="foot" data-inflections-n></p></div>
    </div>
    <div class="section">
      <div class="labelled"><span>Limits at both ends and where f has no value (dashed: asymptotes; open dots: holes and jumps)</span><div class="tex" data-limits></div><p class="foot" data-limits-note></p></div>
      <label class="field-label" for="calc-at">Limit as x approaches a number, pi/2, +oo or -oo</label>
      <div class="formula"><span aria-hidden="true">x →</span><input id="calc-at" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
      <div class="tex" data-limit-at></div>
      <p class="error" data-limit-error></p>
    </div>
    <div class="section">
      <div class="slider">
        <label for="calc-order">Taylor polynomial of order</label><output data-order-out></output>
        <input id="calc-order" type="range" min="0" max="8" step="1" value="3">
      </div>
      <div class="slider">
        <label for="calc-point">around x =</label><output data-point-out></output>
        <input id="calc-point" type="range" min="-40" max="40" step="1" value="0">
      </div>
      <div class="tex" data-taylor></div>
      <p class="error" data-taylor-error></p>
    </div>
    <div class="section">
      <div class="slider">
        <label for="calc-a">Area from x =</label><output data-a-out></output>
        <input id="calc-a" type="range" min="-100" max="100" step="1" value="-10">
      </div>
      <div class="slider">
        <label for="calc-b">to x =</label><output data-b-out></output>
        <input id="calc-b" type="range" min="-100" max="100" step="1" value="10">
      </div>
      <div class="tex" data-area></div>
      <p class="foot" data-area-check></p>
    </div>
  </div>
</aside>`;

export function mount(section, am) {
  html(section, MARKUP);
  const canvas = $(section, 'canvas'), chip = $(section, '[data-chip]');
  collapsible($(section, '.panel'));
  const view = { x0: -6, x1: 6, y0: -3, y1: 3, fitted: false };
  const data = { n: 0, curves: null, points: { roots: [], extrema: [], inflections: [] }, limits: null };
  const ui = { order: 3, point: 0, a: -1, b: 1, formula: '' };
  let range = [-6, 6];
  // Shows [a, b] in the part of the canvas the panel does not cover.
  function frame(r = [-6, 6]) {
    range = r;
    const covered = canvas.clientWidth > 900 ? 450 / canvas.clientWidth : 0;
    view.x1 = r[1];
    view.x0 = r[0] - (r[1] - r[0]) * covered / (1 - covered);
    view.fitted = false;
  }
  const shown = Object.fromEntries(CURVES.map((c) => [c.key, c.on]));

  // ------------------------------------------------------------ toggles
  for (const c of CURVES) {
    const label = document.createElement('label');
    label.style.cssText = 'display:inline-flex;gap:5px;align-items:center;font-size:12.5px';
    label.innerHTML = `<input type="checkbox" id="calc-show-${c.key}" ${c.on ? 'checked' : ''}><span style="display:inline-block;width:14px;height:3px;border-radius:2px;background:var(${c.color})"></span>${c.label}`;
    label.querySelector('input').addEventListener('change', (e) => { shown[c.key] = e.target.checked; draw(); });
    $(section, '[data-toggles]').append(label);
  }

  // ------------------------------------------------------------ drawing
  const toX = (x, w) => (x - view.x0) / (view.x1 - view.x0) * w;
  const toY = (y, h) => h - (y - view.y0) / (view.y1 - view.y0) * h;

  function draw() {
    const [w, h] = fitCanvas(canvas, 2);
    const ctx = canvas.getContext('2d'), s = w / canvas.clientWidth;
    ctx.fillStyle = token('--surface');
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${11 * s}px ${token('--font-body')}`;
    ctx.lineWidth = s;
    ctx.strokeStyle = token('--rule');
    ctx.fillStyle = token('--ink-soft');
    const sx = niceStep((view.x1 - view.x0) / 10), sy = niceStep((view.y1 - view.y0) / 8);
    for (let x = Math.ceil(view.x0 / sx) * sx; x <= view.x1; x += sx) {
      ctx.beginPath(); ctx.moveTo(toX(x, w), 0); ctx.lineTo(toX(x, w), h); ctx.stroke();
      ctx.fillText(+x.toFixed(6) + '', toX(x, w) + 3 * s, Math.min(Math.max(toY(0, h) + 13 * s, 13 * s), h - 4 * s));
    }
    for (let y = Math.ceil(view.y0 / sy) * sy; y <= view.y1; y += sy) {
      ctx.beginPath(); ctx.moveTo(0, toY(y, h)); ctx.lineTo(w, toY(y, h)); ctx.stroke();
      if (Math.abs(y) > sy / 2) ctx.fillText(+y.toFixed(6) + '', Math.min(Math.max(toX(0, w) + 4 * s, 4 * s), w - 40 * s), toY(y, h) - 3 * s);
    }
    ctx.strokeStyle = token('--ink-soft');
    ctx.lineWidth = 1.3 * s;
    ctx.beginPath(); ctx.moveTo(toX(0, w), 0); ctx.lineTo(toX(0, w), h); ctx.moveTo(0, toY(0, h)); ctx.lineTo(w, toY(0, h)); ctx.stroke();
    if (!data.curves) return;
    const n = data.n, xs = (i) => view.x0 + (view.x1 - view.x0) * i / (n - 1);

    // The area under f between a and b.
    const f = data.curves.f;
    ctx.fillStyle = token('--plot-1');
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    let open = false;
    for (let i = 0; i < n; i++) {
      const x = xs(i);
      if (x < Math.min(ui.a, ui.b) || x > Math.max(ui.a, ui.b) || !Number.isFinite(f[i])) {
        if (open) { ctx.lineTo(toX(xs(i - 1), w), toY(0, h)); ctx.closePath(); open = false; }
        continue;
      }
      if (!open) { ctx.moveTo(toX(x, w), toY(0, h)); open = true; }
      ctx.lineTo(toX(x, w), toY(f[i], h));
    }
    if (open) { ctx.lineTo(toX(xs(n - 1), w), toY(0, h)); ctx.closePath(); }
    ctx.fill();
    ctx.globalAlpha = 1;

    for (const c of CURVES) {
      if (!shown[c.key]) continue;
      const ys = data.curves[c.key];
      ctx.strokeStyle = token(c.color);
      ctx.lineWidth = (c.key === 'f' ? 2.6 : 1.8) * s;
      ctx.setLineDash(c.dashed ? [7 * s, 5 * s] : []);
      ctx.beginPath();
      let pen = false, prev = null;
      for (let i = 0; i < n; i++) {
        const y = ys[i];
        // Break the line at gaps and at jumps across poles.
        if (y === null || !Number.isFinite(y) || (prev !== null && Math.abs(y - prev) > 4 * (view.y1 - view.y0))) { pen = false; prev = y ?? null; continue; }
        const px = toX(xs(i), w), py = toY(y, h);
        pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        pen = true;
        prev = y;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // What the limits say: dashed asymptotes, and open dots where f has no value but a limit.
    const lim = data.limits;
    if (lim && shown.f) {
      ctx.save();
      ctx.setLineDash([6 * s, 5 * s]);
      ctx.strokeStyle = token('--ink-soft');
      ctx.lineWidth = 1.3 * s;
      // An asymptote at one end is drawn over that half; one the two ends share, across.
      const mid = (view.x0 + view.x1) / 2;
      const shared = lim.minus.kind === 'value' && lim.plus.kind === 'value' && lim.minus.value === lim.plus.value;
      for (const [end, from, to] of [[lim.minus, view.x0, shared ? view.x1 : mid], [lim.plus, shared ? view.x1 : mid, view.x1]]) {
        if (end.kind !== 'value') continue;
        ctx.beginPath(); ctx.moveTo(toX(from, w), toY(end.value, h)); ctx.lineTo(toX(to, w), toY(end.value, h)); ctx.stroke();
      }
      for (const p of lim.points)
        if ([p.left.kind, p.right.kind].some((k) => k === '+oo' || k === '-oo')) {
          ctx.beginPath(); ctx.moveTo(toX(p.x, w), 0); ctx.lineTo(toX(p.x, w), h); ctx.stroke();
        }
      ctx.restore();
      for (const p of lim.points) {
        if (p.defined) continue;
        for (const side of [p.left, p.right]) {
          if (side.kind !== 'value') continue;
          ctx.beginPath(); ctx.arc(toX(p.x, w), toY(side.value, h), 5 * s, 0, Math.PI * 2);
          ctx.fillStyle = token('--surface'); ctx.fill();
          ctx.lineWidth = 2 * s; ctx.strokeStyle = token('--plot-1'); ctx.stroke();
        }
      }
    }

    // Special points, placed on f by interpolating its samples.
    const fAt = (x) => {
      const t = (x - view.x0) / (view.x1 - view.x0) * (n - 1), i = Math.floor(t);
      if (i < 0 || i >= n - 1 || !Number.isFinite(f[i]) || !Number.isFinite(f[i + 1])) return null;
      return f[i] + (f[i + 1] - f[i]) * (t - i);
    };
    const mark = (kind, x, y) => {
      const px = toX(x, w), py = toY(y, h), r = 5 * s;
      ctx.beginPath();
      if (kind === 'roots') ctx.arc(px, py, r, 0, Math.PI * 2);
      else if (kind === 'extrema') { ctx.moveTo(px, py - r * 1.3); ctx.lineTo(px + r * 1.3, py); ctx.lineTo(px, py + r * 1.3); ctx.lineTo(px - r * 1.3, py); ctx.closePath(); }
      else ctx.rect(px - r, py - r, 2 * r, 2 * r);
      ctx.fillStyle = token('--surface');
      ctx.fill();
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = token('--ink');
      ctx.stroke();
    };
    for (const kind of ['roots', 'extrema', 'inflections'])
      for (const x of data.points[kind]) {
        if (x < view.x0 || x > view.x1) continue;
        const y = kind === 'roots' ? 0 : fAt(x);
        if (y !== null) mark(kind, x, y);
      }
    if (shown.taylor) {
      const y = fAt(ui.point);
      if (y !== null) {
        ctx.fillStyle = token('--plot-5');
        ctx.beginPath(); ctx.arc(toX(ui.point, w), toY(y, h), 4 * s, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------ AngouriMath calls
  let sampling = false, resample = false;
  async function sample() {
    if (!ui.formula) return;
    if (sampling) { resample = true; return; }
    sampling = true;
    const n = Math.max(200, Math.min(1200, Math.round(canvas.clientWidth)));
    try {
      const flat = await am.call('CalculusJs', 'Sample', [view.x0, view.x1, n, ui.order]);
      const keys = ['f', 'd1', 'd2', 'F', 'taylor'];
      data.n = n;
      data.curves = Object.fromEntries(keys.map((k, j) => [k, flat.slice(j * n, (j + 1) * n)]));
      if (!view.fitted) fitY();
      draw();
    } catch { /* the status line says what happened */ }
    sampling = false;
    if (resample) { resample = false; sample(); }
  }

  function fitY() {
    const n = data.n, ys = data.curves.f.filter((y, i) => Number.isFinite(y) && view.x0 + (view.x1 - view.x0) * i / (n - 1) >= range[0]).sort((a, b) => a - b);
    if (!ys.length) return;
    // Fit to the part of f in the visible range, ignoring the extreme tenth at each end.
    let lo = ys[Math.floor(ys.length * 0.08)], hi = ys[Math.ceil(ys.length * 0.92) - 1];
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.35;
    view.y0 = lo - pad; view.y1 = hi + pad;
    view.fitted = true;
  }

  async function taylor() {
    const err = $(section, '[data-taylor-error]');
    try {
      const r = await am.json('CalculusJs', 'Taylor', [ui.formula, ui.point]);
      if (!r.ok) { err.textContent = r.error; tex($(section, '[data-taylor]'), ''); }
      else { err.textContent = ''; data.taylor = r.latex; showTaylor(); }
    } catch (e) { err.textContent = e.message; }
    sample();
  }
  function showTaylor() {
    const latex = data.taylor?.[ui.order];
    tex($(section, '[data-taylor]'), latex ? `p_{${ui.order}}(x) = ${latex}` : '');
  }

  async function area() {
    try {
      const r = await am.json('CalculusJs', 'Area', [Math.min(ui.a, ui.b), Math.max(ui.a, ui.b)]);
      const lo = Math.min(ui.a, ui.b), hi = Math.max(ui.a, ui.b);
      tex($(section, '[data-area]'), r.exactLatex
        ? `\\int_{${lo}}^{${hi}} f\\,dx = ${r.exactLatex}${r.exactValue !== null && r.exactLatex !== String(r.exactValue) ? ` \\approx ${r.exactValue.toPrecision(10)}` : ''}`
        : '');
      $(section, '[data-area-check]').textContent = r.numeric === null
        ? 'The midpoint rule finds no finite area here.'
        : `${r.exactLatex ? 'Check by' : 'No exact antiderivative was found; by'} the midpoint rule with 4000 steps: ${r.numeric.toPrecision(10)}.`;
    } catch (e) { $(section, '[data-area-check]').textContent = e.message; }
    draw();
  }

  // A limit as LaTeX: lim f(x) = its value, or why there is none.
  function limitTex(where, l) {
    const lhs = `\\lim_{${where}} f(x)`;
    if (l.kind === 'none') return `${lhs} &\\text{ does not exist}`;
    if (l.kind === 'unknown') return `${lhs} &\\text{: AngouriMath leaves it open}`;
    return `${lhs} &= ${l.kind === '+oo' ? '+\\infty' : l.kind === '-oo' ? '-\\infty' : l.latex}`;
  }
  const sameLimit = (a, b) => a.kind === b.kind && a.latex === b.latex;
  // One line for a two-sided limit, two where the sides differ.
  const pointTex = (at, left, right) => sameLimit(left, right)
    ? [limitTex(`x \\to ${at}`, left)]
    : [limitTex(`x \\to ${at}^-`, left), limitTex(`x \\to ${at}^+`, right)];
  const aligned = (lines) => `\\begin{aligned}${lines.join(' \\\\ ')}\\end{aligned}`;

  async function limits(text, mine) {
    let r;
    try { r = await am.json('CalculusJs', 'Limits', [text]); } catch { return; }
    if (mine !== generation || !r.ok) return;
    data.limits = r;
    const lines = [limitTex('x \\to -\\infty', r.minus), limitTex('x \\to +\\infty', r.plus)];
    const kinds = [];
    for (const p of r.points) {
      lines.push(...pointTex(p.at, p.left, p.right));
      const pole = [p.left.kind, p.right.kind].some((k) => k === '+oo' || k === '-oo');
      const kind = pole ? 'a pole' : !sameLimit(p.left, p.right) ? 'a jump' : p.defined ? 'no break' : 'a hole';
      kinds.push(`${kind} at x = ${+p.x.toFixed(6)}`);
    }
    tex($(section, '[data-limits]'), aligned(lines));
    $(section, '[data-limits-note]').textContent = r.points.length
      ? `A denominator or a logarithm’s argument is zero there: ${kinds.join(', ')}.`
      : 'No denominator or logarithm of f is zero near the origin.';
    draw();
  }

  async function limitAt() {
    const err = $(section, '[data-limit-error]'), box = $(section, '[data-limit-at]');
    if (!ui.formula) return;
    let r;
    try { r = await am.json('CalculusJs', 'LimitAt', [ui.formula, atIn.value]); } catch (e) { err.textContent = e.message; return; }
    if (!r.ok) { err.textContent = r.error; tex(box, ''); return; }
    err.textContent = '';
    if (r.limit) {
      const at = r.at.trim().startsWith('-') ? r.at : `+${r.at}`;
      tex(box, aligned([limitTex(`x \\to ${at}`, r.limit)]));
      return;
    }
    const lines = pointTex(r.at, r.left, r.right);
    lines.push(r.value === null ? `f(${r.at}) &\\text{ has no value}` : `f(${r.at}) &= ${+r.value.toPrecision(12)}`);
    tex(box, aligned(lines));
  }

  let generation = 0;
  async function analyze(text) {
    const mine = ++generation, t0 = performance.now();
    setChip(chip, '', 'Working');
    let r;
    try {
      r = await am.json('CalculusJs', 'Analyze', [text], { timeout: 25000 });
    } catch (e) {
      if (mine === generation) { setChip(chip, 'bad', 'AngouriMath stopped'); $(section, '[data-error]').textContent = e.message; }
      return;
    }
    if (mine !== generation) return;
    $(section, '[data-timing]').textContent = `${Math.round(performance.now() - t0)} ms`;
    if (!r.ok) { setChip(chip, 'warn', 'Not a function of x yet'); $(section, '[data-error]').textContent = r.error; return; }
    setChip(chip, 'ok', 'Derived, integrated and solved');
    $(section, '[data-error]').textContent = '';
    ui.formula = text;
    view.fitted = false;
    data.limits = null;
    limits(text, mine);
    limitAt();
    tex($(section, '[data-d1]'), r.d1);
    tex($(section, '[data-d2]'), r.d2);
    tex($(section, '[data-integral]'), r.integral || '\\text{no antiderivative found}');
    for (const kind of ['roots', 'extrema', 'inflections']) {
      const s = r[kind];
      data.points[kind] = s.points.filter((x) => x !== null);
      tex($(section, `[data-${kind}]`), s.latex.length > 600 ? '' : s.latex || '\\text{none found}');
      const near = data.points[kind].filter((x) => Math.abs(x) < 50);
      $(section, `[data-${kind}-n]`).textContent = !s.latex ? ''
        : `${s.latex.length > 600 ? `${s.text.slice(0, 120)}… ` : ''}${near.length} real ${near.length === 1 ? 'value' : 'values'} between −50 and 50${s.numerical ? ', found by a numerical search where there is no closed form, so not necessarily all' : ''}${near.length && near.length <= 6 ? `: ${near.map((x) => x.toPrecision(6)).join(', ')}` : ''}.`;
    }
    await taylor();
    area();
  }

  // ------------------------------------------------------------ controls
  const input = $(section, '#calc-input'), note = $(section, '[data-note]'), atIn = $(section, '#calc-at');
  const orderIn = $(section, '#calc-order'), pointIn = $(section, '#calc-point'), aIn = $(section, '#calc-a'), bIn = $(section, '#calc-b');
  const syncLabels = () => {
    $(section, '[data-order-out]').textContent = ui.order;
    $(section, '[data-point-out]').textContent = ui.point;
    $(section, '[data-a-out]').textContent = ui.a;
    $(section, '[data-b-out]').textContent = ui.b;
  };
  function pick(p) {
    input.value = p.formula;
    note.textContent = p.note || '';
    press(p.label);
    ui.a = p.area[0]; ui.b = p.area[1]; ui.point = p.point ?? 0;
    atIn.value = p.at ?? '+oo';
    aIn.value = ui.a * 10; bIn.value = ui.b * 10; pointIn.value = ui.point * 8;
    frame(p.range);
    syncLabels();
    analyze(p.formula);
  }
  const press = presets($(section, '.presets'), PRESETS, pick);
  const later = debounce(() => analyze(input.value), 500);
  input.addEventListener('input', () => { press(null); note.textContent = ''; later(); });
  orderIn.addEventListener('input', () => { ui.order = +orderIn.value; syncLabels(); showTaylor(); sample(); });
  const laterTaylor = debounce(() => taylor(), 250);
  pointIn.addEventListener('input', () => { ui.point = +pointIn.value / 8; syncLabels(); laterTaylor(); });
  const laterArea = debounce(() => area(), 150);
  atIn.addEventListener('input', debounce(() => limitAt(), 400));
  aIn.addEventListener('input', () => { ui.a = +aIn.value / 10; syncLabels(); draw(); laterArea(); });
  bIn.addEventListener('input', () => { ui.b = +bIn.value / 10; syncLabels(); draw(); laterArea(); });

  // Pan by dragging, zoom with the wheel around the pointer, reset on double-click.
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / canvas.clientWidth * (view.x1 - view.x0), dy = (e.clientY - drag.y) / canvas.clientHeight * (view.y1 - view.y0);
    view.x0 -= dx; view.x1 -= dx; view.y0 += dy; view.y1 += dy;
    drag = { x: e.clientX, y: e.clientY };
    draw();
    sample();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), k = Math.exp(e.deltaY * 0.0012);
    const cx = view.x0 + (e.clientX - r.left) / r.width * (view.x1 - view.x0), cy = view.y1 - (e.clientY - r.top) / r.height * (view.y1 - view.y0);
    view.x0 = cx + (view.x0 - cx) * k; view.x1 = cx + (view.x1 - cx) * k;
    view.y0 = cy + (view.y0 - cy) * k; view.y1 = cy + (view.y1 - cy) * k;
    draw();
    sample();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { frame(range); sample(); });
  const ro = new ResizeObserver(() => { draw(); sample(); });
  ro.observe(canvas);

  pick(PRESETS[0]);
  return { show: () => draw(), hide() {}, restarted: () => analyze(input.value) };
}
