#!/usr/bin/env bash
# Makes the `9drive` command available in every terminal (no sudo needed).
# It links scripts/9drive into ~/.local/bin and, if needed, adds that folder to PATH in ~/.bashrc.
set -euo pipefail
REPO="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
chmod +x "$REPO/scripts/9drive"
mkdir -p "$HOME/.local/bin"
ln -sf "$REPO/scripts/9drive" "$HOME/.local/bin/9drive"
MARK="# added by 9Drive: lets you type 9drive anywhere"
if ! grep -qF "$MARK" "$HOME/.bashrc" 2>/dev/null; then
  printf '\n%s\nexport PATH="$HOME/.local/bin:$PATH"\n' "$MARK" >> "$HOME/.bashrc"
  echo "Added ~/.local/bin to PATH in ~/.bashrc"
fi
echo "Installed: $HOME/.local/bin/9drive -> $REPO/scripts/9drive"
echo "Open a new terminal (or run: source ~/.bashrc) and type: 9drive"
