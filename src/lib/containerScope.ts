import type { SandboxScope } from "../types";

/**
 * **The** renderer-side answer to "would this tab run inside the project's
 * container?".
 *
 * The authority is the backend's `services::sandbox::resolve_spawn_authority`,
 * which re-derives the same thing from the trusted project record; this is the
 * renderer's copy, and it exists for what only the renderer can do:
 *
 *  - the flag is one of `TerminalView`'s spawn dependencies, so it is what
 *    respawns a live shell when the scope changes — a frontend that ignored
 *    `scope` would leave that shell running inside the container indefinitely;
 *  - it keeps the renderer from claiming a container the backend is about to
 *    take away, which would log an authority downgrade on every plain spawn;
 *  - and it lets a surface that has not spawned anything yet — the + menu —
 *    know whether an entry it is about to offer needs the image to exist.
 *
 * It was inlined in `CenterPanel`'s pane map and restated verbatim in
 * `ContainerScope.test.ts`, whose own header called that "a real duplication".
 * The third caller is what made it worth extracting: a rule copied twice is a
 * note to be careful, a rule copied three times is a rule that will drift.
 *
 * The predicate is the renderer's *narrowing* only. It never grants anything:
 * a `true` here still has to survive the backend's own derivation from
 * `projects.json`, so no bug in this file can put a tab in a container the
 * project record does not ask for.
 */
export interface ContainerScopeInput {
  /** The tab's kind. Only `agent`/`shell` are ever containerized. */
  kind: string;
  /** The tab's scope key — the root scope is never containerized. */
  scopeKey: string;
  /** The project's container toggle. */
  enabled: boolean;
  /** The project's `SandboxSpec.scope`; absent means the strict reading. */
  scope?: SandboxScope;
  /** Remote projects have no local container to wrap. */
  remote?: boolean;
  /** The user asked for THIS tab to run on the host (`lib/hostChosen.ts`). */
  hostChosen?: boolean;
}

export function runsInContainer(opts: ContainerScopeInput): boolean {
  // The user's own per-tab exemption, checked first because it is the one term
  // that is about this tab rather than about the project. It only ever removes
  // containment — the backend re-derives the same answer from a marker file the
  // renderer cannot forge, so a `false` here is a narrowing and never a grant.
  //
  // It belongs in the shared rule rather than at each call site for the reason
  // the rule is shared at all: the flag is a spawn dependency, so this is what
  // respawns the tab when the exemption is toggled, and the + menu's build gate
  // reads the same function — an exempted tab does not need the image, so its
  // row must stay pickable while the image is still building.
  if (opts.hostChosen) return false;
  // Absent scope is `all`, matching the backend's serde default: an older spec
  // written before the key existed must not lose containment on upgrade.
  const containerScope = opts.scope ?? "all";
  return (
    (opts.kind === "agent" || opts.kind === "shell") &&
    (containerScope === "all" || opts.kind === "agent") &&
    opts.scopeKey !== "root" &&
    opts.enabled &&
    !opts.remote
  );
}
