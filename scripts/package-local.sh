#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# macOS packages a .app/.dmg and installs nothing — there is no AppImage, no
# `.desktop` entry and no `~/.local/share/applications` to write one into, so
# everything below this branch is Linux-specific by construction. It used to run
# there anyway: `npm run package` on a Mac built an AppImage that cannot be
# produced, fell through to installing a raw Linux binary under
# `~/.local/share/eldrun`, and wrote two desktop entries nothing would ever read.
# CLAUDE.md's claim that `npm run package` "builds the same release artifact
# locally" was true on exactly one platform.
if [ "$(uname -s)" = Darwin ]; then
  cd "$ROOT"
  # Host architecture only. `--target universal-apple-darwin` is what CI ships,
  # but it needs BOTH Apple targets installed (`rustup target add
  # x86_64-apple-darwin`) and builds the whole dependency tree twice — a price
  # worth paying for a release asset and not for a local check. The DMG this
  # writes is the same bundle, minus the second slice.
  npm run tauri:bundle:mac

  dmg="$(find "$ROOT/target/release/bundle/dmg" -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"
  app="$(find "$ROOT/target/release/bundle/macos" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"

  [ -n "$dmg" ] && echo "DMG: $dmg"
  [ -n "$app" ] && echo "App bundle: $app"
  if [ -z "$dmg" ] && [ -z "$app" ]; then
    echo "package: the macOS build produced no bundle under target/release/bundle." >&2
    exit 1
  fi

  # Unsigned, exactly like the alpha DMG the release workflow publishes, so it
  # carries the same quarantine attribute and the same one-time incantation.
  echo
  echo "This bundle is UNSIGNED. Gatekeeper will refuse it until you either"
  echo "right-click → Open once, or clear the quarantine flag:"
  echo "  xattr -dr com.apple.quarantine '${app:-/Applications/Eldrun.app}'"
  exit 0
fi

APP_DIR="$HOME/.local/share/eldrun"
DESKTOP_DIR="$HOME/.local/share/applications"
BINARY_DEST="$APP_DIR/eldrun"
DESKTOP_STABLE_DEST="$DESKTOP_DIR/Eldrun.desktop"
DESKTOP_HOTRELOAD_DEST="$DESKTOP_DIR/EldrunHotReload.desktop"

mkdir -p "$APP_DIR" "$DESKTOP_DIR"

cd "$ROOT"

# Try AppImage bundle first; fall back to raw binary if linuxdeploy fails (e.g. no FUSE).
APPIMAGE_SRC=""
if APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri:bundle 2>&1; then
  APPIMAGE_SRC="$(find "$ROOT/target/release/bundle/appimage" -maxdepth 1 -name '*.AppImage' -print -quit 2>/dev/null || true)"
fi

if [[ -n "${APPIMAGE_SRC:-}" && -f "$APPIMAGE_SRC" ]]; then
  install -Dm755 "$APPIMAGE_SRC" "$BINARY_DEST.AppImage"
  BINARY_DEST="$BINARY_DEST.AppImage"
  echo "Installed AppImage to: $BINARY_DEST"
else
  # AppImage bundling unavailable (no FUSE); use the raw release binary.
  RAW_BIN="$ROOT/target/release/eldrun"
  if [[ ! -f "$RAW_BIN" ]]; then
    # Bundle failed before linking — do a plain cargo build.
    export PATH="$HOME/.cargo/bin:$PATH"
    cargo build --release --manifest-path "$ROOT/src-tauri/Cargo.toml"
  fi
  install -Dm755 "$RAW_BIN" "$BINARY_DEST"
  echo "AppImage bundling unavailable (no FUSE); installed raw binary to: $BINARY_DEST"
fi

cat >"$DESKTOP_STABLE_DEST" <<EOF
[Desktop Entry]
Type=Application
Name=Eldrun
Comment=Terminal workspace manager
Exec=$BINARY_DEST
Icon=$ROOT/src-tauri/icons/128x128.png
Terminal=false
Categories=Utility;TerminalEmulator;Development;
StartupWMClass=eldrun
EOF
chmod 755 "$DESKTOP_STABLE_DEST"

cat >"$DESKTOP_HOTRELOAD_DEST" <<EOF
[Desktop Entry]
Type=Application
Name=EldrunHotReload
Comment=Terminal workspace manager hot reload
Exec=$ROOT/start-eldrun-tauri-hotreload.sh
Icon=$ROOT/src-tauri/icons/128x128.png
Terminal=false
Categories=Utility;TerminalEmulator;Development;
StartupWMClass=eldrun
EOF
chmod 755 "$DESKTOP_HOTRELOAD_DEST"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

echo "Desktop entry: $DESKTOP_STABLE_DEST"
echo "HotReload desktop entry: $DESKTOP_HOTRELOAD_DEST"
