import { configure } from "@testing-library/react";

// The heavy in-app viewer tests (FileViewerPane pulls in pdfjs/katex/mermaid/
// xlsx) render and resolve async load chains that, under the full suite's
// parallel CPU load, routinely exceed Testing Library's 1s default
// `waitFor`/`findBy*` budget — producing timeout flakes that pass in isolation.
// A wrong assertion still fails (just later), so this only buys patience, not
// false greens. The Tauri-side real-timer poll tests bump their own explicit
// `waitFor` budgets on top of this.
configure({ asyncUtilTimeout: 10000 });

// jsdom has no Tauri runtime, so `window.__TAURI_INTERNALS__` is undefined.
// Components that subscribe via `listen()` (e.g. FileTree's fs-change watcher)
// call it on mount; the real `@tauri-apps/api/event` `listen` synchronously hits
// `transformCallback` → `window.__TAURI_INTERNALS__.transformCallback` and the
// resulting rejection is uncaught, which vitest reports as an "Unhandled
// Rejection" error (failing the run's exit code) even though every test passes.
// Tests that mock `@tauri-apps/api/*` are unaffected (the mock replaces the
// module); this stub only makes the *real*, unmocked calls inert. Each test that
// mocks core still controls its own `invoke` resolutions.
if (!(globalThis as unknown as { window?: { __TAURI_INTERNALS__?: unknown } })
  .window?.__TAURI_INTERNALS__) {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: () => Promise.resolve(null),
    convertFileSrc: (p: string) => p,
    unregisterCallback: () => {},
  };
  // The event plugin's unlisten path goes through a separate global.
  (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown })
    .__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => Promise.resolve(),
  };
}

// Global test setup (referenced by vitest.config.ts `setupFiles`).
//
// jsdom has no layout engine and so provides no ResizeObserver. Several
// components (e.g. TabBar's overflow/scroll-state tracking) construct one at
// mount, which would otherwise throw `ResizeObserver is not defined` during any
// render that mounts them. A NO-OP stub is the right default: tests that care
// about resize behavior drive it explicitly via dispatched events.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverStub;
}

// Node ≥ 24 ships its OWN global `localStorage`, and it shadows jsdom's.
//
// This is not a missing API, which is the usual shape of everything else in this
// file — it is a *worse* one winning. Node's Web Storage is enabled by default
// from Node 24 and is backed by a file given by `--localstorage-file`; with no
// valid path (nobody passes one here) the global degrades to a plain object with
// `getItem`/`setItem` and **no `clear`**, so every `localStorage.clear()` in a
// test throws `TypeError: localStorage.clear is not a function`, and values
// written by one test leak into the next.
//
// It broke three CI jobs at once — `test`, `test-macos`, `test-windows` — which
// is the signature of an environment change rather than a code one: CI pins
// `node-version: lts/*`, `lts/*` rolled over to Node 24, and every platform
// picked it up on the same push. Pinning the version would paper over it until
// the next rollover; installing a real Storage fixes it for every Node, and for
// anyone running the suite on Node Current locally.
//
// A minimal spec-faithful implementation rather than jsdom's own: by the time
// this runs, jsdom's has already lost the global, and reaching back into jsdom
// internals to retrieve it is a sharper dependency than the ~20 lines below.
const storageIsUsable = (s: unknown): boolean =>
  !!s && typeof (s as Storage).clear === "function";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  getItem(key: string): string | null {
    const v = this.map.get(String(key));
    return v === undefined ? null : v;
  }
  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.map.delete(String(key));
  }
  clear(): void {
    this.map.clear();
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  if (storageIsUsable((globalThis as unknown as Record<string, unknown>)[name])) continue;
  const store = new MemoryStorage();
  // `defineProperty`, not assignment: Node's global is a non-writable own
  // property, so `globalThis.localStorage = …` silently does nothing (and
  // throws in strict mode). Both `globalThis` and `window` are set because a
  // component may reach it either way, and in this environment they are not
  // guaranteed to be the same object once Node has claimed the name.
  for (const target of [globalThis, typeof window !== "undefined" ? window : undefined]) {
    if (!target) continue;
    Object.defineProperty(target, name, {
      value: store,
      configurable: true,
      writable: true,
    });
  }
}

// jsdom does not implement the CSS interface, so `CSS.escape` (used when
// building attribute selectors in drag/drop hit-testing) is undefined. Provide a
// minimal, spec-faithful escape so those selectors resolve in tests.
const cssObj = (globalThis as unknown as { CSS?: { escape?: unknown } }).CSS;
if (!cssObj || typeof cssObj.escape !== "function") {
  const escape = (value: string) =>
    String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  if (cssObj) cssObj.escape = escape;
  else (globalThis as unknown as { CSS: unknown }).CSS = { escape };
}
