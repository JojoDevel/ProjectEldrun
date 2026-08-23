/**
 * The file tree's right-click hand-off to the desktop:
 *
 *  - **Show in Finder / Explorer / file manager** invokes `reveal_in_file_manager`
 *    with the row's ABSOLUTE path, so the OS file manager opens with the file
 *    selected inside its folder. `open_in_file_manager` (the `⧉` header button)
 *    refuses anything that is not a directory and so could never do this.
 *  - The reveal is withheld on a **remote (SFTP) listing**: `entry.path` is then a
 *    path on the SSH host, which the local file manager cannot point at.
 *  - **Copy path** is offered on both, because it copies text — and a host path is
 *    exactly what you paste into a terminal running on that host.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("../stores/projects", () => ({ useProjectsStore: vi.fn() }));
vi.mock("../stores/settings", () => ({ useSettingsStore: () => null }));
// The remote-source tree refuses to list at all until the SSH lamp is green
// (`remoteBlocked`), so a remote listing needs a connected project to exist.
vi.mock("../stores/remoteStatus", () => ({
  useRemoteStatusStore: (selector?: (s: unknown) => unknown) => {
    const state = { byProject: { "proj-1": { ssh: "connected" } } };
    return selector ? selector(state) : state;
  },
}));

import { useProjectsStore } from "../stores/projects";
import { FileTree } from "../components/files/FileTree";

const mockUseProjectsStore = vi.mocked(useProjectsStore);

const PROJECT_DIR = "/tmp/test-project";
const FILE_PATH = `${PROJECT_DIR}/notes.md`;

function fileEntry(name: string, is_dir = false) {
  return {
    name,
    path: `${PROJECT_DIR}/${name}`,
    is_dir,
    size: 1,
    extension: name.includes(".") ? name.slice(name.lastIndexOf(".")) : null,
    mime: null,
  };
}

/** `remote` decides `isRemote`, the first half of the tree's `remoteListing`. */
function mockProjects(remote: boolean) {
  const state = {
    projects: [
      {
        id: "proj-1",
        name: "TestProject",
        status: "active",
        position: 0,
        local_file: `${PROJECT_DIR}/project.json`,
        ...(remote ? { remote: { host: "host.example", user: "u", remote_path: "/home/u/p" } } : {}),
      },
    ],
    activeId: "proj-1",
  } as unknown as ReturnType<typeof useProjectsStore>;
  // Apply the selector like real zustand — FileTree subscribes with selectors,
  // and handing back the whole state object would make every boolean one truthy.
  mockUseProjectsStore.mockImplementation(((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state) as typeof useProjectsStore);
}

async function renderTree(syncSource?: "remote" | "local") {
  await act(async () => {
    render(
      <FileTree
        projectDir={PROJECT_DIR}
        projectId="proj-1"
        syncSource={syncSource}
        active={true}
      />,
    );
  });
}

/** Right-click the row and return the open context menu. */
async function openMenuOn(name: string) {
  const row = (await screen.findByText(name)).closest(".file-entry");
  expect(row).toBeTruthy();
  await act(async () => {
    fireEvent.contextMenu(row!);
  });
  const menu = document.querySelector(".file-browser-context-menu");
  expect(menu).toBeTruthy();
  return menu as HTMLElement;
}

function menuButton(menu: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(menu.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

describe("file tree — reveal in the OS file manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_dir") return Promise.resolve([fileEntry("notes.md")]);
      if (cmd === "git_status")
        return Promise.resolve({ staged: 0, unstaged: 0, untracked: 0, has_remote: false, is_repo: false });
      if (cmd === "git_file_statuses") return Promise.resolve({});
      if (cmd === "list_project_endings") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    mockProjects(false);
  });

  it("reveals the row's absolute path — not its parent folder", async () => {
    await renderTree();
    const menu = await openMenuOn("notes.md");

    // The label is OS-specific; under jsdom `navigator.platform` is neither Mac
    // nor Windows, so the Linux wording is the one rendered here.
    const reveal = menuButton(menu, "Show in file manager");
    expect(reveal).toBeTruthy();

    await act(async () => {
      fireEvent.click(reveal!);
    });
    expect(mockInvoke).toHaveBeenCalledWith("reveal_in_file_manager", { path: FILE_PATH });
  });

  it("offers Copy path on a local row", async () => {
    await renderTree();
    const menu = await openMenuOn("notes.md");
    expect(menuButton(menu, "Copy Path")).toBeTruthy();
  });

  it("withholds the reveal on a remote listing but keeps Copy path", async () => {
    mockProjects(true);
    await renderTree("remote");
    const menu = await openMenuOn("notes.md");

    expect(menuButton(menu, "Show in file manager")).toBeUndefined();
    expect(menuButton(menu, "Copy Path")).toBeTruthy();
  });

  it("keeps the reveal on a remote project's local-mirror view", async () => {
    mockProjects(true);
    await renderTree("local");
    const menu = await openMenuOn("notes.md");

    // `treatLocal` — the mirror is a real path on this machine.
    expect(menuButton(menu, "Show in file manager")).toBeTruthy();
  });
});
