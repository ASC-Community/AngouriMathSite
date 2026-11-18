import { $, html, escapeHtml, setChip, presets, tex, token, debounce, fitCanvas } from '../shared.js';

// As the Motion tab's double pendulum writes it, so that its link lands on this preset.
const MASS = '[[l_1 ^ 2 * (m_1 + m_2), m_2 * l_1 * l_2 * cos(a_1 - a_2)], [m_2 * l_1 * l_2 * cos(a_1 - a_2), l_2 ^ 2 * m_2]]';
const MASS_NOTE = 'The mass matrix of the double pendulum in the Motion tab. Its determinant stays positive, since m₂cos² < m₁ + m₂, so the equations can always be solved for the accelerations.';

const PRESETS = [
  { label: 'Stretch', a: '[[2, 1], [1, 3]]',
    note: 'Symmetric, so its eigenvectors are at right angles. The unit square goes to a parallelogram of area det A = 5.' },
  { label: 'Shear', a: '[[1, 1], [0, 1]]',
    note: 'The eigenvalue 1 twice, but only one line of eigenvectors: a shear has no second direction it leaves alone.' },
  { label: 'Rotation', a: '[[cos(t), -sin(t)], [sin(t), cos(t)]]',
    note: 'Determinant 1 and inverse equal to its transpose. Its eigenvalues are cos t ± i sin t, complex unless t is a multiple of π.' },
  { label: 'Fibonacci', a: '[[1, 1], [1, 0]]', power: 10,
    note: 'Its powers hold the Fibonacci numbers, and its larger eigenvalue is the golden ratio.' },
  { label: 'Singular', a: '[[1, 2, 3], [4, 5, 6], [7, 8, 9]]',
    note: 'Rank 2, determinant 0, no inverse: the eigenvalue 0 has the eigenvector (1, −2, 1), which A sends to zero.' },
  { label: 'Symmetric 3 × 3', a: '[[2, 1, 0], [1, 2, 1], [0, 1, 2]]', note: 'Eigenvalues 2 and 2 ± √2, with eigenvectors at right angles.' },
  { label: 'Any 2 × 2', a: '[[a, b], [c, d]]', note: 'The formulas of the 2 × 2 case, all at once.' },
  { label: 'Pauli X and Z', a: '[[0, 1], [1, 0]]', b: '[[1, 0], [0, -1]]',
    note: 'XZ = −ZX, and X ⊗ Z acts on two qubits: X on the first, Z on the second.' },
  { label: 'Polar Jacobian', a: 'jacobian([r cos(t), r sin(t)], [r, t])',
    note: 'The derivative of (r, t) ↦ (r cos t, r sin t). Its determinant r is the r in dA = r dr dt.' },
  { label: 'A Hessian', a: 'hessian(x^3 - 3 x y^2, [x, y])',
    note: 'The monkey saddle. Trace 0 everywhere, since the function is harmonic, and determinant −36(x² + y²), never positive.' },
  { label: 'Double pendulum', a: MASS, note: MASS_NOTE },
];

const MARKUP = `
<div class="doc-inner">
  <div class="doc-head">
    <div>
      <p class="eyebrow">Exact linear algebra</p>
      <h1>Matrices</h1>
    </div>
    <p class="lede">Write a matrix row by row, as AngouriMath reads it: [[1, 2], [3, 4]]. Entries can be numbers or formulas, and jacobian(…) and hessian(…) make one. Everything below is computed by AngouriMath, exactly.</p>
    <div class="formula"><span aria-hidden="true">A =</span><input id="mat-a" aria-label="Matrix A" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
    <div class="formula"><span aria-hidden="true">B =</span><input id="mat-b" aria-label="Matrix B, optional" placeholder="optional, for A B and A ⊗ B" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
    <div class="presets" role="group" aria-label="Examples"></div>
    <p class="note" data-note></p>
    <div class="status"><span class="chip" data-chip>Waiting for AngouriMath</span><span class="timing" data-timing></span></div>
    <p class="error" data-error></p>
  </div>
  <div class="cards">
    <article class="card"><h3>A</h3><div class="tex" data-a></div><p class="foot" data-shape></p></article>
    <article class="card" data-square><h3>Determinant and trace</h3>
      <div class="labelled"><span>det A</span><div class="tex" data-det></div></div>
      <div class="labelled"><span>tr A, the sum of the diagonal</span><div class="tex" data-trace></div></div>
    </article>
    <article class="card" data-square><h3>Inverse</h3><div class="tex" data-inverse></div><p class="foot" data-inverse-note></p><div class="tex" data-inverse-conditions hidden></div></article>
    <article class="card"><h3>Transpose</h3><div class="tex" data-transpose></div></article>
    <article class="card"><h3>Reduced row echelon form</h3><div class="tex" data-rref></div><p class="foot" data-rref-note></p><div class="tex" data-rref-conditions hidden></div></article>
    <article class="card" data-square>
      <h3>Powers</h3>
      <div class="slider">
        <label for="mat-power">A to the power</label><output data-power-out></output>
        <input id="mat-power" type="range" min="-3" max="12" step="1" value="2">
      </div>
      <div class="tex" data-power></div>
      <p class="error" data-power-error></p>
    </article>
    <article class="card wide" data-square>
      <h3>Eigenvalues and eigenvectors</h3>
      <div class="labelled"><span>Characteristic polynomial det(A − λI), whose roots are the eigenvalues</span><div class="tex" data-charpoly></div></div>
      <div class="eigen" data-eigen></div>
      <p class="foot" data-eigen-note></p>
    </article>
    <article class="card wide" data-picture-card>
      <h3>What A does to the plane</h3>
      <canvas data-picture role="img" aria-label="The unit square and grid carried by A, with A's eigenvector lines"></canvas>
      <div class="slider">
        <label for="mat-morph">From the identity to A</label><output data-morph-out></output>
        <input id="mat-morph" type="range" min="0" max="100" step="1" value="100">
      </div>
      <p class="foot" data-picture-note></p>
    </article>
    <article class="card wide" data-b-card>
      <h3>With B</h3>
      <div class="labelled"><span>B</span><div class="tex" data-b></div></div>
      <div class="labelled"><span>The product A B</span><div class="tex" data-product></div><p class="foot" data-product-note></p></div>
      <div class="labelled"><span>The tensor (Kronecker) product A ⊗ B</span><div class="tex" data-tensor></div></div>
      <p class="error" data-b-error></p>
    </article>
  </div>
</div>`;

export function mount(section, am) {
  section.classList.add('doc');
  html(section, MARKUP);
  const aIn = $(section, '#mat-a'), bIn = $(section, '#mat-b'), chip = $(section, '[data-chip]'), note = $(section, '[data-note]');
  const powerIn = $(section, '#mat-power'), morphIn = $(section, '#mat-morph'), canvas = $(section, '[data-picture]');
  let picture = null;

  const press = presets($(section, '.presets'), PRESETS, (p) => pick(p));
  function pick(p) {
    aIn.value = p.a;
    bIn.value = p.b ?? '';
    powerIn.value = p.power ?? 2;
    note.textContent = p.note ?? '';
    press(p.label);
    analyze();
  }

  let generation = 0;
  async function analyze() {
    const mine = ++generation, t0 = performance.now();
    setChip(chip, '', 'Working');
    let r;
    try {
      r = await am.json('MatricesJs', 'Analyze', [aIn.value, bIn.value], { timeout: 30000 });
    } catch (e) {
      if (mine === generation) { setChip(chip, 'bad', 'AngouriMath stopped'); $(section, '[data-error]').textContent = e.message; }
      return;
    }
    if (mine !== generation) return;
    $(section, '[data-timing]').textContent = `${Math.round(performance.now() - t0)} ms`;
    if (!r.ok) {
      setChip(chip, 'warn', 'Not a matrix yet');
      $(section, '[data-error]').textContent = r.error;
      return;
    }
    $(section, '[data-error]').textContent = '';
    const square = r.rows === r.cols;
    setChip(chip, 'ok', `${r.rows} × ${r.cols}${r.numeric ? '' : ', with letters'}`);
    for (const card of section.querySelectorAll('[data-square]')) card.hidden = !square;

    tex($(section, '[data-a]'), r.latex);
    $(section, '[data-shape]').textContent = `${r.rows} rows, ${r.cols} columns${r.rank !== undefined ? `, rank ${r.rank}` : ''}${r.numeric ? '' : ' (for letters in general position)'}.`;
    tex($(section, '[data-transpose]'), r.transpose);
    tex($(section, '[data-rref]'), r.rref || '');
    const rrefConditions = $(section, '[data-rref-conditions]');
    rrefConditions.hidden = !r.rref || !r.rrefConditions.length;
    tex(rrefConditions, r.rrefConditions.join(',\\quad '), false);
    $(section, '[data-rref-note]').textContent = r.numeric
      ? 'Row operations until each row starts with a 1 that is alone in its column; the rows left are a basis of the row space.'
      : 'Row operations until each row starts with a 1 that is alone in its column, for the letters in general position: a pivot that is a formula is divided by, as if it were not zero.'
        + (r.rrefConditions.length ? ' AngouriMath states the form provided:' : '');

    if (square) {
      tex($(section, '[data-det]'), r.det);
      tex($(section, '[data-trace]'), r.trace);
      tex($(section, '[data-inverse]'), r.inverse || '\\text{none}');
      const conditions = $(section, '[data-inverse-conditions]');
      conditions.hidden = !r.inverse || !r.inverseConditions.length;
      tex(conditions, r.inverseConditions.join(',\\quad '), false);
      $(section, '[data-inverse-note]').textContent = !r.inverse
        ? 'The determinant is 0, so A has no inverse.'
        : r.inverseConditions.length
          ? 'AngouriMath states the inverse provided:'
          : r.numeric ? 'A A⁻¹ = I.' : 'A A⁻¹ = I wherever det A ≠ 0: the adjugate over the determinant.';
      tex($(section, '[data-charpoly]'), r.charpoly ? `${r.charpoly} = 0` : '');
      showEigen(r);
      power();
    }

    const pictured = r.entries && r.entries.every(Number.isFinite);
    $(section, '[data-picture-card]').hidden = !pictured;
    picture = pictured ? { m: r.entries, eigen: r.eigen ?? [], det: r.det } : null;
    if (pictured) draw();

    const bCard = $(section, '[data-b-card]');
    bCard.hidden = !bIn.value.trim();
    $(section, '[data-b-error]').textContent = r.bError ?? '';
    tex($(section, '[data-b]'), r.b ?? '');
    tex($(section, '[data-product]'), r.product ?? '');
    $(section, '[data-product-note]').textContent = r.productNote ?? '';
    tex($(section, '[data-tensor]'), r.tensor ?? '');
  }

  function showEigen(r) {
    const box = $(section, '[data-eigen]'), foot = $(section, '[data-eigen-note]');
    box.replaceChildren();
    if (!r.eigen) {
      foot.textContent = r.charpoly ? 'AngouriMath gives the polynomial; its roots are shown for matrices of numbers, and with letters up to 2 × 2.' : '';
      return;
    }
    for (const e of r.eigen) {
      const row = document.createElement('div');
      row.className = 'eigen-row';
      // The value beside the exact root only where it says something: 1.381966 beside (5 − √5)/2.
      const approx = (e.approx ?? '').replace('i', '\\,\\mathrm{i}');
      const value = e.latex
        ? `\\lambda = ${e.latex}${e.approx?.includes('.') ? ` \\approx ${approx}` : ''}`
        : `\\lambda \\approx ${approx}`;
      const vectors = (e.vectors ?? []).map((v) => v.latex || (v.numeric ? `\\begin{bmatrix}${v.numeric.map((x) => +x.toFixed(5)).join(' \\\\ ')}\\end{bmatrix}` : '')).filter(Boolean);
      row.innerHTML = '<div class="tex"></div><div class="tex"></div>';
      tex(row.children[0], value);
      row.children[1].hidden = !vectors.length;
      tex(row.children[1], vectors.length ? `v = ${vectors.join(',\\; ')}` : '');
      box.append(row);
    }
    // Every eigenvalue has a vector, yet fewer than n of them: a matrix like the shear.
    const counted = r.eigen.reduce((n, e) => n + (e.vectors?.length ?? 0), 0);
    const short = r.numeric && counted < r.rows && r.eigen.every((e) => e.vectors?.length);
    foot.textContent = !r.numeric
      ? 'Eigenvectors are found for matrices of numbers.'
      : `The eigenvectors of λ span the null space of A − λI, read off its reduced row echelon form${r.eigen.some((e) => e.latex === '') ? '; a root that needs cube roots is used by its value, so its vectors are decimals' : ''}.`
        + (short ? ` Only ${counted} independent eigenvector${counted === 1 ? '' : 's'} for a ${r.rows} × ${r.rows} matrix, so it cannot be diagonalised.` : '');
  }

  async function power() {
    $(section, '[data-power-out]').textContent = powerIn.value;
    const err = $(section, '[data-power-error]');
    let r;
    try { r = await am.json('MatricesJs', 'Power', [+powerIn.value]); } catch (e) { err.textContent = e.message; return; }
    if (!r.ok) { err.textContent = r.error; tex($(section, '[data-power]'), ''); return; }
    err.textContent = '';
    tex($(section, '[data-power]'), `A^{${powerIn.value}} = ${r.latex}`);
  }

  // The plane carried by M(s) = (1 - s) I + s A: the grid, the unit square and the images of
  // the two unit vectors, with A's real eigenvector lines, along which A only stretches.
  function draw() {
    if (!picture || canvas.offsetParent === null) return;
    const [w, h] = fitCanvas(canvas, 2);
    const ctx = canvas.getContext('2d'), k = w / canvas.clientWidth;
    const s = +morphIn.value / 100, [a, b, c, d] = picture.m;
    const M = [1 - s + s * a, s * b, s * c, 1 - s + s * d];
    $(section, '[data-morph-out]').textContent = s === 1 ? 'A' : s.toFixed(2);
    const reach = Math.max(1.6, ...[[a, c], [b, d], [a + b, c + d]].map(([x, y]) => Math.hypot(x, y))) * 1.25;
    const unit = Math.min(w, h) / 2 / reach, cx = w / 2, cy = h / 2;
    const P = (x, y) => [cx + (M[0] * x + M[1] * y) * unit, cy - (M[2] * x + M[3] * y) * unit];
    ctx.fillStyle = token('--surface');
    ctx.fillRect(0, 0, w, h);

    // The grid as A carries it.
    ctx.lineWidth = k;
    ctx.strokeStyle = token('--rule');
    const n = Math.ceil(reach * 3);
    for (let i = -n; i <= n; i++) {
      for (const [p, q] of [[P(i, -n), P(i, n)], [P(-n, i), P(n, i)]]) {
        ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke();
      }
    }
    // The axes as they were.
    ctx.strokeStyle = token('--ink-soft');
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();

    // The unit square and its image; a negative determinant turns it over.
    const det = M[0] * M[3] - M[1] * M[2];
    ctx.setLineDash([4 * k, 4 * k]);
    ctx.strokeStyle = token('--ink-soft');
    ctx.strokeRect(cx, cy - unit, unit, unit);
    ctx.setLineDash([]);
    const corners = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    ctx.closePath();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = token(det < 0 ? '--plot-2' : '--plot-1');
    ctx.fill();
    ctx.globalAlpha = 1;

    // Eigenvector lines of A.
    if (s === 1)
      for (const e of picture.eigen)
        for (const v of e.vectors ?? []) {
          if (!v.numeric) continue;
          const [x, y] = v.numeric, len = Math.hypot(x, y);
          if (!len) continue;
          const ux = x / len, uy = y / len, far = reach * 4 * unit;
          ctx.strokeStyle = token('--plot-3');
          ctx.lineWidth = 1.6 * k;
          ctx.setLineDash([7 * k, 5 * k]);
          ctx.beginPath(); ctx.moveTo(cx - ux * far, cy + uy * far); ctx.lineTo(cx + ux * far, cy - uy * far); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = token('--plot-3');
          ctx.font = `${12 * k}px ${token('--font-body')}`;
          const lx = cx + ux * unit * reach * 0.82, ly = cy - uy * unit * reach * 0.82;
          ctx.fillText(`λ = ${e.approx}`, lx + 6 * k, ly - 6 * k);
        }

    // A e1 and A e2.
    const arrow = (to, color, label) => {
      const [x, y] = to, ang = Math.atan2(y - cy, x - cx), head = 10 * k;
      ctx.strokeStyle = ctx.fillStyle = token(color);
      ctx.lineWidth = 2.4 * k;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - head * Math.cos(ang - 0.4), y - head * Math.sin(ang - 0.4));
      ctx.lineTo(x - head * Math.cos(ang + 0.4), y - head * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
      ctx.font = `600 ${12 * k}px ${token('--font-body')}`;
      ctx.fillText(label, x + 6 * k, y - 6 * k);
    };
    arrow(P(1, 0), '--plot-1', s === 1 ? 'A e₁' : 'e₁');
    arrow(P(0, 1), '--plot-2', s === 1 ? 'A e₂' : 'e₂');

    $(section, '[data-picture-note]').textContent = `The shaded square has area |det| = ${+Math.abs(det).toFixed(4)}${det < 0 ? ', turned over, since the determinant is negative' : ''}. `
      + (s === 1 && picture.eigen.some((e) => e.vectors?.some((v) => v.numeric))
        ? 'On the dashed eigenvector lines A only stretches, by λ.'
        : s === 1 ? 'A has no real eigenvectors: no line through the origin stays where it is.' : 'Slide to the end to see A itself.');
  }

  // The Motion tab links here with its mass matrix: #matrices?a=...
  function fromLink() {
    const query = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const a = query.get('a');
    if (!a) return false;
    history.replaceState(null, '', '#matrices');
    pick(a === MASS ? PRESETS[PRESETS.length - 1] : { label: null, a, note: MASS_NOTE });
    return true;
  }

  const later = debounce(analyze, 500);
  aIn.addEventListener('input', () => { press(null); note.textContent = ''; later(); });
  bIn.addEventListener('input', later);
  powerIn.addEventListener('input', debounce(power, 150));
  morphIn.addEventListener('input', draw);
  new ResizeObserver(draw).observe(canvas);

  if (!fromLink()) pick(PRESETS[0]);
  return { show() { fromLink(); draw(); }, hide() {}, restarted: () => analyze() };
}
