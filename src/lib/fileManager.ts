/**
 * **The** typed invoke surface for handing a path back to the desktop's own file
 * manager — the convention `lib/mail.ts`, `lib/browser.ts` and `lib/printing.ts`
 * established: no component calls `invoke("…_in_file_manager")` itself.
 *
 * Two commands, and the distinction between them is the reason this module
 * exists at all:
 *
 *  - {@link openInFileManager} opens a **directory as the browsed folder**. It
 *    is the file viewer's `⧉` header button and the project pill's "Show on
 *    disk", and the backend refuses anything that is not a directory — so it can
 *    never point at a file.
 *  - {@link revealInFileManager} takes a file *or* a folder and opens the file
 *    manager with it **selected inside its parent**. That is the one the tree's
 *    right-click needs, and until it existed the menu could do a great deal to a
 *    file inside Eldrun and nothing at all with it outside.
 *
 * {@link revealMenuLabelKey} lives here rather than in each menu because two
 * surfaces offer the reveal (the file tree and the `FileBrowser` tab) and a
 * label chosen twice is a label that can disagree with itself.
 */

import { invoke } from "@tauri-apps/api/core";
import { PLATFORM } from "./platform";
import type { TranslationKey } from "./i18n";

/** Open a **directory** in the OS file manager, as the browsed folder. */
export function openInFileManager(path: string): Promise<void> {
  return invoke<void>("open_in_file_manager", { path });
}

/**
 * Reveal a file or folder in the OS file manager, selected inside its parent —
 * `open -R` on macOS, `explorer /select,` on Windows, the FileManager1/portal
 * D-Bus call on Linux.
 *
 * Callers must pass a **local** filesystem path. A remote (SFTP) listing's
 * `entry.path` is a path on the SSH host, which the local file manager cannot
 * point at — the surfaces that can show either are expected to gate the action,
 * not to hand this a host path and let the backend fail.
 */
export function revealInFileManager(path: string): Promise<void> {
  return invoke<void>("reveal_in_file_manager", { path });
}

/**
 * The i18n key for the reveal item, named for the file manager the user actually
 * has. "Reveal in file manager" is jargon on a Mac, where the thing has a name
 * everyone uses; `PLATFORM` is the single source of OS truth this derives from.
 */
export function revealMenuLabelKey(): TranslationKey {
  if (PLATFORM === "macos") return "fileBrowser.showInFinder";
  if (PLATFORM === "windows") return "fileBrowser.showInExplorer";
  return "fileBrowser.showInFileManager";
}
