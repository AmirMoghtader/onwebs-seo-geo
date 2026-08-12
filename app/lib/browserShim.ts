// Outside Tauri (next dev in a normal browser, or the static export served on
// the web) there is no window.__TAURI_INTERNALS__, so every invoke()/listen()
// call used to throw on mount and flood the dev overlay with errors. The
// @tauri-apps/api functions look the internals object up at call time, so
// providing a quiet stand-in here makes every call site a silent no-op —
// without touching the ~100 call sites or affecting the real app, where the
// genuine internals already exist and this block never runs.
//
// invoke() returns a promise that never settles: resolving would feed
// `undefined` into setState paths that expect real data, and rejecting would
// just re-create the console noise in every catch handler. Pages simply keep
// their empty/initial state in the browser, which is the honest rendering of
// "there is no crawler here".
if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
  const pending = () => new Promise(() => {});
  (window as any).__TAURI_INTERNALS__ = {
    // marks this object as the stand-in, so pages can tell browser from app
    __shim: true,
    invoke: (cmd: string) => {
      console.warn("[browser] tauri invoke skipped:", cmd);
      return pending();
    },
    // listen()/emit() route through transformCallback + invoke above.
    transformCallback: () => 0,
    unregisterCallback: () => {},
    convertFileSrc: (p: string) => p,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    plugins: {},
  };
}

export {};
