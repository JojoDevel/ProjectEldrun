import { invoke } from "@tauri-apps/api/core";

/**
 * The user's **own** per-tab exemption from a project's container.
 *
 * `lib/hostBound.ts` is the other one, and the two are deliberately separate
 * files for the same reason the backend keeps them in separate directories:
 * they answer different questions.
 *
 *   - **host-bound** is a mechanical necessity. A local-model driver tab cannot
 *     work inside the image at all — it needs the host's Ollama server and each
 *     agent's host-side wiring — so Eldrun grants it silently, narrowed by a
 *     fixed list of driver commands precisely because nobody asked for it.
 *   - **host-chosen** is a decision. The user is looking at a container they
 *     switched on themselves and says "not this tab": a UI test that needs the
 *     real display, a tool that must reach a service on the host, a debugger.
 *     There is no command list, because the whole point is that the *user*
 *     names the exception rather than Eldrun guessing which ones are safe.
 *
 * The grant is the same shape either way, and that shape is the important part:
 * a uid minted here, and a **file the backend writes** under
 * `<state_dir>/sessions/<project>/host_chosen/`, which no container mounts. It
 * is not a flag on the tab, and it must never become one — that spelling is
 * exactly what `hostBound.ts` documents going wrong, when an authority decision
 * rode on `ELDRUN_LOCAL_MODEL`, a label set for the usage recap.
 *
 * What this is honest about: it is a hole in a containment, opened on request.
 * It is per tab and never per project, it cannot widen the project's own
 * container settings (those live in a record the renderer cannot write), and
 * the tab wears a marker afterwards — an escaped tab that looks contained is
 * the failure mode this feature would otherwise introduce.
 */

/** A uid the backend will accept as a marker filename: `[A-Za-z0-9_-]`, ≤64. */
function mintUid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `hc-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Turn the exemption on for a tab, returning the uid to persist on it, or
 * `undefined` when there is nothing to register against (the root scope) or the
 * backend refused.
 *
 * `undefined` is the safe direction and needs no loud handling: a tab with no
 * uid simply runs inside the container like every other tab of the project,
 * which is a visible, diagnosable state — unlike a silent escape.
 */
export async function enableHostChosen(scope: string): Promise<string | undefined> {
  if (!scope || scope === "root") return undefined;
  const uid = mintUid();
  try {
    await invoke("set_host_chosen_tab", { projectId: scope, uid, on: true });
    return uid;
  } catch {
    return undefined;
  }
}

/**
 * Turn it off again. Resolves either way: the marker file is the authority, so
 * a failure to remove it is a tab that stays on the host — which is why the
 * caller must only clear `hostChosenUid` on the tab once this has resolved, and
 * not optimistically alongside it.
 */
export async function disableHostChosen(scope: string, uid: string): Promise<boolean> {
  if (!scope || scope === "root" || !uid) return false;
  try {
    await invoke("set_host_chosen_tab", { projectId: scope, uid, on: false });
    return true;
  } catch {
    return false;
  }
}
