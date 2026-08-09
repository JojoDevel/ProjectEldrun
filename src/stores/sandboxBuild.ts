import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { ptyOutputTail } from "./activity";
import { useTabsStore } from "./tabs";
import type { SandboxPreflight } from "../lib/sandboxImage";

/**
 * The container image currently being built, if any — so the + menu can refuse
 * to offer a tab that cannot start yet, and say why.
 *
 * Without this the build is invisible: `runInstallInTab` opens a terminal in the
 * ROOT scope (it must — a project-scope tab would be wrapped by the very
 * container being built), so a user sitting in their project sees nothing happen
 * and the obvious next move is to open an agent, which fails with the error the
 * build exists to prevent. Twice, usually, because nothing says to wait.
 *
 * It is one build, not a map: the default image serves every project, so two
 * projects needing it are one build, and a project with its own tag is rare
 * enough that queueing behind another build is better than two docker builds
 * competing for the same daemon and disk.
 */

/** How often the image is re-checked. A `docker image inspect` on a live
 *  daemon is milliseconds, but this runs for the length of a multi-minute
 *  build, so it is slow enough to be free and fast enough that the menu
 *  un-greys within a few seconds of the build finishing. */
const POLL_MS = 3000;
/** How often elapsed time / the progress line are re-read. Separate from the
 *  poll: this touches no IPC, it only re-renders what is already in memory. */
const TICK_MS = 1000;

export interface SandboxBuild {
  /** The image tag being built. */
  image: string;
  /** The project whose activation started it (for the preflight re-check). */
  projectId: string;
  /** Composed PTY id of the root-scope terminal running the build. */
  ptyId: string;
  /** Tab key, so the store can tell that the user closed the build terminal. */
  tabKey: string;
  startedAt: number;
}

interface SandboxBuildStore {
  build: SandboxBuild | null;
  /** Bumped on every tick so consumers re-render for elapsed time + progress. */
  tick: number;
  start: (build: SandboxBuild) => void;
  finish: () => void;
}

/**
 * The last line worth showing from a build's output tail.
 *
 * Pure, and the whole reason it is not just `split("\n").pop()`: docker's
 * output ends with the line still being written, which is usually empty or a
 * bare progress fragment, and BuildKit redraws with carriage returns so one
 * "line" can hold several overwritten states. Take the last CR-segment of the
 * last non-blank line, and cap it — this renders inside a menu.
 */
export function buildProgressLine(tail: string, max = 90): string {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const seg = lines[i].split("\r").filter((s) => s.trim().length > 0).pop();
    if (!seg) continue;
    const text = seg.trim();
    if (!text) continue;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  return "";
}

/** `mm:ss` since `startedAt`, the readout a multi-minute build needs. */
export function elapsedLabel(startedAt: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

function stopTimers() {
  if (pollTimer !== null) clearInterval(pollTimer);
  if (tickTimer !== null) clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

/** Is the build's terminal still open? A closed one means the user has taken
 *  the progress off screen — there is nothing left to report, and holding the
 *  menu greyed on a build nobody can see would be worse than releasing it. */
function buildTabStillOpen(tabKey: string): boolean {
  const rootTabs = useTabsStore.getState().tabsByScope["root"];
  // No root scope loaded yet is "cannot tell", not "closed" — the image poll
  // ends the build on its own either way.
  if (!rootTabs) return true;
  return rootTabs.some((t) => t.key === tabKey);
}

export const useSandboxBuildStore = create<SandboxBuildStore>((set, get) => ({
  build: null,
  tick: 0,

  start: (build) => {
    // One at a time: a second start while one runs is dropped rather than
    // replacing it, so the menu keeps naming the build that is actually running.
    if (get().build) return;
    stopTimers();
    set({ build, tick: 0 });

    pollTimer = setInterval(() => {
      const current = get().build;
      if (!current) return stopTimers();
      if (!buildTabStillOpen(current.tabKey)) return get().finish();
      void invoke<SandboxPreflight>("sandbox_preflight", { projectId: current.projectId })
        .then((report) => {
          // Anything but a missing image ends it. `ok` is the success we are
          // waiting for; `no_docker`/`daemon_down` mean the build cannot be
          // running at all, and holding the menu greyed on it would be a lie.
          if (report.status !== "image_missing") get().finish();
        })
        .catch(() => {
          /* transient; the next poll asks again */
        });
    }, POLL_MS);

    tickTimer = setInterval(() => set((s) => ({ tick: s.tick + 1 })), TICK_MS);
  },

  finish: () => {
    stopTimers();
    set({ build: null, tick: 0 });
  },
}));

/** The progress line for the running build, or "" — read through the store's
 *  `tick` by callers so it refreshes. */
export function currentBuildProgress(): string {
  const build = useSandboxBuildStore.getState().build;
  return build ? buildProgressLine(ptyOutputTail(build.ptyId)) : "";
}
