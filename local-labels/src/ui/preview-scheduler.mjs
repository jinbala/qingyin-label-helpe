// One render at a time. New requests replace queued work and cancel obsolete
// image loading; callers settle only after the newest preview has completed.
export function createPreviewScheduler(render) {
  let running = false, queued = false, revision = 0, disposed = false, active;
  const waiting = [];
  const settle = value => { for (const resolve of waiting.splice(0)) resolve(value); };
  const drain = async () => {
    running = true;
    try {
      while (queued && !disposed) {
        queued = false;
        const ticket = revision, controller = new AbortController(); active = controller;
        try { await render({ signal: controller.signal, isCurrent: () => !disposed && ticket === revision }); }
        catch (error) { if (!controller.signal.aborted) console.error('[轻印预览]', error); }
        if (ticket === revision && !queued) settle(true);
      }
    } finally { running = false; active = undefined; if (disposed) settle(false); }
  };
  return {
    request() {
      if (disposed) return Promise.resolve(false);
      revision++; queued = true; active?.abort();
      const promise = new Promise(resolve => waiting.push(resolve));
      if (!running) void drain();
      return promise;
    },
    dispose() { disposed = true; revision++; queued = false; active?.abort(); settle(false); },
  };
}
