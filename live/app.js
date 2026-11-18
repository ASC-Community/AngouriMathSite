import { createAngouri } from './am.js';

// Each demo is a module with mount(section, am) returning { show(), hide() }, and restarted() if it
// keeps something in the worker that a restart loses; it is loaded the first time its tab opens.
const VIEWS = {
  waves: () => import('./views/waves.js'),
  forms: () => import('./views/representations.js'),
  shapes: () => import('./views/shapes.js'),
  calculus: () => import('./views/calculus.js'),
  logic: () => import('./views/logic.js'),
  regions: () => import('./views/regions.js'),
  motion: () => import('./views/motion.js'),
  numbers: () => import('./views/numbers.js'),
  matrices: () => import('./views/matrices.js'),
};

const runtime = document.getElementById('runtime');
const am = createAngouri((status) => {
  runtime.dataset.state = status.state;
  if (status.state === 'loading') runtime.textContent = `Loading AngouriMath: ${status.loaded} of ${status.total} files`;
  else if (status.state === 'ready') {
    const size = status.bytes > 0 ? `, ${(status.bytes / 1e6).toFixed(1)} MB` : '';
    runtime.textContent = `AngouriMath ready in ${status.seconds.toFixed(1)} s${size}, running in this tab`;
    runtime.title = 'AngouriMath runs here as WebAssembly, in a background worker. Nothing is sent to a server.';
    if (status.restarted) for (const { view } of mounted.values()) view?.restarted?.();
  } else if (status.state === 'restarting') runtime.textContent = 'Restarting AngouriMath';
  else if (status.state === 'failed') runtime.textContent = `AngouriMath could not start: ${status.error}`;
});

const mounted = new Map();
let current = null;

// A hash is the tab's name, optionally with a query a view reads when shown: #matrices?a=...
const route = () => location.hash.slice(1).split('?')[0];

async function show(name) {
  if (!VIEWS[name]) name = 'waves';
  for (const a of document.querySelectorAll('#tabs a')) {
    const here = a.getAttribute('href') === `#${name}`;
    a.setAttribute('aria-current', here ? 'page' : 'false');
    // The bar scrolls sideways when the tabs do not fit; keep the open one in sight.
    if (here) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (current === name) return;
  if (current) {
    const old = mounted.get(current);
    old.section.hidden = true;
    old.view?.hide();
  }
  current = name;
  let entry = mounted.get(name);
  if (!entry) {
    const section = document.createElement('section');
    section.className = 'view';
    section.id = `view-${name}`;
    document.getElementById('views').append(section);
    entry = { section, view: null };
    mounted.set(name, entry);
    const module = await VIEWS[name]();
    entry.view = module.mount(section, am);
  }
  if (current !== name) return;
  entry.section.hidden = false;
  entry.view.show();
}

addEventListener('hashchange', () => show(route()));
show(route());
