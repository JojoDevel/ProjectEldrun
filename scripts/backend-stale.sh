#!/usr/bin/env bash
# Is the RUNNING Eldrun older than the backend source on disk?
#
# `npm run tauri:dev` passes `--no-watch`, so a `src-tauri/` edit no longer
# rebuilds and relaunches the window out from under whoever is using it (open
# tabs, live terminals, and a frontend reloaded from whatever uncommitted WIP
# happens to be on disk — a surprise restart is indistinguishable from the app
# breaking). The cost of that is the opposite failure: a backend fix that is
# saved, compiles, and simply is not in the window, with nothing saying so.
#
# This is the thing that says so. It compares the running process's start time
# against the newest mtime under `src-tauri/`, and is deliberately a plain script
# rather than anything in-app — reporting "the backend is stale" from the backend
# would need the very rebuild it is reporting on.
#
# Exit 0 = the running app matches the source (or nothing is running).
# Exit 1 = a restart is needed to pick up backend changes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# `/proc`, `stat -c`, `find -printf` and `date -d` are all GNU-only, and this
# script reached for all four. On macOS that did not make it fail — it made it
# answer "not stale" every single time, from the `/proc` miss below, which is
# the one answer a staleness check must never give wrongly. See scripts/portable.sh.
# shellcheck source=scripts/portable.sh
. "$ROOT/scripts/portable.sh"

app_pid="$(pgrep -f "^$ROOT/target/debug/eldrun" | head -n 1 || true)"
if [ -z "$app_pid" ]; then
  echo "No Eldrun dev binary is running — nothing to be stale against."
  exit 0
fi

started="$(portable_proc_start_epoch "$app_pid" || true)"
if [ -z "$started" ]; then
  echo "Could not read the start time of pid $app_pid; skipping the check." >&2
  exit 0
fi

# Newest source mtime. `-newermt` would need a formatted date; a max over the
# mtimes is simpler and needs no date arithmetic. Build outputs are excluded —
# `target/` is written BY the build, so including it would make every run look
# fresh immediately after a compile.
#
# `find` reports the paths and `stat` reports their times, rather than
# `-printf '%T@ %p\n'` doing both: `-printf` is a GNU extension that BSD `find`
# does not have at all. The list is stat'd in one batch (see `portable_mtimes`)
# so this stays a single fork rather than one per source file.
newest=0
newest_file=""
while IFS="$(printf '\t')" read -r ts path; do
  ts="${ts%.*}"
  [ -n "$ts" ] || continue
  if [ "$ts" -gt "$newest" ]; then
    newest="$ts"
    newest_file="$path"
  fi
done < <(
  find "$ROOT/src-tauri" \
    -path "$ROOT/src-tauri/target" -prune -o \
    -type f \( -name '*.rs' -o -name 'Cargo.toml' -o -name 'Cargo.lock' -o -name '*.conf.json' \) \
    -print0 |
    xargs -0 "$ROOT/scripts/portable.sh" mtimes
)

if [ "$newest" -le "$started" ]; then
  echo "Backend is current: running pid $app_pid started after the newest src-tauri change."
  exit 0
fi

rel="${newest_file#"$ROOT"/}"
echo "BACKEND IS STALE — the running window predates your backend changes."
echo "  running pid : $app_pid (started $(portable_fmt_epoch "$started"))"
echo "  newest edit : $rel ($(portable_fmt_epoch "$newest"))"
echo
echo "Frontend (src/) changes are already live via vite HMR; only src-tauri/ needs this."
echo "To pick them up, restart the dev session yourself when it suits you:"
echo "  pkill -f '$ROOT/node_modules/.bin/tauri'; pkill -f '$ROOT/target/debug/eldrun'"
echo "  ./start-eldrun-tauri-hotreload.sh"
exit 1
