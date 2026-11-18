import { $, html, escapeHtml, setChip, presets, tex, debounce } from '../shared.js';

const PRESETS = [
  { label: 'A Mersenne prime', n: '2^89 - 1',
    note: 'AngouriMath decides that 2^89 − 1 is prime by the Lucas–Lehmer test; trial division up to its square root would not finish.' },
  { label: '100!', n: '100!', note: 'Integers have no size limit: all 158 digits are exact.' },
  { label: '0.1 + 0.2', n: '0.1 + 0.2',
    note: 'Exactly 3/10. In floating point it is 0.30000000000000004, because 0.1 has no finite expansion in base 2, as the table of bases shows.' },
  { label: '1/7', n: '1/7', base: 7, note: 'A fraction stays a fraction. Its decimal repeats every six digits; in base 7 it ends after one.' },
  { label: 'Ramanujan’s constant', n: 'e^(pi sqrt(163))', digits: 40,
    note: 'Within 10⁻¹² of a whole number, which takes 30 significant digits to see.' },
  { label: 'Euler’s identity', n: 'e^(i pi)', note: 'e^(iπ) + 1 = 0: AngouriMath evaluates the power exactly, to −1.' },
  { label: 'Euclid', n: '1071', m: '462', note: 'gcd(1071, 462) = 21, the example Euclid’s algorithm is usually shown with.' },
  { label: 'Project Euler 3', n: '600851475143', note: 'Its largest prime factor is 6857.' },
  { label: 'Cole’s number', n: '2^67 - 1',
    note: 'Mersenne listed 2^67 − 1 as a prime. In 1903 Frank Nelson Cole showed that it is not by multiplying out its two factors; AngouriMath finds them by Pollard’s rho.' },
  { label: 'A complex quotient', n: '(1 + 2i) / (3 - i)', note: 'Complex fractions stay exact too.' },
  { label: 'A cube root', n: '(1 + i)^(1/3)', note: 'The principal cube root: one third of the angle, the cube root of the length.' },
  { label: 'The Basel problem', n: 'zeta(2)',
    note: 'The sum of 1/n² over every whole n. AngouriMath knows the zeta function exactly at the even arguments: π²/6.' },
  { label: 'Apéry’s constant', n: 'zeta(3)', digits: 100,
    note: 'ζ(3) has no known closed form, so it stays as written, and is evaluated to the digits asked for.' },
  { label: '√2 to 1000 digits', n: 'sqrt(2)', digits: 1000 },
];

const KINDS = { integer: 'An integer', rational: 'A fraction', real: 'A real number', complex: 'A complex number' };

const MARKUP = `
<div class="doc-inner">
  <div class="doc-head">
    <div>
      <p class="eyebrow">Exact arithmetic, primes and bases</p>
      <h1>Numbers</h1>
    </div>
    <p class="lede">AngouriMath keeps numbers exact: integers of any size, fractions, roots and π stay what they are, and decimals come out to as many digits as you ask for. Type a number, or a formula of numbers.</p>
    <div class="formula"><span aria-hidden="true">n =</span><input id="num-input" aria-label="A number" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
    <div class="presets" role="group" aria-label="Examples"></div>
    <p class="note" data-note></p>
    <div class="status"><span class="chip" data-chip>Waiting for AngouriMath</span><span class="timing" data-timing></span></div>
    <p class="error" data-error></p>
  </div>
  <div class="cards">
    <article class="card"><h3>Exact value</h3><div class="tex" data-exact></div><p class="foot" data-exact-note></p></article>
    <article class="card">
      <h3>Decimal</h3>
      <div class="slider">
        <label for="num-digits">Significant digits</label><output data-digits-out></output>
        <input id="num-digits" type="range" min="10" max="1000" step="10" value="50">
      </div>
      <pre class="digits" data-decimal></pre>
      <p class="foot" data-decimal-note></p>
    </article>
    <article class="card" data-prime-card>
      <h3>Primes and divisors</h3>
      <dl class="checks facts" data-facts></dl>
      <div class="tex" data-factors></div>
      <div class="chips" data-divisors></div>
      <p class="foot" data-factor-note></p>
    </article>
    <article class="card" data-gcd-card>
      <h3>With a second integer</h3>
      <div class="formula"><span aria-hidden="true">m =</span><input id="num-other" aria-label="A second integer" spellcheck="false" autocomplete="off" autocapitalize="off" inputmode="numeric"></div>
      <dl class="checks facts" data-gcd></dl>
      <div class="tex" data-ratio></div>
    </article>
    <article class="card" data-complex-card>
      <h3>On the complex plane</h3>
      <div data-plane></div>
      <dl class="checks" data-parts></dl>
    </article>
    <article class="card wide" data-bases-card>
      <h3>In other bases</h3>
      <div class="slider">
        <label for="num-base">And in base</label><output data-base-out></output>
        <input id="num-base" type="range" min="2" max="36" step="1" value="3">
      </div>
      <div class="scroll-x"><table class="bases" data-bases></table></div>
      <p class="foot" data-bases-note></p>
      <div class="from-base">
        <span>Read</span>
        <input id="num-from" aria-label="Digits to read" spellcheck="false" autocomplete="off" autocapitalize="off" value="FF.8">
        <span>in base</span>
        <select id="num-from-base" aria-label="Their base"></select>
        <span>as</span>
        <div class="tex" data-from></div>
      </div>
      <p class="error" data-from-error></p>
    </article>
  </div>
</div>`;

export function mount(section, am) {
  section.classList.add('doc');
  html(section, MARKUP);
  const input = $(section, '#num-input'), other = $(section, '#num-other'), chip = $(section, '[data-chip]'), note = $(section, '[data-note]');
  const digitsIn = $(section, '#num-digits'), baseIn = $(section, '#num-base');
  const fromIn = $(section, '#num-from'), fromBase = $(section, '#num-from-base');
  for (let b = 2; b <= 36; b++) fromBase.add(new Option(String(b), String(b), false, b === 16));

  const syncLabels = () => {
    $(section, '[data-digits-out]').textContent = digitsIn.value;
    $(section, '[data-base-out]').textContent = baseIn.value;
  };

  const press = presets($(section, '.presets'), PRESETS, (p) => {
    input.value = p.n;
    other.value = p.m ?? '';
    digitsIn.value = p.digits ?? 50;
    baseIn.value = p.base ?? 3;
    note.textContent = p.note ?? '';
    press(p.label);
    syncLabels();
    describe();
  });

  let generation = 0;
  async function describe() {
    const mine = ++generation, t0 = performance.now();
    setChip(chip, '', 'Working');
    let r;
    try {
      r = await am.json('NumbersJs', 'Describe', [input.value, +digitsIn.value, +baseIn.value, other.value]);
    } catch (e) {
      if (mine === generation) { setChip(chip, 'bad', 'AngouriMath stopped'); $(section, '[data-error]').textContent = e.message; }
      return;
    }
    if (mine !== generation) return;
    $(section, '[data-timing]').textContent = `${Math.round(performance.now() - t0)} ms`;
    if (!r.ok) {
      setChip(chip, 'warn', 'Not a number yet');
      $(section, '[data-error]').textContent = r.error;
      return;
    }
    $(section, '[data-error]').textContent = '';
    setChip(chip, 'ok', KINDS[r.kind]);

    tex($(section, '[data-exact]'), r.exactLatex || `\\text{${r.exactText.replace(/[{}\\]/g, '')}}`);
    $(section, '[data-exact-note]').textContent = {
      integer: `${r.length} digit${r.length === 1 ? '' : 's'}, every one exact.`,
      rational: 'A fraction in lowest terms, kept exact.',
      real: r.exactText === r.decimal ? 'A decimal.' : 'Kept as AngouriMath simplifies it; the decimal is computed from this.',
      complex: 'Real and imaginary parts, each kept exact where it can be.',
    }[r.kind];

    $(section, '[data-decimal]').textContent = r.decimal;
    $(section, '[data-decimal-note]').textContent = r.kind === 'rational'
      ? (r.period ? `The block in brackets repeats forever, every ${r.period} digit${r.period === 1 ? '' : 's'}: long division of the exact fraction, so the slider does not apply.` : 'The decimal ends: the denominator has no prime but 2 and 5.')
      : r.kind === 'integer' ? 'An integer is its own decimal.'
        : r.kind === 'complex' && !/\d{12}/.test(r.decimal) ? 'Both parts are fractions, written out exactly.'
          : `${digitsIn.value} significant digits, from AngouriMath’s arbitrary-precision evaluation.`;

    showBases(r);
    showInteger(r, mine);
    showComplex(r);
  }

  function showBases(r) {
    const card = $(section, '[data-bases-card]');
    card.hidden = !r.bases;
    if (!r.bases) return;
    $(section, '[data-bases]').innerHTML = r.bases.map((b) =>
      `<tr><th>base ${b.base}</th><td>${escapeHtml(b.digits)}${b.exact ? '' : '…'}</td></tr>`).join('');
    $(section, '[data-bases-note]').textContent = r.kind === 'rational'
      ? 'A fraction by long division, its repeating block in brackets. AngouriMath’s ToBaseN writes the same digits, exactly, and cuts a block that repeats where the precision ends.'
      : r.kind === 'integer'
        ? 'Written by AngouriMath’s ToBaseN, exactly, with digits up to Z for base 36.'
        : 'Written by AngouriMath’s ToBaseN, with digits up to Z for base 36. An expansion that does not end is cut where the precision ends; … marks the cut.';
  }

  async function showInteger(r, mine) {
    const integer = r.kind === 'integer';
    $(section, '[data-prime-card]').hidden = !integer;
    $(section, '[data-gcd-card]').hidden = !integer;
    if (!integer) return;
    const prime = {
      yes: 'Yes, decided by Miller–Rabin, which is exact below 3.3 × 10²⁴, or by Lucas–Lehmer for 2^p − 1.',
      no: 'No.',
      undecided: 'Undecided: it passes Miller–Rabin, but past 3.3 × 10²⁴ passing is not a proof, so AngouriMath does not say yes.',
    }[r.prime];
    const facts = $(section, '[data-facts]');
    facts.innerHTML = `<dt>Prime</dt><dd>${prime}</dd>`;
    const factors = $(section, '[data-factors]'), divisors = $(section, '[data-divisors]'), foot = $(section, '[data-factor-note]');
    shown(factors, '');
    divisors.replaceChildren();
    foot.textContent = '';
    if (r.other) {
      $(section, '[data-gcd]').innerHTML = `<dt>Greatest common divisor</dt><dd>${r.other.gcd}</dd><dt>Least common multiple</dt><dd>${r.other.lcm}</dd>`;
      shown($(section, '[data-ratio]'), r.other.ratioLatex);
    } else {
      $(section, '[data-gcd]').innerHTML = '<dt></dt><dd>Type a second integer for their greatest common divisor, least common multiple and quotient.</dd>';
      shown($(section, '[data-ratio]'), '');
    }
    let f;
    try {
      f = await am.json('NumbersJs', 'Factor', [input.value], { timeout: 15000 });
    } catch (e) { if (mine === generation) foot.textContent = `Not factored. ${e.message}`; return; }
    if (mine !== generation) return;
    if (!f.ok) { foot.textContent = f.error; return; }
    shown(factors, `${r.decimal} = ${f.latex}`);
    facts.innerHTML += `<dt>Divisors</dt><dd>${f.divisorCount}</dd><dt>Euler’s φ(n)</dt><dd>${f.totient}, the integers from 1 to n with no factor in common with n</dd>`;
    if (f.divisors) divisors.innerHTML = f.divisors.map((d) => `<span>${d}</span>`).join('');
    foot.textContent = `Factorised, counted and φ taken by AngouriMath in ${f.ms} ms.`;
  }

  function showComplex(r) {
    const card = $(section, '[data-complex-card]');
    card.hidden = !r.complex;
    if (!r.complex) return;
    const c = r.complex;
    const parts = $(section, '[data-parts]');
    parts.innerHTML = '';
    for (const [name, key] of [['Real part', 're'], ['Imaginary part', 'im'], ['Modulus |z|', 'abs'], ['Argument arg z', 'arg']]) {
      parts.insertAdjacentHTML('beforeend', `<dt>${name}</dt><dd class="tex"></dd>`);
      tex(parts.lastElementChild, c[key], false);
    }
    $(section, '[data-plane]').replaceChildren(plane(c.x, c.y));
  }

  async function readBase() {
    const err = $(section, '[data-from-error]');
    let r;
    try { r = await am.json('NumbersJs', 'FromBase', [fromIn.value, +fromBase.value]); } catch (e) { err.textContent = e.message; return; }
    if (!r.ok) { err.textContent = r.error; shown($(section, '[data-from]'), ''); return; }
    err.textContent = '';
    shown($(section, '[data-from]'), r.latex, false);
  }

  const later = debounce(describe, 450);
  input.addEventListener('input', () => { press(null); note.textContent = ''; later(); });
  other.addEventListener('input', later);
  digitsIn.addEventListener('input', () => { syncLabels(); later(); });
  baseIn.addEventListener('input', () => { syncLabels(); later(); });
  const laterBase = debounce(readBase, 300);
  fromIn.addEventListener('input', laterBase);
  fromBase.addEventListener('change', readBase);

  input.value = PRESETS[0].n;
  press(PRESETS[0].label);
  note.textContent = PRESETS[0].note;
  syncLabels();
  describe();
  readBase();
  return { show() {}, hide() {} };
}

/** LaTeX that is there only sometimes: hidden while empty, rather than shown as a dash. */
function shown(el, latex, display = true) {
  el.hidden = !latex;
  tex(el, latex, display);
}

/** The point z on the complex plane, with its modulus as a circle and its argument as an arc. */
function plane(x, y) {
  const W = 320, H = 260, r = Math.hypot(x, y) || 1, scale = 100 / r;
  const cx = W / 2, cy = H / 2, px = cx + x * scale, py = cy - y * scale;
  const soft = 'stroke:var(--ink-soft);stroke-width:1', accent = 'var(--plot-1)';
  const angle = Math.atan2(y, x), arc = 28;
  const end = [cx + arc * Math.cos(angle), cy - arc * Math.sin(angle)];
  let svg = `<line x1="8" y1="${cy}" x2="${W - 8}" y2="${cy}" style="${soft}"/><line x1="${cx}" y1="8" x2="${cx}" y2="${H - 8}" style="${soft}"/>`;
  svg += `<text x="${W - 10}" y="${cy - 6}" font-size="11" text-anchor="end" style="fill:var(--ink-soft)">Re</text>`;
  svg += `<text x="${cx + 6}" y="18" font-size="11" style="fill:var(--ink-soft)">Im</text>`;
  svg += `<circle cx="${cx}" cy="${cy}" r="100" style="fill:none;stroke:var(--rule);stroke-dasharray:4 4"/>`;
  svg += `<path d="M${cx + arc} ${cy} A${arc} ${arc} 0 ${Math.abs(angle) > Math.PI ? 1 : 0} ${angle >= 0 ? 0 : 1} ${end[0]} ${end[1]}" style="fill:none;stroke:var(--plot-2);stroke-width:1.6"/>`;
  svg += `<line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" style="stroke:${accent};stroke-width:2"/>`;
  svg += `<line x1="${px}" y1="${py}" x2="${px}" y2="${cy}" style="${soft};stroke-dasharray:3 3"/>`;
  svg += `<circle cx="${px}" cy="${py}" r="5" style="fill:${accent}"/>`;
  svg += `<text x="${px + (x >= 0 ? 8 : -8)}" y="${py - 8}" font-size="12" text-anchor="${x >= 0 ? 'start' : 'end'}" style="fill:var(--ink)">z</text>`;
  const box = document.createElement('div');
  box.innerHTML = `<svg class="diagram plane" viewBox="0 0 ${W} ${H}" role="img" aria-label="z on the complex plane, with its modulus as the dashed circle and its argument as the arc">${svg}</svg>`;
  return box.firstElementChild;
}
