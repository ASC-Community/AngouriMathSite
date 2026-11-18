import { $, html, escapeHtml, setChip, presets, tex, token, debounce, fitCanvas } from '../shared.js';
import { truthTable } from './representations.js';

const LOGIC = [
  { label: 'Redundant', formula: '(a and b) or (a and not b) or (c and a)',
    note: 'Three terms that say only “a”. AngouriMath and the Karnaugh map both find it.' },
  { label: 'Majority', formula: '(a and b) or (b and c) or (a and c)', note: 'True when at least two of three are true.' },
  { label: 'Parity', formula: 'a xor b xor c', note: 'A checkerboard on the map: no two true cells touch, so nothing groups.' },
  { label: 'Four inputs', formula: '(a and not c) or (b and c and d) or (not a and not b and not d) or (a and b and c)',
    note: 'Groups that wrap around the edges of the map, which is a torus.' },
  { label: 'Syllogism', formula: '((a implies b) and (b implies c)) implies (a implies c)', note: 'A tautology: true in every row.' },
  { label: 'Knights and knaves', puzzle: ['A', 'B'],
    formula: 'not (A xor not B) and not (B xor not (A xor B))',
    note: 'A says “B is a knave.” B says “A and I are of the same kind.” Knights always tell the truth and knaves always lie, so “X says S” means X and S have the same truth value: not (X xor S).' },
  { label: 'Three islanders', puzzle: ['A', 'B', 'C'],
    formula: 'not (A xor (not A and not B and not C)) and not (B xor ((A and not B and not C) or (not A and B and not C) or (not A and not B and C)))',
    note: 'A says “We are all knaves.” B says “Exactly one of us is a knight.” C says nothing.' },
];

const SETS = [
  { label: '(A ∪ B) ∩ C', formula: '(A \\/ B) /\\ C' },
  { label: 'Symmetric difference', formula: '(A \\ B) \\/ (B \\ A)', note: 'AngouriMath simplifies the logic to A xor B.' },
  { label: 'All three', formula: 'A /\\ B /\\ C' },
  { label: 'In exactly one', formula: '(A \\ (B \\/ C)) \\/ (B \\ (A \\/ C)) \\/ (C \\ (A \\/ B))' },
  { label: 'De Morgan', formula: 'A \\ (B \\/ C)', note: 'Read as logic: a and not (b or c), which is a and not b and not c.' },
];

// Each line is an output, Name = formula, in a sense like the inputs, or a condition, Name = a
// comparison of real numbers. An output may use the ones above it.
const SENSES = [
  { label: 'Two standards, one window', formula: 'On_heating = Occupied and Closed_window and not Open_window',
    note: 'The window reaches the controller twice: as KNX DPT 1.009, where 1 means closed, and as DPT 1.019, where 1 means open. It is one condition, so one letter, and the second test is the first one again.' },
  { label: 'Dry-run protection', formula: 'On_pump = On_request and (NotEmpty_tank or Full_tank)', always: 'On_pump implies NotEmpty_tank',
    note: 'A full tank is not empty. That is a fact about tanks, not about logic, so AngouriMath’s simplification keeps the Full test; the catalogue knows it, and the minimal form drops it. The always line mentions the output, so it is a design check: the pump never runs on an empty tank.' },
  { label: 'Held up', formula: 'Alarm_hover = Up and not Held and not Falling', always: '(Up and not Falling) implies Held',
    note: 'Something up that is not falling is held up by something. The alarm asks for a row that cannot happen, so with good sensors it never fires, and that same row is the fault alarm.' },
  { label: 'Lamp and horn', formula: 'On_lamp = Alarm and not Shelved and not Suppressed\nOn_horn = On_lamp and Unacknowledged and Unsilenced',
    always: 'On_horn implies On_lamp',
    note: 'Two outputs, and a design check that the horn never sounds without the lamp. ANSI/ISA-18.2 keeps acknowledgement, shelving and suppression on channels of their own beside the alarm: the lamp shows an alarm that is neither shelved nor suppressed, and the horn, built on the lamp, sounds until it is acknowledged or silenced.' },
  { label: 'Valve position',
    formula: 'On_openlamp = Near_openend and Far_closedend\nOn_closedlamp = Near_closedend and Far_openend\nAlarm_discrepancy = (Open_cmd and not On_openlamp) or (Closed_cmd and not On_closedlamp)',
    always: 'not (Near_openend and Near_closedend); not (On_openlamp and On_closedlamp)',
    note: 'A valve reports its position with two proximity switches, one at each end of its travel: two channels, as IEC 61850 keeps them, because mid-travel both read far. The stem cannot be at both ends, so each lamp needs one switch, the discrepancy alarm (commanded one way and not there, held past the travel time) follows, and both switches near is IEC 61850’s bad state, the fault alarm. The second line is a design check: the two lamps never light together.' },
  { label: 'Two-channel safety door', formula: 'On_press = On_request and Closed_a and not Open_b and NoFault_press',
    always: 'Closed_a xor Open_b',
    note: 'Channel a is a normally-open contact (1 = closed) and channel b a normally-closed one (1 = open), so healthy contacts always differ. With that invariant one channel is enough, which is safe only because the fault alarm watches it: a safety relay runs on both channels and trips on a discrepancy.' },
  { label: 'Window and handle',
    formula: 'Open_heatingvalve = Heating_mode and Occupied_room and Closed_window and Closed_handle\nOpen_coolingvalve = Cooling_mode and Occupied_room and Closed_window and Closed_handle',
    always: 'Open_window implies Open_handle',
    note: 'A window cannot open while its handle is turned to closed, so a closed handle already means a closed window, and a contact reading open behind a closed handle means one of the two is wrong. Heating / Cooling is one bit for two alternatives (KNX DPT 1.100).' },
  { label: 'Stack light',
    formula: 'On_green = Running_filler and not (Blocked_filler or Starved_filler) and InSpecification_scale and NoFault_filler and Remote_filler\nOn_amber = Blocked_filler or Starved_filler\nOn_red = Fault_filler or OutOfSpecification_scale',
    always: '(Blocked_filler or Starved_filler or Fault_filler) implies Stopped_filler; not (On_green and On_red); not (On_green and On_amber); On_green or On_amber or On_red',
    note: 'A filler’s stack light from six signals, too many for a Karnaugh map. PackML suspends a machine that is blocked or starved, and a fault stops it, so a running filler is none of those and green needs three tests, not six. The last three lines are design checks: green never lights with red or amber, but the last one fails, and the checks card says when the light is dark.' },
  { label: 'Kettle',
    formula: 'above_boilingpoint = T > 100\ntoo_hot = T > 120\nOn_heater = On_kettle and not above_boilingpoint\nAlarm_dry = On_kettle and too_hot and above_boilingpoint',
    always: 'not (On_heater and Alarm_dry)',
    note: 'Conditions on a real number. AngouriMath solves where each comparison turns, at 100 and 120, and finds that T > 120 implies T > 100, so the dry-boil alarm needs only one of them, and the design check that the heater is never on during a dry-boil alarm holds because of it. If the two are separate thermostats, the 120 °C one on without the 100 °C one means one of them is broken.' },
  { label: 'Frost protection', formula: 'On_heater = (Occupied_room and T < 19) or (Unoccupied_room and T < 5) or T < 2',
    note: 'Comfort heating when the room is occupied, frost protection when it is not, and a last resort below 2 °C, with the comparisons written in the formula. Each implies the next, so the minimal form needs neither the last resort nor the Unoccupied test.' },
];

const MODES = { logic: 'Logic', sets: 'Sets', senses: 'Senses' };

const MARKUP = `
<div class="doc-inner">
  <div class="doc-head">
    <div>
      <p class="eyebrow">Boolean algebra, sets and logic puzzles</p>
      <h1>Logic</h1>
    </div>
    <p class="lede">A formula in true-or-false variables, or a formula in sets: AngouriMath builds the truth table and simplifies it, a Karnaugh map finds the minimal sum of products, and AngouriMath checks every rewrite is equivalent by comparing truth tables.</p>
    <div class="presets" role="group" aria-label="Mode" data-modes></div>
    <div class="formula"><span aria-hidden="true" data-prefix>ƒ</span><div class="gutter" aria-hidden="true" data-gutter hidden></div><textarea id="logic-input" rows="1" aria-label="Formula" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea><div class="measure" aria-hidden="true" data-measure></div></div>
    <div class="formula" data-always-row hidden><span aria-hidden="true">always</span><input id="logic-always" aria-label="Invariants: facts that always hold, and checks on the outputs, separated by semicolons" placeholder="facts that always hold, and checks on the outputs, separated by semicolons" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
    <details class="catalogue" data-catalogue hidden>
      <summary>The catalogue: every sense you can write</summary>
      <p class="foot">Each pair is one bit read two ways: the first sense means 1, the second 0. Add a channel after an underscore, as in Open_door; case does not matter. Click a sense to put it in the field you were typing in. From the LogicState catalogue (Rafael-SOWNet/UnitsNet, spike/logic-state).</p>
      <div class="catalogue-grid" data-catalogue-grid></div>
      <p class="foot" data-catalogue-rules></p>
    </details>
    <div class="presets" role="group" aria-label="Examples" data-presets></div>
    <p class="note" data-note></p>
    <div class="status"><span class="chip" data-chip>Waiting for AngouriMath</span><span class="timing" data-timing></span></div>
    <p class="error" data-error></p>
  </div>
  <div class="cards">
    <article class="card" data-puzzle hidden><h3>Answer</h3><div data-answer></div></article>
    <article class="card" data-venn-card hidden><h3>Venn diagram</h3><canvas data-venn style="height:300px"></canvas><p class="foot" data-sets></p></article>
    <article class="card wide" data-senses-card hidden><h3>Senses</h3><div class="scroll-x" data-senses></div><p class="foot">One letter per channel, named after its true sense; the opposite sense is its negation. Pairs and sources from the LogicState catalogue.</p></article>
    <article class="card wide" data-conditions-card hidden><h3>Conditions on real numbers</h3><div data-conditions></div></article>
    <article class="card" data-plain><h3>The formula</h3><div class="tex" data-latex></div></article>
    <article class="card" data-plain><h3>Simplified by AngouriMath</h3><div class="tex" data-simplified></div><p class="foot" data-simplified-check></p></article>
    <article class="card" data-plain><h3>Minimal sum of products</h3><div class="tex" data-sop></div><p class="foot" data-sop-check></p></article>
    <div class="contents" data-outputs hidden></div>
    <article class="card" data-rules-card hidden><h3>Invariants and the fault alarm</h3><div data-rules></div></article>
    <article class="card wide" data-checks-card hidden><h3>Design checks</h3><div data-checks></div></article>
    <article class="card" data-plain data-kmap-card><h3>Karnaugh map</h3><div class="scroll-x" data-kmap></div><p class="foot" data-kmap-note></p></article>
    <article class="card"><h3>Truth table</h3><div data-truth></div></article>
    <article class="card wide" data-plain><h3>Circuit for the simplified form</h3><div class="scroll-x" data-circuit></div></article>
    <article class="card wide" data-pla-card hidden><h3>Circuit: every output, sharing product terms</h3><div class="scroll-x" data-pla></div><p class="foot pla-state" data-pla-state></p><p class="foot">Click an input on the left to switch it; a wire or gate carrying 1 lights up, and an output that is 1 is bold. Two levels, as a PLA draws them: each input on the left in the sense it is needed, an AND gate per product term, shared by every output that uses it, and an OR gate per output. A dot joins wires; wires that cross without one do not touch.</p></article>
  </div>
</div>`;

export function mount(section, am) {
  section.classList.add('doc');
  html(section, MARKUP);
  const input = $(section, '#logic-input'), always = $(section, '#logic-always'), chip = $(section, '[data-chip]'), note = $(section, '[data-note]');
  let mode = 'logic', current = null;

  const pressMode = presets($(section, '[data-modes]'), Object.values(MODES).map((label) => ({ label })),
    (m) => setMode(Object.keys(MODES).find((k) => MODES[k] === m.label)));
  let press = () => {};
  function setMode(m) {
    mode = m;
    pressMode(MODES[m]);
    $(section, '[data-prefix]').textContent = m === 'sets' ? 'S =' : 'ƒ';
    $(section, '[data-prefix]').hidden = m === 'senses';
    gutter.hidden = m !== 'senses';
    $(section, '[data-always-row]').hidden = m !== 'senses';
    $(section, '[data-catalogue]').hidden = m !== 'senses';
    if (m === 'senses') showCatalogue();
    const list = m === 'sets' ? SETS : m === 'senses' ? SENSES : LOGIC;
    press = presets($(section, '[data-presets]'), list, pick);
    pick(list[0]);
  }
  // The formula field is a textarea so that senses mode can take one output per line; it grows
  // with its text, and elsewhere Enter adds no line. In senses mode a gutter numbers each line and
  // marks with ↪ each row that only continues a long one, measured on a hidden copy of the text
  // laid out at the same width, so a new line and a wrapped one look different.
  const gutter = $(section, '[data-gutter]'), measure = $(section, '[data-measure]');
  function fit() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
    if (gutter.hidden) return;
    measure.style.width = `${input.clientWidth}px`;
    measure.replaceChildren(...input.value.split('\n').map((line) => {
      const row = document.createElement('div');
      row.textContent = line || ' ';
      return row;
    }));
    const step = parseFloat(getComputedStyle(input).lineHeight);
    gutter.innerHTML = [...measure.children].map((row, i) =>
      `<div>${i + 1}</div>${'<div class="wrap">↪</div>'.repeat(Math.max(0, Math.round(row.offsetHeight / step) - 1))}`).join('');
  }
  let width = 0;
  new ResizeObserver(() => { if (input.clientWidth !== width) { width = input.clientWidth; fit(); } }).observe(input.parentElement);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && mode !== 'senses') e.preventDefault(); });
  function pick(p) {
    current = p;
    input.value = p.formula;
    fit();
    always.value = p.always || '';
    note.textContent = p.note || '';
    press(p.label);
    analyze();
  }
  const later = debounce(() => { current = null; analyze(); }, 450);
  let typingIn = input;
  for (const field of [input, always]) {
    field.addEventListener('input', () => { fit(); press(null); note.textContent = ''; later(); });
    field.addEventListener('focus', () => { typingIn = field; });
  }

  // The catalogue comes from the C# side, which reads the formula by it, so the two cannot differ.
  let catalogue = null;
  async function showCatalogue() {
    catalogue ??= am.json('LogicJs', 'SenseCatalogue', []).then((c) => {
      const sense = (name) => `<button type="button" data-sense="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
      $(section, '[data-catalogue-grid]').innerHTML = c.pairs.map((p) =>
        `<div>${sense(p.true)} / ${sense(p.false)}${p.source ? `<span>${escapeHtml(p.source)}</span>` : ''}</div>`).join('');
      $(section, '[data-catalogue-rules]').textContent = c.exclusive.map((x) =>
        `Built in: ${x.a} implies ${x.notB} on any channel that has both. ${x.why}`).join(' ');
    });
    try { await catalogue; } catch { catalogue = null; }
  }
  $(section, '[data-catalogue-grid]').addEventListener('click', (e) => {
    const name = e.target.closest('[data-sense]')?.dataset.sense;
    if (!name) return;
    const at = typingIn.selectionStart ?? typingIn.value.length, end = typingIn.selectionEnd ?? at;
    const before = typingIn.value.slice(0, at), gap = before && !/\s$/.test(before) ? ' ' : '';
    typingIn.value = before + gap + name + typingIn.value.slice(end);
    typingIn.focus();
    typingIn.setSelectionRange(at + gap.length + name.length, at + gap.length + name.length);
    typingIn.dispatchEvent(new Event('input'));
  });

  let generation = 0;
  async function analyze() {
    const mine = ++generation, t0 = performance.now();
    let r;
    try {
      r = mode === 'senses'
        ? await am.json('LogicJs', 'Senses', [input.value, always.value])
        : await am.json('LogicJs', mode === 'sets' ? 'Venn' : 'Analyze', [input.value]);
    } catch (e) {
      if (mine === generation) { setChip(chip, 'bad', 'AngouriMath stopped'); $(section, '[data-error]').textContent = e.message; }
      return;
    }
    if (mine !== generation) return;
    $(section, '[data-timing]').textContent = `${Math.round(performance.now() - t0)} ms`;
    if (!r.ok) { setChip(chip, 'warn', 'Not a formula yet'); $(section, '[data-error]').textContent = r.error; return; }
    $(section, '[data-error]').textContent = '';
    const senses = mode === 'senses';
    for (const card of section.querySelectorAll('[data-plain]')) card.hidden = senses;
    for (const card of ['[data-senses-card]', '[data-outputs]', '[data-rules-card]', '[data-pla-card]']) $(section, card).hidden = !senses;
    $(section, '[data-conditions-card]').hidden = !senses || !r.conditions?.length;
    $(section, '[data-checks-card]').hidden = !senses || !r.checks?.length;
    if (senses) {
      $(section, '[data-puzzle]').hidden = $(section, '[data-venn-card]').hidden = true;
      showSenses(r);
      return;
    }
    const vars = r.truth.vars, rows = r.truth.rows;
    const count = rows.filter((row) => row[row.length - 1]).length;
    setChip(chip, 'ok', count === rows.length ? 'Always true' : count === 0 ? 'Never true' : `True in ${count} of ${rows.length} rows`);
    tex($(section, '[data-latex]'), r.latex);
    tex($(section, '[data-simplified]'), r.simplifiedLatex);
    $(section, '[data-simplified-check]').textContent = r.simplifiedEquivalent ? '✓ Equivalent: AngouriMath’s truth table of (formula xor simplified) has no true row.' : 'Not shown equivalent.';
    tex($(section, '[data-sop]'), r.sopLatex);
    $(section, '[data-sop-check]').textContent = r.sopEquivalent ? '✓ Equivalent, checked the same way. Found by Quine–McCluskey with an exact cover.' : 'Not shown equivalent.';
    $(section, '[data-truth]').replaceChildren(truthTable(r.truth));
    $(section, '[data-kmap-card]').hidden = vars.length > 4;
    if (vars.length <= 4) kmap($(section, '[data-kmap]'), vars, rows, r.groups);
    $(section, '[data-kmap-note]').textContent = r.groups.length ? 'Each outline is one product term of the minimal sum; outlines that reach an edge continue on the opposite side.' : '';
    circuit($(section, '[data-circuit]'), r.circuit);

    const puzzle = current?.puzzle;
    $(section, '[data-puzzle]').hidden = !puzzle;
    if (puzzle) {
      const answers = rows.filter((row) => row[row.length - 1]).map((row) =>
        vars.map((v, i) => `${v} is a ${row[i] ? 'knight' : 'knave'}`).join(', '));
      $(section, '[data-answer]').innerHTML = answers.length === 1
        ? `<p style="margin:0;font-size:16px">${escapeHtml(answers[0])}.</p><p class="foot">The only row of the truth table where everything said is consistent.</p>`
        : answers.length === 0 ? '<p style="margin:0">No assignment is consistent: the puzzle has no solution.</p>'
          : `<p style="margin:0">${answers.length} consistent answers:</p><ul>${answers.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`;
    }
    $(section, '[data-venn-card]').hidden = mode !== 'sets';
    if (mode === 'sets') {
      venn($(section, '[data-venn]'), vars, rows);
      $(section, '[data-sets]').textContent = `As sets: ${r.sets}${r.simplifiedSets && r.simplifiedSets !== r.sets ? `, which simplifies to ${r.simplifiedSets}` : ''}.`;
    }
  }

  // The circuit's input values, by label, so that they survive an edit of the formula.
  const switched = new Map();
  function showSenses(r) {
    const n = r.inputs.length, rows = r.truth.rows, possible = r.truth.possible, can = possible.filter(Boolean).length;
    const every = can === rows.length, where = every ? '' : ' that can occur';
    let summary;
    if (r.outputs.length === 1) {
      const count = rows.filter((row, i) => possible[i] && row[n]).length;
      summary = count === can ? (every ? 'Always true' : 'True in every row that can occur')
        : count === 0 ? (every ? 'Never true' : 'Never true in a row that can occur') : `True in ${count} of ${can} rows${where}`;
    } else
      summary = `${r.outputs.length} outputs of ${n} inputs, ${every ? `all ${rows.length} rows can occur` : `${can} of ${rows.length} rows can occur`}`;
    const failing = r.checks.filter((c) => !c.holds).length;
    if (r.checks.length)
      summary += failing ? `; ${failing} of ${r.checks.length} design checks fail` : `; ${r.checks.length === 1 ? 'the design check holds' : `all ${r.checks.length} design checks hold`}`;
    setChip(chip, failing ? 'warn' : 'ok', summary);
    $(section, '[data-senses]').innerHTML = sensesTable(r.senses);
    conditions($(section, '[data-conditions]'), r);
    $(section, '[data-outputs]').replaceChildren(...r.outputs.map((o, k) => outputCard(o, k, r)));
    rules($(section, '[data-rules]'), r);
    designChecks($(section, '[data-checks]'), r);
    $(section, '[data-truth]').replaceChildren(truthTable(r.truth));
    const paint = pla($(section, '[data-pla]'), r.inputs, r.outputs, (i) => {
      switched.set(r.inputs[i].label, !(switched.get(r.inputs[i].label) ?? false));
      simulate();
    });
    function simulate() {
      const values = r.inputs.map((input) => switched.get(input.label) ?? false), results = paint(values);
      const index = values.reduce((sum, v) => sum * 2 + (v ? 1 : 0), 0), state = $(section, '[data-pla-state]');
      state.classList.toggle('fail', !possible[index]);
      state.textContent = possible[index]
        ? r.outputs.map((o, k) => `${o.name || 'ƒ'} = ${results[k] ? 1 : 0}`).join(', ')
        : 'These inputs cannot occur: the invariants rule them out, so the fault alarm is on, and the outputs are whatever the minimal forms make of a don’t-care.';
      section.querySelectorAll('[data-truth] tbody tr').forEach((tr, i) => tr.classList.toggle('current', i === index));
    }
    simulate();
  }

  setMode('logic');
  return { show() {}, hide() {} };
}

// ---------------------------------------------------------------- senses

function sensesTable(list) {
  const body = list.map((s) => `<tr><td>${escapeHtml(s.word)}${s.output ? ' <em>output</em>' : ''}</td><td>${s.negated ? 'not ' : ''}${escapeHtml(s.letter)}</td>`
    + (s.pair ? `<td>${escapeHtml(s.pair)}</td><td>${escapeHtml(s.source || '')}</td>`
      : `<td colspan="2">${s.condition ? `a condition: true when ${escapeHtml(s.condition)}` : 'not in the catalogue: a letter of its own'}</td>`)
    + '</tr>').join('');
  return `<table class="senses"><thead><tr><th>written</th><th>reads as</th><th>pair</th><th>source</th></tr></thead><tbody>${body}</tbody></table>`;
}

function conditions(box, r) {
  box.replaceChildren();
  for (const c of r.conditions) {
    const row = document.createElement('div');
    row.className = 'condition';
    row.innerHTML = `<span>${c.name ? escapeHtml(c.name) : 'in a formula'}</span><div class="tex"></div>`;
    tex(row.lastElementChild, c.latex, false);
    box.append(row);
  }
  const foot = document.createElement('p');
  foot.className = 'foot';
  foot.textContent = ['Each comparison is one input, true where it holds; its negation is written turned round, as T ≤ 100 for not (T > 100). How comparisons on one number constrain each other is worked out by AngouriMath and listed with the invariants.', ...r.notes].join(' ');
  box.append(foot);
}

function designChecks(box, r) {
  box.replaceChildren();
  for (const c of r.checks) {
    const item = document.createElement('div');
    item.className = 'check';
    const when = c.holds ? [] : c.whenTerms;
    item.innerHTML = `<div class="tex"></div><p class="foot ${c.holds ? 'pass' : 'fail'}"></p>`
      + when.map(() => '<div class="tex"></div>').join('') + (c.holds ? '' : '<p class="foot"></p>');
    tex(item.children[0], c.latex);
    item.children[1].textContent = c.holds
      ? '✓ Holds in every row that can occur: AngouriMath’s truth table of (invariants and not check), with each output replaced by its formula, has no true row.'
      : `✗ Fails in ${c.broken} of the ${c.occur} rows that can occur, exactly when ${when.length > 1 ? 'any of these holds' : 'this holds'}:`;
    when.forEach((latex, i) => tex(item.children[2 + i], latex));
    if (!c.holds) item.lastElementChild.textContent = `For example: ${c.example}.`;
    box.append(item);
  }
  const foot = document.createElement('p');
  foot.className = 'foot';
  foot.textContent = 'A line of the always field that mentions an output is a check on the design rather than a fact about the plant: it does not decide which rows can occur, it has to hold in all of them.';
  box.append(foot);
}

function outputCard(o, k, r) {
  const n = r.inputs.length, card = document.createElement('article');
  card.className = 'card wide';
  card.innerHTML = `<h3>${o.name ? `Output <span class="name">${escapeHtml(o.name)}</span>` : 'The formula'}</h3>
    <div class="output-grid">
      <div>
        <div class="tex" data-k="written"></div>
        <div data-k="letters-box"><p class="foot">In letters</p><div class="tex" data-k="letters"></div></div>
        <p class="foot">Simplified by AngouriMath, which knows the logic but not the invariants</p>
        <div class="tex" data-k="simplified"></div><p class="foot" data-k="simplified-check"></p>
        <p class="foot"><strong>Minimal, using the invariants</strong></p>
        <div class="tex" data-k="minimal"></div><p class="foot" data-k="minimal-check"></p>
      </div>
      <div data-k="kmap-box"><div class="scroll-x" data-k="kmap"></div><p class="foot" data-k="kmap-note"></p></div>
    </div>`;
  const q = (key) => card.querySelector(`[data-k="${key}"]`);
  const named = (latex) => (o.nameLatex && latex ? `${o.nameLatex} = ${latex}` : latex);
  tex(q('written'), named(o.latex));
  q('letters-box').hidden = o.lettersLatex === o.latex;
  tex(q('letters'), named(o.lettersLatex));
  tex(q('simplified'), named(o.simplifiedLatex));
  q('simplified-check').textContent = o.simplifiedEquivalent ? '✓ Equivalent: AngouriMath’s truth table of (formula xor simplified) has no true row.' : 'Not shown equivalent.';
  tex(q('minimal'), named(o.sopLatex));
  q('minimal-check').textContent = o.sopEquivalent
    ? '✓ Equal to the formula wherever the invariants hold: AngouriMath’s truth table of (formula xor minimal) and invariants has no true row. Found by Quine–McCluskey, with the rows that cannot occur as don’t-cares.'
    : 'Not shown equivalent.';
  if (n <= 4) {
    kmap(q('kmap'), r.truth.vars, r.truth.rows.map((row) => [...row.slice(0, n), row[n + k]]), o.groups, r.dontCares);
    q('kmap-note').textContent = (o.groups.length ? 'Karnaugh map: each outline is one product term of the minimal form, and outlines that reach an edge continue on the opposite side.' : 'Karnaugh map.')
      + (r.dontCares.length ? ' A dash is a row the invariants rule out, so an outline may cover it or not.' : '');
  } else
    q('kmap-box').innerHTML = '<p class="foot">More than four inputs, so no Karnaugh map; the truth table has every row.</p>';
  return card;
}

function rules(box, r) {
  box.replaceChildren();
  if (!r.rules.length) {
    box.innerHTML = '<p class="foot" style="margin-top:0">None: every row can occur. Facts about the plant go in the always field, separated by semicolons, for example Running_motor implies Enabled_motor.</p>';
    return;
  }
  for (const rule of r.rules) {
    const item = document.createElement('div');
    item.innerHTML = `<div class="tex"></div><p class="foot">${rule.builtin ? `Built in. ${escapeHtml(rule.why)}` : 'Yours.'}</p>`;
    tex(item.firstElementChild, rule.latex);
    box.append(item);
  }
  const fault = document.createElement('div'), terms = r.faultTerms?.length > 1 ? r.faultTerms : [r.faultLatex];
  fault.innerHTML = `<p class="foot" style="font-weight:600;color:var(--ink)">Fault alarm${terms.length > 1 ? ', when any of these holds' : ''}</p>`
    + terms.map(() => '<div class="tex"></div>').join('') + '<p class="foot"></p>';
  terms.forEach((latex, i) => tex(fault.children[1 + i], latex));
  fault.lastElementChild.textContent = r.faultNever ? 'The invariants hold in every row, so they rule nothing out and nothing can contradict them.'
    : `True exactly in the rows the invariants rule out, so with correct signals it never fires: when it does, a sensor or its wiring is wrong.${r.faultEquivalent ? ' ✓ Equivalent to not (invariants), checked by truth table.' : ''}`;
  box.append(fault);
}

// ---------------------------------------------------------------- Karnaugh map

const GRAY = [[0], [0, 1], [0, 1, 3, 2]];

function kmap(box, vars, rows, groups, dontCares = []) {
  const n = vars.length, impossible = new Set(dontCares);
  const rowVars = n <= 1 ? 0 : n === 2 ? 1 : n === 3 ? 1 : 2, colVars = n - rowVars;
  const rowCodes = rowVars === 0 ? [0] : GRAY[rowVars], colCodes = colVars === 1 ? [0, 1] : GRAY[colVars];
  const minterm = (r, c) => (rowCodes[r] << colVars) | colCodes[c];
  const value = (m) => rows[m][n];
  // Letters label the corner as "ab \ cd"; names label the row codes and the column codes apart.
  const named = vars.some((v) => v.length > 1);
  const rowLabel = vars.slice(0, rowVars).join(named ? ', ' : ''), colLabel = vars.slice(rowVars).join(named ? ', ' : '');
  const C = 54, X0 = named ? Math.max(70, rowLabel.length * 7 + 16) : 70, Y0 = 46;
  const W = Math.max(X0 + colCodes.length * C + 16, named ? X0 + colCodes.length * C / 2 + colLabel.length * 3.5 + 8 : 0), H = Y0 + rowCodes.length * C + 16;
  const bits = (code, k) => code.toString(2).padStart(k, '0');
  const label = 'font-size="12" style="fill:var(--ink-soft)"';
  let svg = named
    ? `<text x="${X0 - 10}" y="${Y0 - 10}" ${label} text-anchor="end">${escapeHtml(rowLabel)}</text>`
      + `<text x="${X0 + colCodes.length * C / 2}" y="${Y0 - 28}" ${label} text-anchor="middle">${escapeHtml(colLabel)}</text>`
    : `<text x="${X0 - 10}" y="${Y0 - 26}" ${label} text-anchor="end">${escapeHtml(rowLabel)} \\ ${escapeHtml(colLabel)}</text>`;
  colCodes.forEach((code, c) => {
    svg += `<text x="${X0 + c * C + C / 2}" y="${Y0 - 10}" font-size="12" text-anchor="middle" style="fill:var(--ink-soft);font-family:var(--font-mono)">${bits(code, colVars)}</text>`;
  });
  rowCodes.forEach((code, r) => {
    if (rowVars) svg += `<text x="${X0 - 10}" y="${Y0 + r * C + C / 2 + 4}" font-size="12" text-anchor="end" style="fill:var(--ink-soft);font-family:var(--font-mono)">${bits(code, rowVars)}</text>`;
    colCodes.forEach((_, c) => {
      const m = minterm(r, c), v = !impossible.has(m) && value(m);
      const fill = impossible.has(m) ? 'color-mix(in srgb, var(--ink-soft) 12%, var(--surface))' : v ? 'color-mix(in srgb, var(--ok) 16%, var(--surface))' : 'var(--surface)';
      svg += `<rect x="${X0 + c * C}" y="${Y0 + r * C}" width="${C}" height="${C}" style="fill:${fill};stroke:var(--rule)"/>`;
      svg += `<text x="${X0 + c * C + C / 2}" y="${Y0 + r * C + C / 2 + 6}" font-size="17" text-anchor="middle" style="fill:${v ? 'var(--ok)' : 'var(--ink-soft)'};font-family:var(--font-mono)">${impossible.has(m) ? '–' : v ? 1 : 0}</text>`;
    });
  });
  // A group is a product of a cyclic run of rows and a cyclic run of columns; a run that wraps
  // is drawn as two pieces.
  const colours = ['--plot-1', '--plot-2', '--plot-3', '--plot-4', '--plot-5'];
  const runs = (indices, size) => {
    const set = new Set(indices);
    if (set.size === size) return [[0, size - 1]];
    let start = [...set].find((i) => !set.has((i - 1 + size) % size));
    const out = [];
    let a = start, b = start;
    while (set.has((b + 1) % size) && (b + 1) % size !== start) b = (b + 1) % size;
    if (b >= a) out.push([a, b]);
    else { out.push([a, size - 1]); out.push([0, b]); }
    return out;
  };
  groups.forEach((g, k) => {
    const covered = (m) => (m & g.mask) === g.value;
    const rs = [], cs = [];
    rowCodes.forEach((_, r) => { if (colCodes.some((__, c) => covered(minterm(r, c)))) rs.push(r); });
    colCodes.forEach((_, c) => { if (rowCodes.some((__, r) => covered(minterm(r, c)))) cs.push(c); });
    const inset = 5 + 4 * (k % 4);
    for (const [r0, r1] of runs(rs, rowCodes.length))
      for (const [c0, c1] of runs(cs, colCodes.length))
        svg += `<rect x="${X0 + c0 * C + inset}" y="${Y0 + r0 * C + inset}" width="${(c1 - c0 + 1) * C - 2 * inset}" height="${(r1 - r0 + 1) * C - 2 * inset}" rx="12" style="fill:none;stroke:var(${colours[k % colours.length]});stroke-width:2.5"/>`;
  });
  box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Karnaugh map with the groups of the minimal sum of products">${svg}</svg>`;
}

// ---------------------------------------------------------------- circuit

function circuit(box, tree) {
  if (!tree) { box.textContent = ''; return; }
  const nodes = [];
  let leaves = 0, depth = 0;
  (function place(n, d) {
    depth = Math.max(depth, d);
    const node = { label: n.t, d, kids: (n.c || []).map((c) => place(c, d + 1)) };
    node.y = node.kids.length ? (node.kids[0].y + node.kids[node.kids.length - 1].y) / 2 : leaves++;
    // An input's box fits its name; the columns widen so a wire leaves it before turning.
    node.w = node.kids.length ? 44 : Math.max(36, n.t.length * 7 + 12);
    nodes.push(node);
    return node;
  })(tree, 0);
  const DX = Math.max(92, ...nodes.map((n) => n.w / 2 + 34)), DY = 46, W = (depth + 1) * DX + 80, H = Math.max(leaves, 1) * DY + 20;
  // The output is on the right, inputs on the left.
  const pos = (n) => [W - 60 - n.d * DX, n.y * DY + DY / 2 + 10];
  const stroke = 'stroke:var(--ink);stroke-width:1.6;fill:none';
  const body = 'stroke:var(--ink);stroke-width:1.6;fill:var(--surface)';
  let svg = '';
  for (const n of nodes)
    n.kids.forEach((k, i) => {
      const [x1, y1] = pos(n), [x2, y2] = pos(k);
      const inY = y1 + (n.kids.length > 1 ? (i - (n.kids.length - 1) / 2) * 10 : 0), mid = Math.max((x1 - 22 + x2 + 22) / 2, x2 + k.w / 2 + 10);
      svg += `<path d="M${x2 + (k.kids.length ? 22 : k.w / 2)} ${y2} H${mid} V${inY} H${x1 - 20}" style="${stroke}"/>`;
    });
  const [ox, oy] = pos(nodes[nodes.length - 1]);
  svg += `<path d="M${ox + 22} ${oy} H${ox + 46}" style="${stroke}"/><circle cx="${ox + 48}" cy="${oy}" r="3" style="fill:var(--ink)"/>`;
  for (const n of nodes) {
    const [x, y] = pos(n);
    if (!n.kids.length) {
      svg += `<rect x="${x - n.w / 2}" y="${y - 12}" width="${n.w}" height="24" rx="6" style="fill:var(--code);stroke:var(--rule)"/>`;
      svg += `<text x="${x}" y="${y + 4}" font-size="12" text-anchor="middle" style="fill:var(--ink);font-family:var(--font-mono)">${escapeHtml(n.label)}</text>`;
      continue;
    }
    const g = n.label;
    if (g === 'and') svg += `<path d="M${x - 20} ${y - 16} H${x} A16 16 0 0 1 ${x} ${y + 16} H${x - 20} Z" style="${body}"/>`;
    else if (g === 'or' || g === 'xor') {
      svg += `<path d="M${x - 20} ${y - 16} Q${x + 6} ${y - 16} ${x + 20} ${y} Q${x + 6} ${y + 16} ${x - 20} ${y + 16} Q${x - 10} ${y} ${x - 20} ${y - 16} Z" style="${body}"/>`;
      if (g === 'xor') svg += `<path d="M${x - 26} ${y - 16} Q${x - 16} ${y} ${x - 26} ${y + 16}" style="${stroke}"/>`;
    } else if (g === 'not') svg += `<path d="M${x - 18} ${y - 12} L${x + 12} ${y} L${x - 18} ${y + 12} Z" style="${body}"/><circle cx="${x + 16}" cy="${y}" r="4" style="${body}"/>`;
    else svg += `<rect x="${x - 20}" y="${y - 14}" width="42" height="28" rx="4" style="${body}"/><text x="${x + 1}" y="${y + 4}" font-size="11" text-anchor="middle" style="fill:var(--ink)">${escapeHtml(g === 'implies' ? '→' : g)}</text>`;
  }
  box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gate circuit of the simplified formula, inputs on the left">${svg}</svg>`;
}

// ---------------------------------------------------------------- circuit of several outputs

// Two levels, as a PLA draws them: each literal once on the left with a vertical rail, an AND gate
// per product term shared by every output that uses it, a rail per term, and an OR gate per output
// with its name on the right. A term of one literal needs no AND, and an output of one term no OR.
function pla(box, inputs, outputs, onToggle) {
  const n = inputs.length;
  const terms = [], byKey = new Map();
  outputs.forEach((o, k) => o.groups.forEach((g) => {
    const key = `${g.mask}:${g.value}`;
    if (!byKey.has(key)) {
      const lits = [];
      for (let i = 0; i < n; i++) {
        const bit = 1 << (n - 1 - i);
        if (g.mask & bit) lits.push(`${i}:${g.value & bit ? 1 : 0}`);
      }
      byKey.set(key, { lits, outs: [] });
      terms.push(byKey.get(key));
    }
    byKey.get(key).outs.push(k);
  }));
  const used = [];
  for (let i = 0; i < n; i++)
    for (const v of [1, 0]) if (terms.some((t) => t.lits.includes(`${i}:${v}`))) used.push(`${i}:${v}`);
  const label = (lit) => { const [i, v] = lit.split(':').map(Number); return v ? inputs[i].label : inputs[i].opposite; };
  const ofOutput = outputs.map((_, k) => terms.filter((t) => t.outs.includes(k)));

  // Rows: each column is stacked on its own and centred on the tallest.
  const PITCH = 34, PIN = 12, gap = (m) => Math.max(PITCH, m * PIN + 14);
  const stack = (sizes) => { let y = 0; return sizes.map((s) => { const at = y + s / 2; y += s; return at; }).concat([y]); };
  const litYs = stack(used.map(() => PITCH)), termYs = stack(terms.map((t) => gap(t.lits.length))), outYs = stack(ofOutput.map((ts) => gap(ts.length)));
  const H = Math.max(litYs.pop(), termYs.pop(), outYs.pop()) + 24;
  const centre = (ys, h) => ys.map((y) => y + (H - h) / 2);
  const ly = centre(litYs, used.length * PITCH), ty = centre(termYs, terms.reduce((s, t) => s + gap(t.lits.length), 0)), oy = centre(outYs, ofOutput.reduce((s, ts) => s + gap(ts.length), 0));

  // Columns, left to right. Every wire, gate and box carries the signal it shows (l: a literal,
  // t: a product term, o: an output), so that painting it is a matter of classes.
  const LW = Math.max(40, ...used.map((l) => label(l).length * 7 + 14)), rail1 = (j) => 8 + LW + 18 + j * 14;
  const XA = rail1(Math.max(used.length - 1, 0)) + 50, TIP = XA + 22, rail2 = (t) => TIP + 18 + t * 14;
  const XO = rail2(Math.max(terms.length - 1, 0)) + 50, OUT = XO + 20;
  const W = OUT + 30 + Math.max(...outputs.map((o) => (o.name || 'ƒ').length * 8)) + 12;
  let wires = '', parts = '';
  const path = (sig, d) => `<path class="w" data-sig="${sig}" d="${d}"/>`;
  const dot = (sig, x, y) => `<circle class="d" data-sig="${sig}" cx="${x}" cy="${y}" r="3"/>`;
  const constant = (x, y, text) => `<rect class="k" x="${x - 14}" y="${y - 12}" width="28" height="24" rx="6"/><text class="kt" x="${x}" y="${y + 4}" text-anchor="middle">${text}</text>`;
  // A rail joins an entry to its taps; a dot marks each point that is not an end of the rail.
  const rail = (sig, x, entry, taps) => {
    const ys = [entry, ...taps], lo = Math.min(...ys), hi = Math.max(...ys);
    wires += path(sig, `M${x} ${lo} V${hi}`);
    for (const y of new Set(ys)) if (y > lo && y < hi) wires += dot(sig, x, y);
  };
  const pins = (count, y) => Array.from({ length: count }, (_, i) => y + (i - (count - 1) / 2) * PIN);

  used.forEach((lit, j) => {
    const sig = `l:${lit}`, taps = [];
    terms.forEach((t, ti) => {
      const at = t.lits.indexOf(lit);
      if (at < 0) return;
      const y = t.lits.length === 1 ? ty[ti] : pins(t.lits.length, ty[ti])[at];
      taps.push(y);
      wires += path(sig, `M${rail1(j)} ${y} H${t.lits.length === 1 ? TIP : XA - 20}`);
    });
    wires += path(sig, `M${8 + LW} ${ly[j]} H${rail1(j)}`);
    rail(sig, rail1(j), ly[j], taps);
    parts += `<g class="lit" data-lit="${lit}" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(label(lit))}">`
      + `<rect x="8" y="${ly[j] - 12}" width="${LW}" height="24" rx="6"/><text x="${8 + LW / 2}" y="${ly[j] + 4}" text-anchor="middle">${escapeHtml(label(lit))}</text></g>`;
  });
  terms.forEach((t, ti) => {
    const y = ty[ti], hh = gap(t.lits.length) / 2 - 6, sig = `t:${ti}`;
    if (t.lits.length === 0) parts += constant(XA, y, '1');
    else if (t.lits.length > 1) parts += `<path class="g" data-sig="${sig}" d="M${XA - 20} ${y - hh} H${XA} Q${TIP} ${y - hh} ${TIP} ${y} Q${TIP} ${y + hh} ${XA} ${y + hh} H${XA - 20} Z"/>`;
    const taps = [];
    outputs.forEach((_, k) => {
      const at = ofOutput[k].indexOf(t);
      if (at < 0) return;
      const single = ofOutput[k].length === 1, py = single ? oy[k] : pins(ofOutput[k].length, oy[k])[at];
      taps.push(py);
      wires += path(sig, `M${rail2(ti)} ${py} H${single ? OUT : XO - 16}`);
    });
    wires += path(sig, `M${t.lits.length === 0 ? XA + 14 : TIP} ${y} H${rail2(ti)}`);
    rail(sig, rail2(ti), y, taps);
  });
  outputs.forEach((o, k) => {
    const y = oy[k], m = ofOutput[k].length, hh = gap(m) / 2 - 6, sig = `o:${k}`;
    if (m === 0) parts += constant(XO, y, '0') + path(sig, `M${XO + 14} ${y} H${OUT}`);
    else if (m > 1) parts += `<path class="g" data-sig="${sig}" d="M${XO - 20} ${y - hh} Q${XO + 6} ${y - hh} ${OUT} ${y} Q${XO + 6} ${y + hh} ${XO - 20} ${y + hh} Q${XO - 10} ${y} ${XO - 20} ${y - hh} Z"/>`;
    parts += path(sig, `M${OUT} ${y} H${OUT + 16}`) + dot(sig, OUT + 16, y)
      + `<text class="out" data-sig="${sig}" x="${OUT + 26}" y="${y + 4}">${escapeHtml(o.name || 'ƒ')}</text>`;
  });
  box.innerHTML = `<svg class="pla" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Two-level circuit of every output: inputs on the left switch on a click, outputs on the right">${wires}${parts}</svg>`;

  // A click or Enter on an input box switches that input.
  const svg = box.firstElementChild;
  const toggle = (e) => {
    const lit = e.target.closest('[data-lit]')?.dataset.lit;
    if (!lit || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onToggle(Number(lit.split(':')[0]));
  };
  svg.addEventListener('click', toggle);
  svg.addEventListener('keydown', toggle);

  // Paints the circuit for the inputs' values: a literal that holds gets a bold outline, a wire or
  // gate carrying 1 is lit, and an output that is 1 is bold. Returns the outputs' values.
  return (values) => {
    const on = new Set(used.filter((lit) => { const [i, v] = lit.split(':').map(Number); return values[i] === (v === 1); }).map((lit) => `l:${lit}`));
    terms.forEach((t, ti) => { if (t.lits.every((lit) => on.has(`l:${lit}`))) on.add(`t:${ti}`); });
    outputs.forEach((_, k) => { if (ofOutput[k].some((t) => on.has(`t:${terms.indexOf(t)}`))) on.add(`o:${k}`); });
    for (const el of svg.querySelectorAll('[data-sig]')) el.classList.toggle('on', on.has(el.dataset.sig));
    for (const el of svg.querySelectorAll('[data-lit]')) {
      el.classList.toggle('on', on.has(`l:${el.dataset.lit}`));
      el.setAttribute('aria-pressed', String(on.has(`l:${el.dataset.lit}`)));
    }
    return outputs.map((_, k) => on.has(`o:${k}`));
  };
}

// ---------------------------------------------------------------- Venn diagram

function venn(canvas, vars, rows) {
  const [w, h] = fitCanvas(canvas, 2);
  const ctx = canvas.getContext('2d'), s = w / canvas.clientWidth;
  const r = Math.min(w, h) * 0.27, cx = w / 2, cy = h / 2 + r * 0.08;
  const circles = vars.length === 1 ? [[cx, cy]]
    : vars.length === 2 ? [[cx - r * 0.55, cy], [cx + r * 0.55, cy]]
      : [[cx - r * 0.55, cy - r * 0.35], [cx + r * 0.55, cy - r * 0.35], [cx, cy + r * 0.6]];
  const img = ctx.createImageData(w, h), fill = token('--plot-1'), bg = token('--surface');
  const parse = (c) => { const p = document.createElement('span'); p.style.color = c; document.body.append(p); const m = getComputedStyle(p).color.match(/[\d.]+/g).map(Number); p.remove(); return m; };
  const on = parse(fill), off = parse(bg);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let index = 0;
      circles.forEach(([px, py], i) => { if ((x - px) ** 2 + (y - py) ** 2 <= r * r) index |= 1 << (vars.length - 1 - i); });
      const lit = rows[index][vars.length];
      const c = lit ? on : off, k = (y * w + x) * 4;
      img.data[k] = lit ? c[0] * 0.45 + off[0] * 0.55 : c[0];
      img.data[k + 1] = lit ? c[1] * 0.45 + off[1] * 0.55 : c[1];
      img.data[k + 2] = lit ? c[2] * 0.45 + off[2] * 0.55 : c[2];
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = token('--rule');
  ctx.lineWidth = 1.5 * s;
  ctx.strokeRect(0.5 * s, 0.5 * s, w - s, h - s);
  ctx.strokeStyle = token('--ink');
  ctx.lineWidth = 2 * s;
  ctx.fillStyle = token('--ink');
  ctx.font = `italic ${18 * s}px ${token('--font-display')}`;
  const labels = [[-1.05, -0.95], [1.05, -0.95], [0, 1.25]];
  circles.forEach(([px, py], i) => {
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
    const [lx, ly] = vars.length === 1 ? [0, -1.2] : labels[i];
    ctx.fillText(vars[i], px + lx * r * 0.85 - 6 * s, py + ly * r * 0.85 + 6 * s);
  });
}
