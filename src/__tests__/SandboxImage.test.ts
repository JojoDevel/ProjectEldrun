import { describe, it, expect } from "vitest";
import { shouldStartBuild, type SandboxPreflight } from "../lib/sandboxImage";

const report = (over: Partial<SandboxPreflight> = {}): SandboxPreflight => ({
  status: "image_missing",
  image: "eldrun-agent-sandbox:latest",
  build_command: "docker build -t eldrun-agent-sandbox:latest /repo/docker/agent-sandbox",
  ...over,
});

describe("the auto-build decision (missing container image)", () => {
  it("builds a missing image that came with a command", () => {
    expect(shouldStartBuild(report(), new Set())).toBe(true);
  });

  it("does nothing for any status but image_missing", () => {
    // `ok` is the common case — the image is already there, on every activation
    // of every container project — so a false here is what keeps this silent.
    for (const status of ["ok", "no_docker", "daemon_down"]) {
      expect(shouldStartBuild(report({ status }), new Set())).toBe(false);
    }
  });

  it("does not build when the backend named no command", () => {
    // `build_command` is None for a registry image the backend cannot provide;
    // acting on it would run `undefined` in a terminal.
    expect(shouldStartBuild(report({ build_command: null }), new Set())).toBe(false);
  });

  it("dedupes on the IMAGE, not the project", () => {
    // One image serves every project by default: switching between three
    // container projects must not open three builds of the same tag.
    const attempted = new Set<string>();
    const r = report();
    expect(shouldStartBuild(r, attempted)).toBe(true);
    attempted.add(r.image);
    expect(shouldStartBuild(r, attempted)).toBe(false);
    // A project carrying a *different* image is still built.
    expect(shouldStartBuild(report({ image: "my-own:v2" }), attempted)).toBe(true);
  });

  it("does not retry an image already attempted this session", () => {
    // A failed build re-offering itself on every project switch would bury the
    // terminal that holds the error under copies of itself. The toggle remains
    // the way to ask for a second attempt.
    expect(shouldStartBuild(report(), new Set(["eldrun-agent-sandbox:latest"]))).toBe(false);
  });
});
