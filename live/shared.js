// Helpers the demos share: DOM, WebGL, LaTeX through MathJax, and the panel's parts.

export const $ = (root, selector) => root.querySelector(selector);

export function html(root, markup) {
  root.innerHTML = markup;
  return root;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Reads a CSS custom property, so canvas drawing follows the theme. */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------- panel parts

export function setChip(chip, kind, text) {
  chip.dataset.kind = kind;
  chip.textContent = text;
}

/** Fills a .presets group; returns a function that marks one as pressed (or none). */
export function presets(group, items, onPick) {
  group.replaceChildren(...items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = item.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onPick(item));
    return b;
  }));
  return (label) => {
    for (const b of group.children) b.setAttribute('aria-pressed', String(b.textContent === label));
  };
}

/** Wires a GLSL/HLSL code block: tabs, copy button. Returns set(glsl, hlsl, note). */
export function codeBlock(root) {
  const state = { glsl: '', hlsl: '', tab: 'glsl' };
  const pre = $(root, 'pre'), glslTab = $(root, '[data-tab="glsl"]'), hlslTab = $(root, '[data-tab="hlsl"]');
  const copy = $(root, '[data-copy]'), note = $(root, '[data-note]');
  const render = () => {
    glslTab.setAttribute('aria-selected', String(state.tab === 'glsl'));
    hlslTab.setAttribute('aria-selected', String(state.tab === 'hlsl'));
    pre.textContent = state[state.tab];
  };
  glslTab.addEventListener('click', () => { state.tab = 'glsl'; render(); });
  hlslTab.addEventListener('click', () => { state.tab = 'hlsl'; render(); });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.textContent);
      copy.textContent = 'Copied';
    } catch {
      getSelection().selectAllChildren(pre);
      copy.textContent = 'Selected';
    }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  });
  return (glsl, hlsl, text) => {
    state.glsl = glsl;
    state.hlsl = hlsl;
    if (text !== undefined && note) note.textContent = text;
    render();
  };
}

export const CODE_BLOCK = `
  <div class="code-bar" role="tablist" aria-label="Shader language">
    <button type="button" role="tab" data-tab="glsl" aria-selected="true">GLSL, running here</button>
    <button type="button" role="tab" data-tab="hlsl" aria-selected="false">HLSL, for Unity</button>
    <button type="button" class="ghost" data-copy>Copy</button>
  </div>
  <p class="foot" data-note></p>
  <pre role="tabpanel" tabindex="0"></pre>`;

/** Collapsible panel header. */
export function collapsible(panel) {
  const button = $(panel, '[data-collapse]');
  button.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    button.textContent = collapsed ? 'Show' : 'Hide';
    button.setAttribute('aria-expanded', String(!collapsed));
  });
}

// ---------------------------------------------------------------- LaTeX

let mathjax = null;

function loadMathJax() {
  if (!mathjax) {
    window.MathJax = { svg: { fontCache: 'local' }, startup: { typeset: false } };
    mathjax = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js';
      s.async = true;
      // Nodes are placed by hand rather than typeset in the page, so MathJax's stylesheet
      // (which hides the assistive MathML copy) has to be added by hand too.
      s.onload = () => window.MathJax.startup.promise
        .then(() => document.head.append(window.MathJax.svgStylesheet()))
        .then(resolve, reject);
      s.onerror = () => reject(new Error('MathJax did not load'));
      document.head.append(s);
    });
  }
  return mathjax;
}

/** Renders LaTeX into el; until MathJax is there (or if it never comes) the source shows. */
export function tex(el, latex, display = true) {
  el.dataset.tex = latex || '';
  if (!latex) {
    el.textContent = '–';
    return;
  }
  if (!el.firstElementChild || el.firstElementChild.tagName !== 'MJX-CONTAINER') {
    el.innerHTML = `<span class="tex-raw">${escapeHtml(latex)}</span>`;
  }
  loadMathJax()
    .then(() => window.MathJax.tex2svgPromise(latex, { display }))
    .then((node) => { if (el.dataset.tex === latex) el.replaceChildren(node); })
    .catch(() => { if (el.dataset.tex === latex) el.innerHTML = `<span class="tex-raw">${escapeHtml(latex)}</span>`; });
}

// ---------------------------------------------------------------- WebGL

export function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log);
  }
  return s;
}

/** Links a program; its uniforms are in .loc by name (arrays without [0]). */
export function linkProgram(gl, vsSrc, fsSrc, attrib = 'aPos') {
  const p = gl.createProgram();
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc), fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, attrib);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(log);
  }
  const loc = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    loc[name] = gl.getUniformLocation(p, name);
  }
  return { program: p, loc };
}

/** A vertex array holding one triangle that covers the screen. */
export function fullscreenTriangle(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export const FULLSCREEN_VS = `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Matches the canvas's drawing buffer to its size on screen; returns [width, height]. */
export function fitCanvas(canvas, maxDpr = 1.75) {
  const dpr = Math.min(devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return [w, h];
}

/** A requestAnimationFrame loop that runs only while started. */
export function loop(frame) {
  let id = 0, last = 0;
  const tick = (now) => {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    frame(dt, now);
    id = requestAnimationFrame(tick);
  };
  return {
    start() { if (!id) { last = 0; id = requestAnimationFrame(tick); } },
    stop() { cancelAnimationFrame(id); id = 0; },
  };
}

/** Rgb in 0..1 from a CSS colour token, for shaders. */
export function rgb(name) {
  const probe = document.createElement('span');
  probe.style.color = token(name);
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
  probe.remove();
  return [m[0] / 255, m[1] / 255, m[2] / 255];
}
