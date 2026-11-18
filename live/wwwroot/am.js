// AngouriMath runs in a worker, so a long simplification never freezes the page, and a call that
// runs away can be stopped: the worker is terminated and started again.

export function createAngouri(onStatus) {
  let worker, ready = false, restarted = false, failure = null;
  // The worker answers in order, so the first call queued is the one it is working on. A call is
  // timed from then, not from when it joined the queue behind another, and the calls behind one
  // that runs away are sent again to the new worker instead of failing with it.
  const queue = [];
  let nextId = 1;

  function start() {
    ready = false;
    worker = new Worker(new URL('./am-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onStatus({ state: 'loading', ...data });
      else if (data.type === 'ready') {
        ready = true;
        queue.forEach(post);
        time();
        // What the demos left in the old worker is gone; restarted tells them to work it out
        // again, with calls that go behind the ones already waiting.
        onStatus({ state: 'ready', restarted, ...data });
        restarted = false;
      } else if (data.type === 'failed') {
        failure = data.error;
        onStatus({ state: 'failed', error: data.error });
        failAll(data.error);
      } else if (data.type === 'result') {
        const call = queue[0];
        if (call?.id !== data.id) return;
        queue.shift();
        clearTimeout(call.timer);
        if (data.ok) call.resolve(data.value);
        else call.reject(new Error(data.error));
        time();
      }
    };
    worker.onerror = (e) => {
      const message = e.message || 'the worker stopped';
      if (!ready) failure = message;
      onStatus({ state: 'failed', error: message });
      failAll(`AngouriMath stopped: ${message}`);
    };
  }

  const post = ({ id, cls, method, args }) => worker.postMessage({ id, cls, method, args });

  function time() {
    const call = queue[0];
    if (!ready || !call || call.timer) return;
    call.timer = setTimeout(() => {
      queue.shift();
      const reason = `AngouriMath worked on this for more than ${call.timeout / 1000} s, so it was stopped and restarted.`;
      call.reject(new Error(reason));
      restarted = true;
      worker.terminate();
      onStatus({ state: 'restarting', reason });
      start();
    }, call.timeout);
  }

  function failAll(reason) {
    for (const call of queue.splice(0)) {
      clearTimeout(call.timer);
      call.reject(new Error(reason));
    }
  }

  /** Calls AmLive.<cls>.<method>(...args) in the worker. */
  function call(cls, method, args = [], { timeout = 20000 } = {}) {
    if (failure) return Promise.reject(new Error(failure));
    return new Promise((resolve, reject) => {
      const call = { id: nextId++, cls, method, args, timeout, resolve, reject, timer: 0 };
      queue.push(call);
      if (ready) {
        post(call);
        time();
      }
    });
  }

  start();
  return {
    call,
    /** For the exports that return JSON. */
    json: async (cls, method, args, options) => JSON.parse(await call(cls, method, args, options)),
  };
}
