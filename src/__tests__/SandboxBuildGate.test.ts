import { describe, it, expect } from "vitest";
import { buildProgressLine, elapsedLabel } from "../stores/sandboxBuild";
import { gateEntries } from "../components/tabs/useSandboxBuildGate";
import type { AddMenuEntry } from "../components/tabs/AddTabMenuList";

const entry = (over: Partial<AddMenuEntry> = {}): AddMenuEntry => ({
  key: "claude",
  label: "Claude",
  color: "#fff",
  onPick: () => {},
  ...over,
});

describe("the + menu's build gate", () => {
  it("leaves every row alone when no build is running", () => {
    const rows = [entry(), entry({ key: "codex" })];
    // Identity, not just equality: a call site reads the same either way, and a
    // new array every render would churn the menu's memoized cursor list.
    expect(gateEntries(rows, undefined)).toBe(rows);
  });

  it("disables rows with the reason as their tooltip", () => {
    const [row] = gateEntries([entry()], "image is building");
    expect(row.disabled).toBe(true);
    expect(row.disabledReason).toBe("image is building");
  });

  it("keeps a row's own reason for being disabled", () => {
    // "That agent is not installed" stays true after the build finishes and is
    // the more useful sentence; the build must not overwrite it.
    const [row] = gateEntries(
      [entry({ disabled: true, disabledReason: "not installed" })],
      "image is building",
    );
    expect(row.disabledReason).toBe("not installed");
  });
});

describe("the build's progress line", () => {
  it("takes the last non-blank line", () => {
    expect(buildProgressLine("#5 0.4 Reading lists\n#6 1.2 Unpacking\n\n")).toBe("#6 1.2 Unpacking");
  });

  it("takes the last state of a carriage-returned redraw", () => {
    // BuildKit overwrites a line in place; the earlier states are still in the
    // buffer and are not what is on screen.
    expect(buildProgressLine("#8 sha256:ab 12.5MB / 40MB\r#8 sha256:ab 39MB / 40MB")).toBe(
      "#8 sha256:ab 39MB / 40MB",
    );
  });

  it("is empty for empty or blank-only output", () => {
    // The footer renders no line at all rather than an empty row that makes the
    // menu twitch as the build writes.
    expect(buildProgressLine("")).toBe("");
    expect(buildProgressLine("\n  \n\r\n")).toBe("");
  });

  it("clips a long line rather than resizing the menu", () => {
    const line = buildProgressLine(`#9 ${"x".repeat(300)}`, 40);
    expect(line.length).toBe(40);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("the elapsed readout", () => {
  it("counts in mm:ss, zero-padded", () => {
    const t0 = 1_000_000;
    expect(elapsedLabel(t0, t0)).toBe("0:00");
    expect(elapsedLabel(t0, t0 + 9_000)).toBe("0:09");
    expect(elapsedLabel(t0, t0 + 61_000)).toBe("1:01");
    expect(elapsedLabel(t0, t0 + 605_000)).toBe("10:05");
  });

  it("never goes negative on a clock that moved backwards", () => {
    expect(elapsedLabel(1_000_000, 900_000)).toBe("0:00");
  });
});
