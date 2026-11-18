import { $, html, escapeHtml, setChip, presets, codeBlock, CODE_BLOCK, tex, token, debounce, linkProgram, fullscreenTriangle, FULLSCREEN_VS, fitCanvas, rgb } from '../shared.js';

const PRESETS = [
  { label: 'A curve', formula: 'sin(x)^2 + cos(x) x / 2' },
  { label: 'A surface', formula: 'sin(x) cos(y) + (x^2 - y^2) / 12' },
  { label: 'A region', formula: 'x^2 + y^2 < 4 and y > x - 1' },
  { label: 'Logic', formula: '(a and b) or (a and not b) or (c and a)' },
  { label: 'An inequality', formula: 'x^3 - x > 0' },
  { label: 'A set', formula: '[1; 3) \\/ (2; 5] \\/ {7}' },
  { label: 'A number', formula: 'sqrt(2) + pi / 3' },
  { label: 'Shared parts', formula: '(x + 1)^2 - x^2 + sqrt((x + 1)^2 + 1)' },
  { label: 'A cubic', formula: 'x^3 - 6x^2 + 11x - 6' },
  { label: 'Fractions', formula: '1/(x - 1) + 1/(x + 1)' },
  { label: 'Roots in an interval', formula: 'sin(x) = 1/2 and x in [0; 2pi]' },
];

// Two formulas each, for the question whether they are equal.
const PAIRS = [
  { label: 'Proved', formula: 'sin(x)^2 + cos(x)^2', other: '1' },
  { label: 'Proved, with conditions', formula: 'tan(x)', other: 'sin(x) / cos(x)' },
  { label: 'Refuted at a point', formula: 'sqrt(x^2)', other: 'x' },
  { label: 'Refuted off the real line', formula: 'abs(x)^2', other: 'x^2' },
  { label: 'Not decided', formula: '(x + 1)^2', other: 'x^2 + 2x + 1' },
];

const MARKUP = `
<div class="doc-inner">
  <div class="doc-head">
    <div>
      <p class="eyebrow">One formula, every form AngouriMath gives it</p>
      <h1>Representations</h1>
    </div>
    <p class="lede">Type any formula: a function of x, of x and y, a comparison, logic, a set or a number. AngouriMath parses it once and produces each representation below, including the picture that suits what it is.</p>
    <div class="formula"><span aria-hidden="true">ƒ</span><input id="forms-input" aria-label="Formula" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
    <div class="presets" role="group" aria-label="Examples"></div>
    <div class="status"><span class="chip" data-chip>Waiting for AngouriMath</span><span class="timing" data-timing></span></div>
    <p class="error" data-error></p>
  </div>
  <div class="cards">
    <article class="card"><h3>Rendered</h3><div class="tex" data-latex></div></article>
    <article class="card"><h3>Simplified by AngouriMath</h3><div class="tex" data-simplified></div><p class="foot" data-simplified-text></p></article>
    <article class="card wide"><h3>Other forms</h3><div class="forms" data-forms></div></article>
    <article class="card wide">
      <h3>Equal to a second formula?</h3>
      <div class="formula"><span aria-hidden="true">≟</span><input id="forms-other" aria-label="A second formula to compare with" placeholder="a second formula" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
      <div class="presets" role="group" aria-label="Pairs to compare" data-pairs></div>
      <div class="forms" data-equal></div>
      <p class="foot" data-equal-note></p>
    </article>
    <article class="card wide"><h3 data-picture-title>Picture</h3><div data-picture></div><p class="foot" data-picture-note></p></article>
    <article class="card wide"><h3>Expression tree</h3><p class="foot" data-tree-note></p><div class="scroll-x" data-tree></div></article>
    <article class="card"><h3>Text, as AngouriMath prints it</h3><pre data-text></pre></article>
    <article class="card"><h3>Text in Unicode</h3><pre data-unicode></pre><p class="foot">Printed under MathS.Settings.UnicodeOutput. The parser reads every glyph back.</p></article>
    <article class="card"><h3>LaTeX source</h3><pre data-latex-source></pre></article>
    <article class="card"><h3>SymPy</h3><pre data-sympy></pre></article>
    <article class="card" data-shader-card><h3>Shader</h3>${CODE_BLOCK}</article>
  </div>
</div>`;

export function mount(section, am) {
  section.classList.add('doc');
  html(section, MARKUP);
  const input = $(section, '#forms-input'), chip = $(section, '[data-chip]');
  const setCode = codeBlock($(section, '[data-shader-card]'));
  let picture = null;

  const other = $(section, '#forms-other');
  const press = presets($(section, '.presets'), PRESETS, (p) => {
    input.value = p.formula;
    other.value = '';
    press(p.label);
    pressPair(null);
    describe();
  });
  const pressPair = presets($(section, '[data-pairs]'), PAIRS, (p) => {
    input.value = p.formula;
    other.value = p.other;
    press(null);
    pressPair(p.label);
    describe();
  });
  input.value = PRESETS[0].formula;
  press(PRESETS[0].label);
  const later = debounce(() => describe(), 400);
  input.addEventListener('input', () => { press(null); pressPair(null); later(); });
  const compareLater = debounce(() => compare(), 400);
  other.addEventListener('input', () => { pressPair(null); compareLater(); });

  let generation = 0;
  async function describe() {
    const mine = ++generation, text = input.value, t0 = performance.now();
    let r;
    try {
      r = await am.json('RepresentationsJs', 'Describe', [text]);
    } catch (e) {
      if (mine === generation) { setChip(chip, 'bad', 'AngouriMath stopped'); $(section, '[data-error]').textContent = e.message; }
      return;
    }
    if (mine !== generation) return;
    $(section, '[data-timing]').textContent = `${Math.round(performance.now() - t0)} ms`;
    if (!r.ok) {
      setChip(chip, 'warn', 'Not a formula yet');
      $(section, '[data-error]').textContent = r.error;
      return;
    }
    $(section, '[data-error]').textContent = '';
    const kinds = { curve: 'A function of one variable', surface: 'A function of two variables', region: 'A region of the plane',
      logic: 'Logic', set: 'A set of numbers', value: 'A number', other: 'An expression' };
    setChip(chip, 'ok', kinds[r.kind] || 'An expression');
    tex($(section, '[data-latex]'), r.latex);
    tex($(section, '[data-simplified]'), r.simplifiedLatex);
    $(section, '[data-simplified-text]').textContent = r.simplified === r.text ? 'Already as simple as AngouriMath makes it.' : r.simplified;
    showForms($(section, '[data-forms]'), r.forms, r.text);
    $(section, '[data-text]').textContent = r.text;
    $(section, '[data-unicode]').textContent = r.unicode || r.text;
    $(section, '[data-latex-source]').textContent = r.latex;
    $(section, '[data-sympy]').textContent = r.sympy || 'No SymPy form.';
    $(section, '[data-shader-card]').hidden = !r.glsl;
    if (r.glsl) setCode(r.glsl, r.hlsl || '', 'The formula as a shader function of p; repeated parts are computed once.');
    drawTree($(section, '[data-tree]'), r.tree);
    $(section, '[data-tree-note]').textContent = r.nodes === r.distinct
      ? `${r.nodes} nodes, all different.`
      : `${r.nodes} nodes, of which ${r.distinct} are different: a repeated subtree is computed once in the shader.`;
    compare();
    picture?.dispose?.();
    picture = await drawPicture(r, mine);
  }
  describe();

  let comparison = 0;
  async function compare() {
    const mine = ++comparison, box = $(section, '[data-equal]'), note = $(section, '[data-equal-note]');
    const second = other.value.trim();
    if (!second) {
      box.replaceChildren();
      note.textContent = 'Type a second formula, or pick a pair. AngouriMath answers equal, not equal or not decided, and says what the answer rests on.';
      return;
    }
    const t0 = performance.now();
    let r;
    try {
      r = await am.json('RepresentationsJs', 'Compare', [input.value, second]);
    } catch (e) {
      if (mine === comparison) { box.replaceChildren(); note.textContent = e.message; }
      return;
    }
    if (mine !== comparison) return;
    if (!r.ok) { box.replaceChildren(); note.textContent = r.error; return; }
    showAnswers(box, r.answers);
    note.textContent = `By MathS.AreEqual, with at most ${r.steps.toLocaleString('en')} steps of work for a question: ${Math.round(performance.now() - t0)} ms.`;
  }

  async function drawPicture(r, mine) {
    const box = $(section, '[data-picture]'), title = $(section, '[data-picture-title]'), note = $(section, '[data-picture-note]');
    box.replaceChildren();
    note.textContent = '';
    if (r.kind === 'curve') {
      title.textContent = `Plot of the function of ${r.vars[0]}`;
      const samples = await am.call('RepresentationsJs', 'Sample', [-6, 6, 600]);
      if (mine !== generation) return null;
      return plotCurve(box, samples, -6, 6);
    }
    if (r.kind === 'surface' || r.kind === 'region') {
      title.textContent = r.kind === 'region' ? 'The region, on the GPU' : 'Heat map with level curves, on the GPU';
      note.textContent = `${r.vars[0]} runs left to right and ${r.vars[1]} bottom to top; the shorter side spans −4 to 4, with grid lines one unit apart. Drawn by the GLSL in the Shader card.`;
      return r.glsl ? heatMap(box, r.glsl, r.kind === 'region') : null;
    }
    if (r.kind === 'logic' && r.truth) {
      title.textContent = 'Truth table';
      box.append(truthTable(r.truth));
      return null;
    }
    if (r.kind === 'set') {
      title.textContent = 'On the number line';
      if (r.solved) note.textContent = `Solved by AngouriMath: ${r.solved}`;
      if (r.note) note.textContent = r.note;
      if (r.intervals) box.append(numberLine(r.intervals));
      return null;
    }
    if (r.kind === 'value') {
      title.textContent = 'Value';
      const p = document.createElement('p');
      p.style.cssText = 'margin:0;font:28px/1.2 var(--font-mono);overflow-wrap:anywhere';
      p.textContent = r.value;
      box.append(p);
      return null;
    }
    title.textContent = 'Picture';
    note.textContent = 'Pictures are drawn for formulas in up to two variables, logic and sets.';
    return null;
  }

  return { show() {}, hide() {} };
}

// ---------------------------------------------------------------- forms

/** The rewrites side by side, and the forms simplify weighs, simplest first. */
function showForms(box, forms, text) {
  box.replaceChildren();
  const add = (label, latex, foot) => {
    const div = document.createElement('div');
    div.className = 'labelled';
    div.innerHTML = `<span>${escapeHtml(label)}</span><div class="tex"></div>${foot ? `<p class="foot">${escapeHtml(foot)}</p>` : ''}`;
    tex(div.children[1], latex);
    box.append(div);
  };
  const same = (form) => (form.text === text ? 'As written.' : '');
  add('Expanded: products multiplied out', forms.expanded.latex, same(forms.expanded));
  add('Factorised: common factors gathered, polynomials factored', forms.factorized.latex, same(forms.factorized));
  add('Normalised: one tidying pass, without a search', forms.normalized.latex, same(forms.normalized));
  const alternatives = document.createElement('div');
  alternatives.className = 'labelled alternatives';
  alternatives.innerHTML = '<span>Forms simplify weighs against each other, simplest first</span><ol></ol>';
  forms.alternatives.forEach((a, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${i + 1}</span><div class="tex"></div>`;
    tex(li.lastChild, a.latex);
    alternatives.lastChild.append(li);
  });
  box.append(alternatives);
}

/** MathS.AreEqual's answer in each domain: the verdict, then the proof's rules or the point that refutes. */
function showAnswers(box, answers) {
  const domains = { complex: 'Over the complex numbers', real: 'Over the real numbers' };
  const verdicts = { Equal: ['ok', 'Equal'], NotEqual: ['bad', 'Not equal'], Unknown: ['warn', 'Not decided'] };
  box.replaceChildren(...answers.map((a) => {
    const div = document.createElement('div');
    div.className = 'labelled';
    const [kind, word] = verdicts[a.verdict];
    div.innerHTML = `<span>${domains[a.domain]}</span><div><span class="chip" data-kind="${kind}">${word}</span></div>`;
    const foot = document.createElement('p');
    foot.className = 'foot';
    if (a.verdict === 'Equal') {
      foot.textContent = a.sound
        ? 'Proved by rewrite rules that hold with no side condition.'
        : `Proved wherever both sides have a value, by rules that carry side conditions: ${a.rules.join('; ')}.`;
    } else if (a.verdict === 'NotEqual') {
      if (a.atLatex) {
        const at = document.createElement('div');
        at.className = 'tex';
        tex(at, a.atLatex);
        div.append(at);
      }
      foot.textContent = `${a.atLatex ? 'At this point the' : 'The'} first is ${a.leftAt} and the second is ${a.rightAt}.`;
    } else {
      foot.textContent = a.finished
        ? 'No proof within the rules, and no point found where the two differ. That does not say they are unequal.'
        : 'The steps ran out before a proof or a differing point was found. That does not say they are unequal.';
    }
    div.append(foot);
    return div;
  }));
}

// ---------------------------------------------------------------- pictures

function plotCurve(box, ys, x0, x1) {
  const canvas = document.createElement('canvas');
  canvas.style.height = '280px';
  box.append(canvas);
  const draw = () => {
    const [w, h] = fitCanvas(canvas, 2);
    const ctx = canvas.getContext('2d');
    const finite = ys.filter((y) => y !== null && Number.isFinite(y)).sort((a, b) => a - b);
    let lo = finite.length ? finite[Math.floor(finite.length * 0.02)] : -1, hi = finite.length ? finite[Math.ceil(finite.length * 0.98) - 1] : 1;
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
    const X = (x) => (x - x0) / (x1 - x0) * w, Y = (y) => h - (y - lo) / (hi - lo) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = token('--rule');
    ctx.fillStyle = token('--ink-soft');
    ctx.font = `${11 * (w / canvas.clientWidth)}px ${token('--font-body')}`;
    for (let x = Math.ceil(x0); x <= x1; x++) {
      ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), h); ctx.stroke();
    }
    const step = niceStep((hi - lo) / 5);
    for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) {
      ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(w, Y(y)); ctx.stroke();
      ctx.fillText(+y.toFixed(6) + '', 4, Y(y) - 3);
    }
    ctx.strokeStyle = token('--ink-soft');
    ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), h); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
    ctx.strokeStyle = token('--plot-1');
    ctx.lineWidth = 2.2 * (w / canvas.clientWidth);
    ctx.beginPath();
    let pen = false;
    ys.forEach((y, i) => {
      if (y === null || !Number.isFinite(y)) { pen = false; return; }
      const px = X(x0 + (x1 - x0) * i / (ys.length - 1)), py = Y(y);
      pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      pen = true;
    });
    ctx.stroke();
  };
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(canvas);
  return { dispose: () => ro.disconnect() };
}

export function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function heatMap(box, glsl, isRegion) {
  const canvas = document.createElement('canvas');
  canvas.style.height = '340px';
  box.append(canvas);
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) { box.textContent = 'This browser has no WebGL2.'; return null; }
  const fs = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec2 uScale;
uniform vec3 uLo, uMid, uHi, uInk;
out vec4 outColor;
${glsl}
void main() {
  vec2 p = vNdc * uScale;
  vec2 grid = abs(fract(p + 0.5) - 0.5) / fwidth(p);
  float gridLine = 1.0 - min(min(grid.x, grid.y), 1.0);
  vec2 axis = abs(p) / fwidth(p);
  float axisLine = 1.0 - min(min(axis.x, axis.y), 1.0);
  vec3 col;
  ${isRegion
    ? 'col = f(p) ? mix(uMid, uHi, 0.55) : uMid;'
    : `float v = f(p);
  float t = tanh(v * 0.6);
  col = t < 0.0 ? mix(uMid, uLo, -t) : mix(uMid, uHi, t);
  float level = abs(fract(v * 2.0 + 0.5) - 0.5) / max(fwidth(v * 2.0), 1e-5);
  col = mix(col, uInk, 0.35 * (1.0 - min(level, 1.0)));
  if (isnan(v)) col = uMid * 0.6;`}
  col = mix(col, uInk, 0.12 * gridLine + 0.45 * axisLine);
  outColor = vec4(col, 1.0);
}`;
  let prog;
  try {
    prog = linkProgram(gl, FULLSCREEN_VS, fs);
  } catch (e) { box.textContent = `The GPU did not accept the shader: ${e.message}`; return null; }
  const vao = fullscreenTriangle(gl);
  const draw = () => {
    const [w, h] = fitCanvas(canvas, 2);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.program);
    const aspect = w / h;
    gl.uniform2f(prog.loc.uScale, aspect >= 1 ? 4 * aspect : 4, aspect >= 1 ? 4 : 4 / aspect);
    gl.uniform3fv(prog.loc.uLo, rgb('--plot-1'));
    gl.uniform3fv(prog.loc.uHi, rgb('--plot-2'));
    gl.uniform3fv(prog.loc.uMid, rgb('--surface'));
    gl.uniform3fv(prog.loc.uInk, rgb('--ink'));
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(canvas);
  return { dispose: () => { ro.disconnect(); gl.getExtension('WEBGL_lose_context')?.loseContext(); } };
}

export function truthTable(truth) {
  const wrap = document.createElement('div');
  wrap.className = 'scroll-x';
  // The Logic tab's senses mode adds a column per output and marks impossible rows, whose values
  // show as dashes.
  const n = truth.vars.length, outputs = truth.outputs ?? ['value'];
  const head = [...truth.vars, ...outputs].map((v) => `<th>${escapeHtml(v)}</th>`).join('');
  const rows = truth.rows.map((row, i) => {
    const possible = truth.possible?.[i] ?? true, hit = row.slice(n).some(Boolean);
    const cells = row.map((b, j) => j >= n && !possible ? '<td class="x">–</td>' : `<td class="${b ? 't' : 'f'}">${b ? '1' : '0'}</td>`);
    return `<tr class="${!possible ? 'dc' : hit ? 'hit' : ''}">${cells.join('')}</tr>`;
  }).join('');
  wrap.innerHTML = `<table class="truth"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  return wrap;
}

/** Intervals and points from the C# side as an SVG number line. */
export function numberLine(parts) {
  const ends = [];
  for (const p of parts) {
    if (p.point !== undefined) ends.push(p.point);
    if (p.lo !== null && p.lo !== undefined) ends.push(p.lo);
    if (p.hi !== null && p.hi !== undefined) ends.push(p.hi);
  }
  let lo = ends.length ? Math.min(...ends) : -1, hi = ends.length ? Math.max(...ends) : 1;
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.25;
  lo -= pad; hi += pad;
  const W = 720, H = 92, X = (x) => 20 + (x - lo) / (hi - lo) * (W - 40), axisY = 50;
  // CSS variables do not resolve in SVG presentation attributes, so colours go in style.
  const soft = 'fill:var(--ink-soft)', axis = 'stroke:var(--ink-soft);stroke-width:1.2', ink = 'fill:var(--ink)';
  let svg = `<line x1="8" y1="${axisY}" x2="${W - 8}" y2="${axisY}" style="${axis}"/>`;
  svg += `<path d="M${W - 8} ${axisY} l-8 -4 v8 z" style="${soft}"/>`;
  const step = niceStep((hi - lo) / 8);
  for (let x = Math.ceil(lo / step) * step; x <= hi; x += step) {
    svg += `<line x1="${X(x)}" y1="${axisY - 4}" x2="${X(x)}" y2="${axisY + 4}" style="${axis}"/>`;
    svg += `<text x="${X(x)}" y="${axisY + 20}" font-size="11" text-anchor="middle" style="${soft}">${+x.toFixed(6)}</text>`;
  }
  const dot = (x, closed) => `<circle cx="${X(x)}" cy="${axisY}" r="5.5" style="fill:${closed ? 'var(--plot-1)' : 'var(--surface)'};stroke:var(--plot-1);stroke-width:2.2"/>`;
  const label = (x, text) => `<text x="${X(x)}" y="${axisY - 14}" font-size="11" text-anchor="middle" style="${ink}">${escapeHtml(text)}</text>`;
  for (const p of parts) {
    if (p.point !== undefined) {
      svg += dot(p.point, true) + label(p.point, p.text);
      continue;
    }
    const a = p.lo ?? lo, b = p.hi ?? hi;
    svg += `<line x1="${X(a)}" y1="${axisY}" x2="${X(b)}" y2="${axisY}" style="stroke:var(--plot-1);stroke-width:6"/>`;
    if (p.lo === null) svg += `<path d="M${X(a) - 2} ${axisY} l10 -7 v14 z" style="fill:var(--plot-1)"/>`;
    else svg += dot(p.lo, p.loClosed) + label(p.lo, p.loText);
    if (p.hi === null) svg += `<path d="M${X(b) + 2} ${axisY} l-10 -7 v14 z" style="fill:var(--plot-1)"/>`;
    else svg += dot(p.hi, p.hiClosed) + label(p.hi, p.hiText);
  }
  const box = document.createElement('div');
  box.className = 'scroll-x';
  box.innerHTML = `<svg class="diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="The set on the number line; filled dots are included, hollow ones are not">${svg}</svg>`;
  return box;
}

/** A tidy tree: leaves side by side, each parent centred over its children. */
export function drawTree(box, tree) {
  const nodes = [];
  let leaves = 0, depth = 0;
  (function place(n, d) {
    depth = Math.max(depth, d);
    const node = { label: n.t, d, kids: (n.c || []).map((c) => place(c, d + 1)) };
    node.x = node.kids.length ? (node.kids[0].x + node.kids[node.kids.length - 1].x) / 2 : leaves++;
    nodes.push(node);
    return node;
  })(tree, 0);
  const DX = 54, DY = 54, W = Math.max(leaves * DX, 120), H = (depth + 1) * DY;
  const pos = (n) => [n.x * DX + DX / 2, n.d * DY + 22];
  let svg = '';
  for (const n of nodes)
    for (const k of n.kids) {
      const [x1, y1] = pos(n), [x2, y2] = pos(k);
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:var(--rule);stroke-width:1.5"/>`;
    }
  for (const n of nodes) {
    const [x, y] = pos(n), leaf = !n.kids.length;
    const label = n.label.length > 9 ? n.label.slice(0, 8) + '…' : n.label;
    const w = Math.max(26, label.length * 7.4 + 12);
    svg += `<rect x="${x - w / 2}" y="${y - 12}" width="${w}" height="24" rx="12" style="fill:${leaf ? 'var(--surface)' : 'var(--code)'};stroke:${leaf ? 'var(--plot-1)' : 'var(--rule)'}"/>`;
    svg += `<text x="${x}" y="${y + 4}" font-size="12" text-anchor="middle" style="fill:var(--ink);font-family:var(--font-mono)">${escapeHtml(label)}</text>`;
  }
  box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="The expression tree">${svg}</svg>`;
}
