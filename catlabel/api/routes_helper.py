from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse

router = APIRouter(tags=["Helper"])

HELPER_FILE = Path(__file__).resolve().parent.parent / "bridge" / "helper.py"

@router.get("/api/helper/script")
def download_helper_script():
    if not HELPER_FILE.exists():
        raise HTTPException(status_code=404, detail="Helper script not found on server.")
    return FileResponse(
        path=HELPER_FILE,
        media_type="text/x-python",
        filename="catlabel-helper.py"
    )

@router.get("/api/helper/info")
def get_helper_info():
    return {
        "version": "1.0.0",
        "port": 9123,
        "protocol": "catlabel://",
        "available": HELPER_FILE.exists()
    }
