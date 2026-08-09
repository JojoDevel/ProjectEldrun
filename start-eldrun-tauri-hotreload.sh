#!/usr/bin/env bash
# Launcher for the hot-reload Tauri dev server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/portable.sh
. "$ROOT/scripts/portable.sh"

# Log beside the app's own state, which is not the same path on every OS —
# `storage::state_dir()` puts it under `~/Library/Application Support` on macOS
# and `%APPDATA%` on Windows. Hardcoding the XDG path here left a mac session
# writing its log to a directory nothing else in Eldrun uses, which is exactly
# where nobody looks for it.
if [ "$(uname -s)" = Darwin ]; then
  LOG_DIR="$HOME/Library/Application Support/eldrun"
else
  LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/eldrun"
fi
LOG_FILE="$LOG_DIR/hotreload.log"
LOG_MAX_BYTES=$((64 * 1024 * 1024))

mkdir -p "$LOG_DIR"

# `tauri dev` streams every cargo build bar and vite HMR line in here, so the
# log grows without bound (it reached 2 GB once). Keep one generation.
#
# The size probe goes through `portable_file_size` because the `stat -c %s` this
# used to call is GNU-only, and the `|| echo 0` fallback turned that into a
# silent no-op on macOS: an erroring stat read as "0 bytes", i.e. "no rotation
# needed", forever. Unknown is now empty rather than zero, and an unknown size
# rotates nothing — but it also cannot masquerade as a measurement.
log_size="$(portable_file_size "$LOG_FILE" || true)"
if [ -f "$LOG_FILE" ] && [ -n "$log_size" ] && [ "$log_size" -gt "$LOG_MAX_BYTES" ]; then
  mv -f "$LOG_FILE" "$LOG_FILE.1"
fi

exec >>"$LOG_FILE" 2>&1

printf '\n=== HOTRELOAD START %s ===\n' "$(portable_iso_now)"
trap 'status=$?; printf "=== HOTRELOAD EXIT %s status=%s ===\n" "$(portable_iso_now)" "$status"' EXIT

cd "$ROOT"

# Refuse to become a second instance. Also runs again via the `pretauri:dev`
# npm hook below, which is what covers a bare `npm run tauri:dev`.
"$ROOT/scripts/guard-single-instance.sh"

# Desktop entries don't source ~/.bashrc, so Rust tools may not be in PATH.
export PATH="$HOME/.cargo/bin:$PATH"

# With GTK overlay scrolling on (the default on Cinnamon/GNOME), WebKitGTK draws
# a native GTK overlay scrollbar and ignores the app's CSS `scrollbar-color`, so
# the themed (blue) scrollbars fall back to the system GTK theme (white/grey in
# Adwaita light). Disabling it forces the legacy scrollbar, which WebKitGTK
# renders itself and themes from our CSS. Harmless where it's already off.
export GTK_OVERLAY_SCROLLING=0

printf 'root=%s\n' "$ROOT"
printf 'PATH=%s\n' "$PATH"
command -v node
node --version
command -v npm
npm --version
command -v cargo
cargo --version
command -v rustc
rustc --version

exec npm run tauri:dev
