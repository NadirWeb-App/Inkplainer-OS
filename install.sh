#!/usr/bin/env bash
# Install Inkplainer for local use on macOS or Linux.
#
#   ./install.sh               install (or reinstall) and open the app
#   ./install.sh --no-open     install (or reinstall) and start the server only
#   ./install.sh --uninstall   remove the install and launcher
#
# The app is installed as a git clone in $INKPLAINER_HOME (default
# ~/.local/share/inkplainer) and an `inkplainer` command is added to
# ~/.local/bin. Every time you open it, the launcher pulls the latest version
# of the repository you installed from and, if that is a fork, merges in the
# original Inkplainer repository as well. It serves the app at
# http://127.0.0.1:$INKPLAINER_PORT (default 8737).
#
# Projects are kept in the browser's storage for that address, so always use
# the same port: a different port is a different site and starts empty.
# Use "Save to File…" in the Projects window to keep copies on disk.
#
# Optional settings (environment variables):
#   INKPLAINER_HOME      where to install
#   INKPLAINER_PORT      local port to serve on
#   INKPLAINER_REPO      repository to install and update from (default: this clone's origin)
#   INKPLAINER_BRANCH    branch to follow (default: this clone's current branch)
#   INKPLAINER_UPSTREAM  original repository merged into a fork's install ("none" to skip)

set -euo pipefail

OFFICIAL_REPO="https://github.com/NadirWeb-App/Inkplainer-OS.git"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INKPLAINER_HOME="${INKPLAINER_HOME:-$HOME/.local/share/inkplainer}"
INKPLAINER_PORT="${INKPLAINER_PORT:-8737}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
LAUNCHER="$BIN_DIR/inkplainer"
MAC_APP="$HOME/Applications/Inkplainer.app"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/inkplainer.desktop"

uninstall() {
  if [ -x "$LAUNCHER" ]; then "$LAUNCHER" stop >/dev/null 2>&1 || true; fi
  rm -rf "$INKPLAINER_HOME" "$LAUNCHER" "$MAC_APP" "$DESKTOP_FILE"
  echo "Inkplainer removed. Projects saved in your browser were not touched."
}

OPEN_AFTER=1
case "${1:-}" in
  --uninstall) uninstall; exit 0 ;;
  --no-open)   OPEN_AFTER=0 ;;
  "")          ;;
  *)           echo "Usage: ./install.sh [--no-open|--uninstall]" >&2; exit 2 ;;
esac

for cmd in git python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Inkplainer needs $cmd for a local install. Install it and run this again." >&2
    exit 1
  fi
done

# ── Where to install and update from ───────────────────────────────────────
repo="${INKPLAINER_REPO:-$(git -C "$SRC_DIR" remote get-url origin 2>/dev/null || echo "$OFFICIAL_REPO")}"
branch="${INKPLAINER_BRANCH:-$(git -C "$SRC_DIR" symbolic-ref --short HEAD 2>/dev/null || echo main)}"
upstream="${INKPLAINER_UPSTREAM:-$(git -C "$SRC_DIR" remote get-url upstream 2>/dev/null || echo "$OFFICIAL_REPO")}"

same_repo() {
  local a b
  a="$(echo "$1" | sed -E 's#\.git$##; s#^git@github\.com:#https://github.com/#' | tr '[:upper:]' '[:lower:]')"
  b="$(echo "$2" | sed -E 's#\.git$##; s#^git@github\.com:#https://github.com/#' | tr '[:upper:]' '[:lower:]')"
  [ "$a" = "$b" ]
}
if [ "$upstream" = "none" ] || same_repo "$repo" "$upstream"; then upstream=""; fi

# ── Clone (or reuse) the install ───────────────────────────────────────────
if [ -x "$LAUNCHER" ]; then "$LAUNCHER" stop >/dev/null 2>&1 || true; fi

if [ -d "$INKPLAINER_HOME/.git" ]; then
  echo "Updating Inkplainer in $INKPLAINER_HOME"
  git -C "$INKPLAINER_HOME" remote set-url origin "$repo"
else
  echo "Installing Inkplainer to $INKPLAINER_HOME"
  rm -rf "$INKPLAINER_HOME"
  mkdir -p "$(dirname "$INKPLAINER_HOME")"
  git clone --quiet --branch "$branch" "$repo" "$INKPLAINER_HOME"
fi

cd "$INKPLAINER_HOME"
git config inkplainer.port "$INKPLAINER_PORT"
git config inkplainer.branch "$branch"
if [ -n "$upstream" ]; then
  if git remote get-url upstream >/dev/null 2>&1; then
    git remote set-url upstream "$upstream"
  else
    git remote add upstream "$upstream"
  fi
  echo "Updates will come from $repo ($branch) and $upstream"
else
  git remote remove upstream >/dev/null 2>&1 || true
  echo "Updates will come from $repo ($branch)"
fi

# ── Launcher and desktop entry ─────────────────────────────────────────────
mkdir -p "$BIN_DIR"
ln -sf "$INKPLAINER_HOME/bin/inkplainer" "$LAUNCHER"

if [ "$(uname)" = "Darwin" ]; then
  mkdir -p "$MAC_APP/Contents/MacOS"
  cat > "$MAC_APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Inkplainer</string>
  <key>CFBundleIdentifier</key><string>app.inkplainer.local</string>
  <key>CFBundleExecutable</key><string>inkplainer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF
  cat > "$MAC_APP/Contents/MacOS/inkplainer" <<EOF
#!/usr/bin/env bash
exec "$LAUNCHER" open
EOF
  chmod +x "$MAC_APP/Contents/MacOS/inkplainer"
  echo "Added $MAC_APP (find it in Spotlight or Launchpad)"
else
  mkdir -p "$(dirname "$DESKTOP_FILE")"
  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Inkplainer
Comment=Whiteboard animation maker
Exec=$LAUNCHER open
Icon=$INKPLAINER_HOME/favicon.svg
Categories=Graphics;
Terminal=false
EOF
  echo "Added $DESKTOP_FILE"
fi

if [ "$OPEN_AFTER" = 1 ]; then "$LAUNCHER" open; else "$LAUNCHER" update && "$LAUNCHER" start >/dev/null; fi

echo
echo "Inkplainer is installed and running at http://127.0.0.1:$INKPLAINER_PORT/"
case ":$PATH:" in
  *":$BIN_DIR:"*) echo "Run \`inkplainer\` to open it again; it updates itself each time." ;;
  *) echo "Run \`$LAUNCHER\` to open it again; it updates itself each time (add $BIN_DIR to your PATH to use \`inkplainer\`)." ;;
esac
echo "In Chrome or Edge you can also use \"Install Inkplainer\" from the address bar to get a standalone app."
