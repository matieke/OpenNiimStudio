#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$DIR/catlabel/bridge/bin"
mkdir -p "$BIN_DIR"

echo "=== Building Linux Standalone Binary ==="
if [ ! -d "$DIR/.venv-build" ]; then
    python3 -m venv "$DIR/.venv-build"
    "$DIR/.venv-build/bin/pip" install pyinstaller bleak websockets pillow
fi
"$DIR/.venv-build/bin/pyinstaller" --onefile --clean \
    --name openniim-helper-linux \
    --distpath "$BIN_DIR" \
    --workpath "$DIR/build/helper-linux" \
    --specpath "$DIR/build" \
    "$DIR/catlabel/bridge/helper.py"

echo "=== Building Windows Standalone Binary (via Wine) ==="
WINE_PYTHON="$HOME/.wine/drive_c/users/$USER/AppData/Local/Programs/Python/Python311/python.exe"
if [ -f "$WINE_PYTHON" ]; then
    wine "$WINE_PYTHON" -m PyInstaller --onefile --clean \
        --name openniim-helper-windows \
        --distpath "Z:$(echo "$BIN_DIR" | tr '/' '\\')" \
        --workpath "Z:$(echo "$DIR/build/helper-windows" | tr '/' '\\')" \
        --specpath "Z:$(echo "$DIR/build" | tr '/' '\\')" \
        "Z:$(echo "$DIR/catlabel/bridge/helper.py" | tr '/' '\\')"
else
    echo "Wine python not found at $WINE_PYTHON, skipping Windows build."
fi

echo "=== Binaries built in $BIN_DIR ==="
ls -lh "$BIN_DIR"
