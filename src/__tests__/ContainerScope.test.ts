/**
 * The container's **scope** (#38): which of a project's tabs actually run inside
 * it — everything, or agent tabs only.
 *
 * The rule lives in the backend (`services::sandbox::resolve_spawn_authority`,
 * which re-derives it from the trusted project record and is the authority). What
 * is tested here is the renderer's *copy* of it, `lib/containerScope.ts`, which
 * exists for three things the backend cannot do: the flag is one of
 * `TerminalView`'s spawn dependencies, so it is what respawns a live shell when
 * the scope changes — a frontend that ignored `scope` would leave that shell
 * running inside the container indefinitely; it keeps the renderer from claiming
 * a container the backend is about to take away, which would otherwise log an
 * authority downgrade on every ordinary shell spawn; and it lets the + menu know
 * whether an entry it is about to offer needs the image to exist.
 *
 * This file used to restate the derivation, because it was inlined in
 * `CenterPanel`'s pane map, and pinned that component's source text to catch the
 * two drifting apart. The rule now has one home and is imported, so the
 * assertions run against the real function; the last test guards what the pin was
 * really for — that a second copy has not reappeared.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error node:fs has no type declarations in this project (no @types/node)
import { readFileSync } from "node:fs";
import { runsInContainer as sandboxFor } from "../lib/containerScope";

const project = { scopeKey: "p1", enabled: true } as const;

describe("container scope", () => {
  it("contains every PTY tab when the scope is 'all'", () => {
    expect(sandboxFor({ ...project, kind: "agent", scope: "all" })).toBe(true);
    expect(sandboxFor({ ...project, kind: "shell", scope: "all" })).toBe(true);
  });

  it("treats a spec with no scope key as 'all'", () => {
    // The migration-free promise: a project that enabled the container before the
    // setting existed must not silently drop its shells onto the host.
    expect(sandboxFor({ ...project, kind: "shell" })).toBe(true);
    expect(sandboxFor({ ...project, kind: "agent" })).toBe(true);
  });

  it("leaves shells on the host under 'agents', and only shells", () => {
    // This is the whole feature: the viewer's Run/Debug opens a SHELL tab, so
    // this is what puts a host .venv back within reach.
    expect(sandboxFor({ ...project, kind: "shell", scope: "agents" })).toBe(false);
    expect(sandboxFor({ ...project, kind: "agent", scope: "agents" })).toBe(true);
  });

  it("never contains anything when the toggle is off", () => {
    // The scope narrows; it can never grant. Mirrors the backend test of the
    // same name — a project with the container OFF but a stored `scope` must not
    // acquire one.
    for (const scope of ["all", "agents"] as const) {
      expect(sandboxFor({ ...project, kind: "agent", enabled: false, scope })).toBe(false);
      expect(sandboxFor({ ...project, kind: "shell", enabled: false, scope })).toBe(false);
    }
  });

  it("never contains a remote project's tabs, or the root scope's", () => {
    expect(sandboxFor({ ...project, kind: "agent", scope: "all", remote: true })).toBe(false);
    expect(sandboxFor({ kind: "agent", scopeKey: "root", enabled: true, scope: "all" })).toBe(
      false,
    );
  });

  it("leaves a host-bound local_agent tab alone under either scope", () => {
    // Ollama driver tabs depend on the host's server and wiring; they were never
    // containerized and the scope must not change that in either direction.
    for (const scope of ["all", "agents"] as const) {
      expect(sandboxFor({ ...project, kind: "local_agent", scope })).toBe(false);
    }
  });

  it("changing the scope flips the flag, which is what respawns the tab", () => {
    // The flag is a spawn dep in TerminalView. If it did NOT change here, a shell
    // running inside the container when the user picks agents-only would stay
    // there — the failure this frontend copy exists to prevent.
    const before = sandboxFor({ ...project, kind: "shell", scope: "all" });
    const after = sandboxFor({ ...project, kind: "shell", scope: "agents" });
    expect(before).not.toBe(after);
    // …and an agent tab's flag does not change, so its conversation is not
    // restarted by a setting that does not concern it.
    expect(sandboxFor({ ...project, kind: "agent", scope: "all" })).toBe(
      sandboxFor({ ...project, kind: "agent", scope: "agents" }),
    );
  });

  it("lets the user's own per-tab exemption out of the container", () => {
    // The exemption is about THIS tab, so it beats every project-level term —
    // including `scope: "all"`, which is the case it exists for (agents
    // contained, except the one running a UI test against the real display).
    for (const scope of ["all", "agents"] as const) {
      expect(sandboxFor({ ...project, kind: "agent", scope, hostChosen: true })).toBe(false);
      expect(sandboxFor({ ...project, kind: "shell", scope, hostChosen: true })).toBe(false);
    }
    // Absent/false is the ordinary path, unchanged.
    expect(sandboxFor({ ...project, kind: "agent", scope: "all", hostChosen: false })).toBe(true);
    expect(sandboxFor({ ...project, kind: "agent", scope: "all" })).toBe(true);
  });

  it("the exemption removes containment and can never add it", () => {
    // Mirrors the backend test of the same shape. A tab the project would not
    // contain anyway is not made containable by the flag being absent, and an
    // exempted tab in a project with the toggle off is still just uncontained.
    expect(sandboxFor({ ...project, kind: "agent", enabled: false, hostChosen: true })).toBe(false);
    expect(sandboxFor({ ...project, kind: "agent", remote: true, hostChosen: true })).toBe(false);
    expect(sandboxFor({ kind: "agent", scopeKey: "root", enabled: true, hostChosen: true })).toBe(
      false,
    );
  });

  it("flipping the exemption flips the flag, which is what respawns the tab", () => {
    // Same reason the scope test above exists: the flag is a spawn dep, so if
    // this did not change, toggling "run on my machine" would leave the process
    // exactly where it was and the control would silently do nothing.
    const before = sandboxFor({ ...project, kind: "agent", scope: "all" });
    const after = sandboxFor({ ...project, kind: "agent", scope: "all", hostChosen: true });
    expect(before).not.toBe(after);
  });

  it("is the rule every renderer surface actually uses", () => {
    // This replaces a source-text tripwire that pinned CenterPanel's inlined
    // expression. There is no expression to pin any more: the rule moved to
    // `lib/containerScope.ts` and the component calls it, so the assertions
    // above now run against the real thing rather than a copy of it. What is
    // checked instead is that nobody has quietly grown a second copy — the
    // reason the tripwire existed at all.
    // The two direct callers: the pane map that spawns with the flag, and the
    // + menu's gate (which both menu hosts reach through, so they are covered
    // by it rather than calling it themselves).
    for (const file of [
      "src/components/layout/CenterPanel.tsx",
      "src/components/tabs/useSandboxBuildGate.tsx",
    ]) {
      const src = readFileSync(file, "utf8") as string;
      expect(src, `${file} should call the shared rule`).toContain("runsInContainer(");
      expect(src, `${file} should not re-derive the scope`).not.toContain(
        'sandbox?.scope ?? "all"',
      );
    }
  });
});
