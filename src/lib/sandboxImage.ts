import { invoke } from "@tauri-apps/api/core";
import { useProjectsStore } from "../stores/projects";
import { useSandboxBuildStore } from "../stores/sandboxBuild";
import { runInstallInTab } from "./installCommand";

/**
 * Build a container-enabled project's image when it is missing, without waiting
 * for the user to find the toggle.
 *
 * The one-click build already existed and was only ever offered at *toggle*
 * time (`ProjectPill.toggleContainer`) and at create/import
 * (`ProjectDialog`). That covers the project you just switched on and nothing
 * else — so a project that arrives already-enabled never gets the offer:
 *
 *   - an **import**, where the container row defaults ON (unreviewed code),
 *   - a project restored from a previous session on a machine where the image
 *     was never built,
 *   - a `projects.json` carried to a second machine,
 *   - an image deleted by a `docker system prune`.
 *
 * In every one of those the first thing to notice is the tab spawn, which can
 * only report an error — the user is told to toggle a switch off and on to get
 * back a button that should have been offered to them. This closes that by
 * running the same preflight on **activation**, which is the one event that
 * always precedes opening a tab in a project.
 *
 * It deliberately does NOT build silently in the background. A build pulls a
 * base image and installs the agent CLIs — minutes, and it can fail on a
 * network or disk problem — so it goes through `runInstallInTab` like every
 * other install in the app: a visible root-scope terminal running the real
 * command, where progress is legible and a failure is readable. (Root scope is
 * also what keeps this from deadlocking: a project-scope tab would itself be
 * wrapped by the container whose image is being built.)
 */

/** `sandbox_preflight`'s wire shape (`services::sandbox::PreflightReport`). */
export interface SandboxPreflight {
  status: string;
  image: string;
  build_command: string | null;
}

/**
 * Whether this report should start a build, given the images already attempted.
 *
 * Pure so the policy is testable without a store or a backend. Two rules carry
 * it. The dedupe key is the **image**, not the project — one image serves every
 * project by default, so switching between three container projects must not
 * open three builds of `eldrun-agent-sandbox:latest`. And an image is attempted
 * **once per session**: a failed build that re-offered itself on every project
 * switch would bury the terminal it failed in under copies of itself, so a
 * second attempt is the user's to ask for (the toggle still offers it).
 */
export function shouldStartBuild(
  report: SandboxPreflight,
  attempted: ReadonlySet<string>,
): boolean {
  if (report.status !== "image_missing") return false;
  if (!report.build_command) return false;
  return !attempted.has(report.image);
}

let inited = false;
let inFlight = false;
const attempted = new Set<string>();
/** Last `${activeId}:${enabled}` seen, so a re-render never re-checks. */
let lastKey = "";

/** Test seam: forget this module's session state. */
export function resetSandboxImageWatch(): void {
  inited = false;
  inFlight = false;
  attempted.clear();
  lastKey = "";
}

async function checkActiveProject(): Promise<void> {
  const { activeId, projects } = useProjectsStore.getState();
  const project = activeId ? projects.find((p) => p.id === activeId) : undefined;
  const enabled = !!project?.sandbox?.enabled;

  // Recomputed from the store rather than passed in, so the launch-time case
  // (projects load *after* this is installed, with a project already active)
  // is the same code path as an ordinary switch.
  const key = `${activeId ?? ""}:${enabled}`;
  if (key === lastKey) return;
  lastKey = key;

  if (!activeId || !enabled || inFlight) return;
  inFlight = true;
  try {
    const report = await invoke<SandboxPreflight>("sandbox_preflight", {
      projectId: activeId,
    });
    if (shouldStartBuild(report, attempted)) {
      attempted.add(report.image);
      const tab = runInstallInTab(
        `container image ${report.image}`,
        report.build_command!,
        "bash",
      );
      // Record it so the + menu can refuse to offer a tab that cannot start
      // yet. Without this the build is invisible from inside the project — it
      // runs in the ROOT scope — and the obvious next move is to open an agent,
      // which fails with the very error the build exists to prevent.
      useSandboxBuildStore.getState().start({
        image: report.image,
        projectId: activeId,
        // The composed id the backend emits under, and the key `activity.ts`
        // stores output against (`splitPtyId`'s format).
        ptyId: `root:${tab.key}`,
        tabKey: tab.key,
        startedAt: Date.now(),
      });
    }
  } catch {
    // Advisory, exactly as the toggle's own preflight is: a backend that does
    // not know the command, or a docker that cannot be reached, still surfaces
    // at the next tab spawn with a message written for that moment.
  } finally {
    inFlight = false;
  }
}

/**
 * Install the watcher. Idempotent, main-window only (mounted from `AppShell`,
 * the shape `initMachineSync` uses) — a popout shares neither the header nor
 * the root scope this would open a build tab into.
 */
export function initSandboxImageWatch(): void {
  if (inited) return;
  inited = true;
  void checkActiveProject();
  useProjectsStore.subscribe(() => {
    void checkActiveProject();
  });
}
