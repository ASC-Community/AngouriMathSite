// Loads the .NET runtime and AngouriMath in this worker and answers calls from am.js.
import { dotnet } from './framework/dotnet.js';

let api = null;
const started = performance.now();

self.onmessage = ({ data }) => {
  const { id, cls, method, args } = data;
  try {
    const value = api[cls][method](...args);
    postMessage({ type: 'result', id, ok: true, value: ArrayBuffer.isView(value) ? Array.from(value) : value });
  } catch (e) {
    postMessage({ type: 'result', id, ok: false, error: String(e?.message || e) });
  }
};

try {
  const runtime = await dotnet
    .withModuleConfig({
      onDownloadResourceProgress(loaded, total) { postMessage({ type: 'progress', loaded, total }); },
    })
    .create();
  const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
  api = exports.AmLive;
  const bytes = performance.getEntriesByType('resource')
    .filter((e) => e.name.includes('/framework/'))
    .reduce((sum, e) => sum + (e.transferSize || 0), 0);
  postMessage({ type: 'ready', seconds: (performance.now() - started) / 1000, bytes });
} catch (e) {
  postMessage({ type: 'failed', error: String(e?.message || e) });
}
