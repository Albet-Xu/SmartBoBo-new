#!/usr/bin/env bash
# SmartBoBo launcher (Linux / macOS) - pristine dsh web on 7075.
# Mirrors 启动.cmd: project-local DSH_HOME, official packaged kernel,
# browser opens automatically. Keep this file pure ASCII.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Packaged kernel location per platform (override with DSH_KERNEL).
# Windows (Git Bash): %APPDATA%\dsh-tauri\...
# Linux Tauri app-data default: ~/.local/share/dsh-tauri/...
KERNEL="${DSH_KERNEL:-$HOME/.local/share/dsh-tauri/dependencies/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js}"

if [ ! -f "$KERNEL" ]; then
  echo "[ERROR] Packaged kernel not found:"
  echo "        $KERNEL"
  echo "        Run 'Deepseek Harness Desktop' once, or set DSH_KERNEL."
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "[ERROR] node not found in PATH."; exit 1; }

# SmartBoBo brand patch (idempotent; safe if already applied)
node "$ROOT/scripts/apply-brand-patch.mjs" || echo "[WARN] brand patch failed; continuing with unbranded kernel."

export DSH_HOME="$ROOT/.dsh"
mkdir -p "$DSH_HOME"

echo "[INFO] DSH_HOME = $DSH_HOME"
echo "[INFO] Kernel    = $KERNEL"
echo "[INFO] Serving   = http://127.0.0.1:7075 (browser opens automatically)"

node "$KERNEL" --profile web --port 7075
