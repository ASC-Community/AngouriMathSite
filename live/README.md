# AngouriMath Live

[AngouriMath](https://github.com/asc-community/AngouriMath) running in the browser as WebAssembly, with
no server. It has nine pages, each a formula box, and the library computes every answer on them in a
Web Worker. It is served at [am.angouri.org/live](https://am.angouri.org/live/), the web app of
[AngouriMath#1692](https://github.com/asc-community/AngouriMath/issues/1692).

| Page | What the library does there |
|---|---|
| Waves | checks the units of a wave's frequency formula (`MathS.Dimensions.Of`), differentiates the surface, prints GLSL and HLSL (`MathS.Shaders`); the page runs the GLSL |
| Representations | one formula as text, Unicode, LaTeX, SymPy, expanded, factorised, its tree, a shader and a picture; `MathS.AreEqual` against a second formula |
| Shapes | an implicit surface, ray-marched with its exact gradient and Hessian |
| Calculus | derivatives, an antiderivative, roots, extrema and inflections by solving, limits, Taylor polynomials, an area |
| Logic | a truth table, the simplified form, a Karnaugh map, a circuit, a Venn diagram; signals read through a catalogue of senses |
| Regions | a statement in x and y as a region on the GPU, its boundaries intersected exactly; a set on the number line |
| Motion | a Lagrangian checked for units, its equations of motion derived, then integrated and drawn |
| Numbers | exact values, a thousand digits, primality, factors, other bases, the complex plane |
| Matrices | determinant, inverse, reduced row echelon form, powers, eigenvalues and eigenvectors |

## Build and run

`dotnet fsi amsite.fsx build`, at the root of this repository, publishes it and copies it to
`.output/final/live`, with the rest of the site. It needs only the .NET 10 SDK: no workload, and no
Node. To run it alone:

```sh
dotnet publish -c Release -o ../.output/live
python serve.py ../.output/live/wwwroot 5288     # http://127.0.0.1:5288
```

A page opened from disk cannot load WebAssembly modules. `serve.py` is a static server with the MIME
types WebAssembly and ES modules need.

## How it is put together

- `AmLive.csproj` uses `Microsoft.NET.Sdk.WebAssembly`, without Blazor, and the `AngouriMath` package,
  so the page shows a released version of the library. The kernel is kept whole
  (`TrimmerRootAssembly`), and the framework is trimmed. There is no AOT.
- `Demos/*.cs` are the engines, one per page, each returning JSON. `Demos/Common.cs` holds what they
  share: parsing with a readable error, LaTeX, sampling, intervals, the real points of a solution set.
- `Program.cs` is the list of `[JSExport]` entry points, one class per page.
- `wwwroot/am-worker.js` loads the runtime in a module Web Worker. `wwwroot/am.js` queues calls to it,
  and stops and restarts the worker when a call runs past its timeout, so a long simplification never
  freezes the page.
- `wwwroot/app.js` is the shell. A tab is a module in `wwwroot/views/` with `mount(section, am)`,
  loaded the first time it opens. `wwwroot/shared.js` has the DOM, WebGL and LaTeX helpers.
- The page is plain ES modules and one stylesheet, with no framework and no build step. MathJax, which
  renders the LaTeX, is loaded from cdnjs. It is the only third-party load.

A new page is a `Demos/X.cs`, an `XJs` class in `Program.cs`, a `wwwroot/views/x.js`, and a line each in
`app.js` and `index.html`.

## When the library is released

Raise the `AngouriMath` version in `AmLive.csproj`, as the quickstart names the release.
[AngouriMath#2296](https://github.com/asc-community/AngouriMath/issues/2296) has the payload and the
load time of the kernel under WebAssembly.
