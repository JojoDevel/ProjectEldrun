import { useProjectsStore } from "../../stores/projects";
import { useSandboxBuildStore, buildProgressLine, elapsedLabel } from "../../stores/sandboxBuild";
import { ptyOutputTail } from "../../stores/activity";
import { runsInContainer } from "../../lib/containerScope";
import { useT } from "../../lib/i18n";
import type { AddMenuEntry } from "./AddTabMenuList";

/**
 * While the project's container image is being built, the tabs that would need
 * it cannot start — so the + menu greys them and says why, instead of offering a
 * row whose only outcome is the error the build exists to prevent.
 *
 * Shared by both hosts of `AddTabMenuList` (the main window's `TabBar` and a
 * popout's `NewTabMenu`) because a popout's + menu opens tabs into the same
 * project and would otherwise stay happily pickable.
 *
 * **Which rows** is `runsInContainer`, the same rule the pane map spawns with —
 * so under `scope: "agents"` a shell stays offered (it runs on the host and does
 * not need the image) while agents grey out, and under `all` both grey. Getting
 * that from the shared rule rather than a local guess is the point: a menu that
 * greys the wrong half is worse than one that greys nothing.
 *
 * **Which projects**: any container-enabled one, not only the project whose
 * activation started the build. One image serves every project by default, so
 * the common case is that the build in flight is exactly the image this project
 * needs. The cost is over-blocking a project pinned to a *different* custom
 * image for the length of someone else's build — rare, temporary, and the
 * footer names the image being built, so what is happening stays legible.
 */
/**
 * Apply a block reason to a group's rows. `undefined` returns the entries
 * untouched, so a call site reads the same whether or not a build is running.
 * An entry already disabled for its own reason keeps that reason — "the agent
 * is not installed" is a more useful sentence than "an image is building", and
 * it stays true after the build finishes.
 */
export function gateEntries(
  entries: AddMenuEntry[],
  reason: string | undefined,
): AddMenuEntry[] {
  if (!reason) return entries;
  return entries.map((e) => (e.disabled ? e : { ...e, disabled: true, disabledReason: reason }));
}

export function useSandboxBuildGate(scopeKey: string) {
  const t = useT();
  const build = useSandboxBuildStore((s) => s.build);
  // Subscribed so elapsed time and the progress line refresh; the value itself
  // is unused. The store ticks only while a build is running.
  useSandboxBuildStore((s) => s.tick);
  const project = useProjectsStore((s) =>
    scopeKey === "root" ? undefined : s.projects.find((p) => p.id === scopeKey),
  );

  const enabled = !!project?.sandbox?.enabled;

  /** The tooltip for a row this build blocks, or undefined if it does not. */
  const blockedReason = (kind: string): string | undefined => {
    if (!build || !enabled) return undefined;
    const contained = runsInContainer({
      kind,
      scopeKey,
      enabled,
      scope: project?.sandbox?.scope,
      remote: !!project?.remote,
    });
    return contained ? t("newTabMenu.containerBuildingBlocked", { image: build.image }) : undefined;
  };

  const footer = build ? (
    <div className="tab-new-menu-hint">
      {t("newTabMenu.containerBuilding", {
        image: build.image,
        elapsed: elapsedLabel(build.startedAt, Date.now()),
      })}
      {(() => {
        const line = buildProgressLine(ptyOutputTail(build.ptyId));
        return line ? <div className="tab-new-menu-build-line">{line}</div> : null;
      })()}
    </div>
  ) : null;

  return { blockedReason, footer, building: !!build };
}
