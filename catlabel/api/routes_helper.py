from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse

router = APIRouter(tags=["Helper"])

BRIDGE_DIR = Path(__file__).resolve().parent.parent / "bridge"
HELPER_FILE = BRIDGE_DIR / "helper.py"
BIN_DIR = BRIDGE_DIR / "bin"
LINUX_BIN = BIN_DIR / "openniim-helper-linux"
WINDOWS_BIN = BIN_DIR / "openniim-helper-windows.exe"

@router.get("/api/helper/script")
def download_helper_script():
    if not HELPER_FILE.exists():
        raise HTTPException(status_code=404, detail="Helper script not found on server.")
    return FileResponse(
        path=HELPER_FILE,
        media_type="text/x-python",
        filename="openniim-helper.py"
    )

@router.get("/api/helper/download/linux")
def download_helper_linux():
    if not LINUX_BIN.exists():
        raise HTTPException(status_code=404, detail="Linux helper binary not found on server.")
    return FileResponse(
        path=LINUX_BIN,
        media_type="application/octet-stream",
        filename="openniim-helper-linux"
    )

@router.get("/api/helper/download/windows")
def download_helper_windows():
    if not WINDOWS_BIN.exists():
        raise HTTPException(status_code=404, detail="Windows helper binary not found on server.")
    return FileResponse(
        path=WINDOWS_BIN,
        media_type="application/vnd.microsoft.portable-executable",
        filename="openniim-helper-windows.exe"
    )

@router.get("/api/helper/info")
def get_helper_info():
    return {
        "version": "1.0.0",
        "port": 9123,
        "protocol": "openniim://",
        "legacy_protocol": "catlabel://",
        "has_linux_bin": LINUX_BIN.exists(),
        "has_windows_bin": WINDOWS_BIN.exists(),
        "available": HELPER_FILE.exists() or LINUX_BIN.exists() or WINDOWS_BIN.exists()
    }
