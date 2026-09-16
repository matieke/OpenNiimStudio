#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$DIR/catlabel/bridge/bin"
mkdir -p "$BIN_DIR"

echo "=== Building Linux Standalone Binary ==="
if [ ! -d "$DIR/.venv-build" ]; then
    python3 -m venv "$DIR/.venv-build"
fi
"$DIR/.venv-build/bin/pip" install --upgrade pyinstaller bleak websockets pillow pystray python-xlib six

ICON_ARG=""
if [ -f "$DIR/icon.ico" ]; then
    ICON_ARG="--icon $DIR/icon.ico"
fi

"$DIR/.venv-build/bin/pyinstaller" --onefile --clean \
    --name openniim-helper-linux \
    --distpath "$BIN_DIR" \
    --workpath "$DIR/build/helper-linux" \
    --specpath "$DIR/build" \
    $ICON_ARG \
    "$DIR/catlabel/bridge/helper.py"

echo "=== Building Windows Standalone Binary (via Wine) ==="
WINE_PYTHON="$HOME/.wine/drive_c/users/$USER/AppData/Local/Programs/Python/Python311/python.exe"
if [ -f "$WINE_PYTHON" ]; then
    wine "$WINE_PYTHON" -m pip install --upgrade pyinstaller bleak websockets pillow pystray six
    wine "$WINE_PYTHON" -m PyInstaller --onefile --clean \
        --name openniim-helper-windows \
        --distpath "Z:$(echo "$BIN_DIR" | tr '/' '\\')" \
        --workpath "Z:$(echo "$DIR/build/helper-windows" | tr '/' '\\')" \
        --specpath "Z:$(echo "$DIR/build" | tr '/' '\\')" \
        --icon "Z:$(echo "$DIR/icon.ico" | tr '/' '\\')" \
        "Z:$(echo "$DIR/catlabel/bridge/helper.py" | tr '/' '\\')"
else
    echo "Wine python not found at $WINE_PYTHON, skipping Windows build."
fi

echo "=== Binaries built in $BIN_DIR ==="
ls -lh "$BIN_DIR"
