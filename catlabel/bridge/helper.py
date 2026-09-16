#!/usr/bin/env python3
"""
OpenNiimStudio Local Print Helper
Self-contained local companion daemon for browsers without Web Bluetooth (Firefox, desktop Safari).
Communicates with the web app over ws://127.0.0.1:9123.
Handles local Bluetooth scanning and printing, registers openniim:// and catlabel:// protocol handlers,
and automatically exits 15 seconds after all OpenNiimStudio tabs are closed.
"""

from __future__ import annotations

import asyncio
import base64
import collections
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import platform
import re
import struct
import subprocess
import sys
import tempfile
import threading
import urllib.request
import webbrowser
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

PORT = 9123
HOST = "127.0.0.1"
AUTO_SHUTDOWN_GRACE_SEC = 15.0

VERSION = "0.3.2"
IS_FROZEN = getattr(sys, "frozen", False)
BUILD_TYPE = "binary" if IS_FROZEN else "python"

# --- Logging & In-Memory Ring Buffer ---
LOG_BUFFER: collections.deque[str] = collections.deque(maxlen=500)

class BufferLogHandler(logging.Handler):
    def emit(self, record):
        try:
            msg = self.format(record)
            LOG_BUFFER.append(msg)
        except Exception:
            pass

def get_log_file_path() -> Path:
    system = platform.system().lower()
    if system == "windows":
        base = Path(os.environ.get("APPDATA", Path.home())) / "OpenNiimStudio"
    elif system == "darwin":
        base = Path.home() / "Library" / "Logs" / "OpenNiimStudio"
    else:
        base = Path.home() / ".config" / "openniim"
    try:
        base.mkdir(parents=True, exist_ok=True)
        return base / "helper.log"
    except Exception:
        return Path(tempfile.gettempdir()) / "openniim-helper.log"

LOG_FILE_PATH = get_log_file_path()

logger = logging.getLogger("openniim-helper")
logger.setLevel(logging.INFO)
formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

if not logger.handlers:
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    try:
        file_handler = RotatingFileHandler(str(LOG_FILE_PATH), maxBytes=2 * 1024 * 1024, backupCount=2, encoding="utf-8")
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except Exception as e:
        print(f"Warning: Could not configure file logger at {LOG_FILE_PATH}: {e}", file=sys.stderr)

    buf_handler = BufferLogHandler()
    buf_handler.setFormatter(formatter)
    logger.addHandler(buf_handler)

CONNECTED_CLIENTS: Set[any] = set()
SHUTDOWN_HANDLE: asyncio.TimerHandle | None = None
SCAN_LOCK: asyncio.Lock | None = None
TRAY_ICON = None
LATEST_SERVER_VERSION: Optional[str] = None
LATEST_SERVER_URL: str = "http://localhost:8000"


def open_log_file():
    """Opens helper.log in the system's default text viewer."""
    try:
        system = platform.system().lower()
        if system == "windows":
            os.startfile(str(LOG_FILE_PATH))
        elif system == "darwin":
            subprocess.Popen(["open", str(LOG_FILE_PATH)])
        else:
            subprocess.Popen(["xdg-open", str(LOG_FILE_PATH)])
    except Exception as e:
        logger.error("Failed to open log file %s: %s", LOG_FILE_PATH, e)


def check_server_update(server_url: str) -> Tuple[bool, Optional[str]]:
    """Queries /api/helper/info on the server to check for updates."""
    try:
        url = f"{server_url.rstrip('/')}/api/helper/info"
        req = urllib.request.Request(url, headers={"User-Agent": f"OpenNiimHelper/{VERSION}"})
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            srv_ver = data.get("version")
            if srv_ver and srv_ver > VERSION:
                return True, srv_ver
    except Exception as e:
        logger.debug("Could not check update against %s: %s", server_url, e)
    return False, None


def perform_self_update(server_url: str) -> Tuple[bool, str]:
    """Downloads updated binary from server and swaps/restarts."""
    if not IS_FROZEN:
        return False, "Self-update is only available for standalone compiled binaries."

    system = platform.system().lower()
    endpoint = "/api/helper/download/windows" if system == "windows" else "/api/helper/download/linux"
    download_url = f"{server_url.rstrip('/')}{endpoint}"
    current_exe = Path(sys.executable).resolve()
    temp_target = current_exe.with_suffix(current_exe.suffix + ".download")

    logger.info("Downloading helper update from %s -> %s...", download_url, temp_target)
    try:
        req = urllib.request.Request(download_url, headers={"User-Agent": f"OpenNiimHelper/{VERSION}"})
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            content = resp.read()
            if len(content) < 500_000:
                return False, f"Downloaded file is suspiciously small ({len(content)} bytes)."
            with open(temp_target, "wb") as f:
                f.write(content)

        if system != "windows":
            temp_target.chmod(0o755)
            temp_target.replace(current_exe)
            current_exe.chmod(0o755)
            logger.info("Binary replaced with updated version. Relaunching %s...", current_exe)
            subprocess.Popen([str(current_exe), "openniim://start"])
            os._exit(0)
        else:
            updater_bat = current_exe.parent / "_updater.bat"
            bat_content = f"""@echo off
timeout /t 1 /nobreak > NUL
move /y "{temp_target}" "{current_exe}"
start "" "{current_exe}" openniim://start
del "%~f0"
"""
            updater_bat.write_text(bat_content, encoding="utf-8")
            logger.info("Windows updater script created. Launching and exiting...")
            flags = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
            subprocess.Popen(["cmd.exe", "/c", str(updater_bat)], creationflags=flags)
            os._exit(0)
    except Exception as e:
        logger.exception("Self-update failed: %s", e)
        if temp_target.exists():
            try: temp_target.unlink()
            except Exception: pass
        return False, str(e)
    return True, "Update initiated"


# --- Auto-install lightweight dependencies if needed ---
def ensure_dependencies():
    if getattr(sys, "frozen", False):
        return

    packages = []
    try:
        import websockets
    except ImportError:
        packages.append("websockets")
    try:
        import bleak
    except ImportError:
        packages.append("bleak")
    try:
        import PIL
    except ImportError:
        packages.append("pillow")
    try:
        import pystray
    except ImportError:
        packages.append("pystray")

    if packages:
        logger.info("Installing required companion dependencies (%s)...", ", ".join(packages))
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "--user", *packages], check=True)
            logger.info("Companion dependencies installed successfully.")
        except Exception as e:
            logger.warning("Could not auto-install dependencies via pip: %s", e)

ensure_dependencies()


# --- Protocol Handler Registration ---
def register_protocol_handler():
    """Register openniim:// and catlabel:// protocol handlers on the user's OS."""
    system = platform.system().lower()
    is_frozen = getattr(sys, "frozen", False)
    if is_frozen:
        exec_cmd_linux = f'"{sys.executable}" %u'
        exec_cmd_windows = f'"{sys.executable}" "%1"'
    else:
        script_path = Path(__file__).resolve()
        python_exe = sys.executable
        exec_cmd_linux = f'{python_exe} "{script_path}" %u'
        exec_cmd_windows = f'"{python_exe}" "{script_path}" "%1"'

    logger.info("Registering openniim:// and catlabel:// URL protocols for %s (frozen=%s)...", system, is_frozen)

    if system == "linux":
        app_dir = Path.home() / ".local" / "share" / "applications"
        app_dir.mkdir(parents=True, exist_ok=True)
        desktop_file = app_dir / "openniim-helper.desktop"
        desktop_entry = f"""[Desktop Entry]
Name=OpenNiimStudio Print Helper
Comment=Local Bluetooth print relay for OpenNiimStudio
Exec={exec_cmd_linux}
Type=Application
Terminal=false
MimeType=x-scheme-handler/openniim;x-scheme-handler/catlabel;
NoDisplay=true
StartupNotify=false
Categories=Utility;
"""
        desktop_file.write_text(desktop_entry, encoding="utf-8")

        try:
            subprocess.run(
                ["xdg-mime", "default", "openniim-helper.desktop", "x-scheme-handler/openniim"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                ["xdg-mime", "default", "openniim-helper.desktop", "x-scheme-handler/catlabel"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                ["update-desktop-database", str(app_dir)],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            logger.info("Successfully registered xdg-mime handlers for openniim:// and catlabel://")
        except Exception as e:
            logger.warning("Could not update xdg-mime: %s", e)

    elif system == "windows":
        try:
            import winreg
            for scheme, desc in [("openniim", "OpenNiimStudio Protocol"), ("catlabel", "CatLabel Protocol")]:
                key_path = rf"Software\Classes\{scheme}"
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
                    winreg.SetValueEx(key, "", 0, winreg.REG_SZ, f"URL:{desc}")
                    winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
                cmd_path = rf"{key_path}\shell\open\command"
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER, cmd_path) as cmd_key:
                    winreg.SetValueEx(
                        cmd_key, "", 0, winreg.REG_SZ, exec_cmd_windows
                    )
            logger.info("Successfully registered Windows registry handlers for openniim:// and catlabel://")
        except Exception as e:
            logger.warning("Could not register Windows registry handler: %s", e)


# --- Auto-Shutdown Lifecycle ---
def schedule_auto_shutdown():
    global SHUTDOWN_HANDLE
    if SHUTDOWN_HANDLE is not None:
        return
    loop = asyncio.get_running_loop()
    logger.info("No active browser tabs connected. Helper will auto-terminate in %ds...", int(AUTO_SHUTDOWN_GRACE_SEC))
    SHUTDOWN_HANDLE = loop.call_later(AUTO_SHUTDOWN_GRACE_SEC, _do_auto_shutdown)


def cancel_auto_shutdown():
    global SHUTDOWN_HANDLE
    if SHUTDOWN_HANDLE is not None:
        SHUTDOWN_HANDLE.cancel()
        SHUTDOWN_HANDLE = None
        logger.info("Active browser tab connected. Auto-shutdown cancelled.")


def _do_auto_shutdown():
    if not CONNECTED_CLIENTS:
        logger.info("Auto-shutdown timer elapsed with 0 clients. Closing helper cleanly.")
        if TRAY_ICON is not None:
            try:
                TRAY_ICON.stop()
            except Exception:
                pass
        os._exit(0)


# --- Desktop System Tray Integration ---
def update_tray_state():
    """Updates tray icon tooltip and menu to reflect live client count."""
    global TRAY_ICON
    if TRAY_ICON is not None:
        try:
            TRAY_ICON.title = f"OpenNiim Helper v{VERSION} ({len(CONNECTED_CLIENTS)} connected)"
            TRAY_ICON.update_menu()
        except Exception:
            pass


def create_tray_image():
    """Returns a 64x64 RGBA PIL Image for the system tray."""
    from PIL import Image, ImageDraw
    candidates = []
    if getattr(sys, "frozen", False):
        base_dir = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        candidates.extend([base_dir / "icon.ico", base_dir / "logo.webp"])
    candidates.extend([
        Path(__file__).resolve().parent.parent.parent / "logo.webp",
        Path(__file__).resolve().parent.parent.parent / "icon.ico",
        Path("logo.webp"),
        Path("icon.ico"),
    ])
    for p in candidates:
        if p.exists():
            try:
                img = Image.open(p)
                return img.resize((64, 64)).convert("RGBA")
            except Exception:
                pass

    # Draw crisp fallback printer icon
    img = Image.new("RGBA", (64, 64), color=(0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([(4, 4), (60, 60)], radius=12, fill=(16, 185, 129))
    d.rectangle([(16, 12), (48, 24)], fill=(255, 255, 255))
    d.rounded_rectangle([(12, 22), (52, 48)], radius=4, fill=(240, 253, 250))
    d.line([(18, 32), (46, 32)], fill=(16, 185, 129), width=3)
    d.ellipse([(44, 40), (48, 44)], fill=(16, 185, 129))
    return img


def setup_system_tray():
    """Initializes and runs the pystray icon loop."""
    global TRAY_ICON
    try:
        import pystray
        from pystray import MenuItem as item, Menu as menu

        def on_exit(icon, _item):
            logger.info("Exit requested from system tray.")
            try:
                icon.stop()
            except Exception:
                pass
            os._exit(0)

        def on_open_web(icon, _item):
            webbrowser.open(LATEST_SERVER_URL)

        def on_view_logs(icon, _item):
            open_log_file()

        def on_check_updates(icon, _item):
            has_update, new_ver = check_server_update(LATEST_SERVER_URL)
            if has_update:
                try:
                    icon.notify(f"Update Available: v{new_ver} (Current: v{VERSION})", "OpenNiim Helper")
                except Exception:
                    pass
                perform_self_update(LATEST_SERVER_URL)
            else:
                try:
                    icon.notify(f"OpenNiim Helper is up to date (v{VERSION})", "OpenNiim Helper")
                except Exception:
                    pass

        def get_status_text(_item):
            return f"OpenNiim Helper v{VERSION} ({BUILD_TYPE.capitalize()})"

        def get_tabs_text(_item):
            return f"Connected tabs: {len(CONNECTED_CLIENTS)}"

        def get_update_text(_item):
            if LATEST_SERVER_VERSION and LATEST_SERVER_VERSION > VERSION:
                return f"⚠️ Update Available: v{LATEST_SERVER_VERSION}"
            return "Check for Updates"

        tray_menu = menu(
            item(get_status_text, None, enabled=False),
            item(get_tabs_text, None, enabled=False),
            item("---", None, enabled=False),
            item("View Logs", on_view_logs),
            item(get_update_text, on_check_updates),
            item("Open OpenNiimStudio", on_open_web),
            item("---", None, enabled=False),
            item("Quit Helper", on_exit)
        )

        TRAY_ICON = pystray.Icon("OpenNiimHelper", create_tray_image(), f"OpenNiim Helper v{VERSION}", tray_menu)
        TRAY_ICON.run()
    except Exception as e:
        logger.warning("System tray unavailable in this environment: %s. Continuing in headless mode.", e)


def start_system_tray_thread():
    t = threading.Thread(target=setup_system_tray, daemon=True, name="SystemTrayThread")
    t.start()
    return t


# --- Non-Printer Rejection & Printer Identification ---
EXCLUDED_DEVICE_KEYWORDS = (
    "tv", "television", "samsung", "lg webos", "sony", "bravia", "tcl", "hisense",
    "fridge", "refrigerator", "headphone", "headset", "earbud", "earphone", "airpod",
    "buds", "speaker", "soundbar", "echo", "alexa", "watch", "band", "phone",
    "desktop", "laptop", "pc", "fedora", "ubuntu", "windows", "macbook", "iphone",
    "ipad", "galaxy", "car", "audio", "keyboard", "mouse", "controller", "receiver",
    "dongle", "tony", "pixel"
)

PRINTER_KEYWORDS = (
    "d11", "d110", "d101", "b21", "b1", "b3s", "b18", "b203", "m110", "m200", "m220",
    "h1", "jc", "phomemo", "m02", "t02", "d30", "q30", "printer", "thermal",
    "label", "pos-", "pos58", "pos80", "catprinter", "munbyn", "peripage", "niimbot"
)

def classify_device(name: str, mac: str) -> Optional[dict]:
    name_clean = (name or "").strip()
    name_lower = name_clean.lower()
    
    if not name_clean:
        return None

    # 1. Immediately drop common household appliances and personal devices
    if any(bad in name_lower for bad in EXCLUDED_DEVICE_KEYWORDS):
        return None

    # 2. Must match a known printer model or printer keyword
    if not any(kw in name_lower for kw in PRINTER_KEYWORDS):
        return None

    # Niimbot models (order matters: specific prefixes before short ones)
    niim_models = {
        "d110_m": ("d110_m", 203, 15),
        "d110": ("d110", 203, 15),
        "d11": ("d11", 203, 15),
        "d101": ("d101", 203, 25),
        "b21": ("b21", 203, 50),
        "b1": ("b1", 203, 48),
        "b3s": ("b3s", 203, 72),
        "b18": ("b18", 203, 15),
        "b203": ("b203", 203, 50),
        "m110": ("m110", 203, 50),
        "m200": ("m200", 203, 72),
        "m220": ("m220", 203, 72),
        "h1": ("h1", 203, 15),
        "jc": ("jc_generic", 203, 15),
    }

    vendor = "Generic Printer"
    model_id = "generic_printer"
    dpi = 203
    width_mm = 48

    for prefix, (model, d, w) in niim_models.items():
        if prefix in name_lower:
            vendor = "Niimbot"
            model_id = model
            dpi = d
            width_mm = w
            break

    if "phomemo" in name_lower or any(p in name_lower for p in ["m02", "t02", "d30", "q30"]):
        vendor = "Phomemo"
        dpi = 203
        model_id = "phomemo"

    media_type = "pre-cut" if vendor in ("Niimbot", "Phomemo") else "continuous"
    width_px = round(width_mm * (dpi / 25.4))

    return {
        "address": mac,
        "name": name_clean,
        "model_id": model_id,
        "vendor": vendor,
        "transport": "bluetooth_helper",
        "dpi": dpi,
        "paired": False,
        "width_mm": width_mm,
        "width_px": width_px,
        "media_type": media_type,
        "is_rotated": True,
    }


def get_scan_lock() -> asyncio.Lock:
    global SCAN_LOCK
    if SCAN_LOCK is None:
        SCAN_LOCK = asyncio.Lock()
    return SCAN_LOCK


# --- Bluetooth Scanning ---
async def scan_devices() -> List[dict]:
    lock = get_scan_lock()
    async with lock:
        found_devices: Dict[str, dict] = {}
        loop = asyncio.get_running_loop()

        # Method 1: Linux bluetoothctl (reliable BlueZ integration via worker thread)
        if platform.system().lower() == "linux":
            try:
                logger.info("Initiating local Bluetooth scan via bluetoothctl...")
                def _run_btctl():
                    subprocess.run(
                        ["bluetoothctl", "--timeout", "3", "scan", "on"],
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False
                    )
                    return subprocess.run(
                        ["bluetoothctl", "devices"],
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        text=True,
                        check=False
                    )

                proc = await loop.run_in_executor(None, _run_btctl)
                for line in proc.stdout.splitlines():
                    m = re.match(r"Device\s+([0-9A-Fa-f:]+)\s+(.+)", line)
                    if m:
                        mac, dev_name = m.group(1), m.group(2).strip()
                        classified = classify_device(dev_name, mac)
                        if classified:
                            logger.info("bluetoothctl discovered printer: %s [%s] -> %s", dev_name, mac, classified["model_id"])
                            found_devices[mac.upper()] = classified
                        else:
                            logger.debug("bluetoothctl non-printer device: %s [%s]", dev_name, mac)
            except Exception as e:
                logger.warning("bluetoothctl scan error: %s", e)

        # Method 2: Bleak BLE scanner (cross-platform, wrapped in timeout)
        try:
            import bleak
            logger.info("Scanning for BLE devices via bleak...")
            try:
                ble_devices = await asyncio.wait_for(bleak.BleakScanner.discover(timeout=3.0), timeout=5.0)
                for d in ble_devices:
                    name = (d.name or "").strip()
                    mac = d.address.upper()
                    if name:
                        classified = classify_device(name, mac)
                        if classified:
                            logger.info("Bleak discovered printer: %s [%s] -> %s", name, mac, classified["model_id"])
                            found_devices[mac] = classified
                        else:
                            logger.debug("Bleak non-printer device: %s [%s]", name, mac)
            except asyncio.TimeoutError:
                logger.warning("Bleak scan timed out after 5.0s, proceeding with found devices.")
        except Exception as e:
            logger.warning("Bleak scan error: %s", e)

        ordered = sorted(
            found_devices.values(),
            key=lambda d: 0 if d["vendor"] in ("Niimbot", "Phomemo") else 1
        )
        logger.info("Local scan finished. Found %d valid printers.", len(ordered))
        return ordered


# --- Niimbot RFID Decoding ---
KNOWN_NIIMBOT_BARCODES = {
    # 01222281 is Niimbot's official SKU code for 12x40mm (nominal 160 labels per roll)
    "01222281": {"width_mm": 40, "height_mm": 12, "is_rotated": True, "nominal_labels": 160, "preset_name": "Pre-cut: Niimbot 40x12mm"},
    "01240": {"width_mm": 40, "height_mm": 12, "is_rotated": True, "nominal_labels": 160, "preset_name": "Pre-cut: Niimbot 40x12mm"},
    "01230": {"width_mm": 30, "height_mm": 12, "is_rotated": True, "nominal_labels": 210, "preset_name": "Pre-cut: Niimbot 30x12mm"},
    "01222": {"width_mm": 22, "height_mm": 12, "is_rotated": True, "nominal_labels": 260, "preset_name": "Pre-cut: Niimbot 22x12mm"},
    "01530": {"width_mm": 30, "height_mm": 15, "is_rotated": True, "nominal_labels": 210, "preset_name": "Pre-cut: Niimbot 30x15mm"},
    "01450": {"width_mm": 50, "height_mm": 14, "is_rotated": True, "nominal_labels": 130, "preset_name": "Pre-cut: Niimbot 50x14mm"},
    "01275": {"width_mm": 75, "height_mm": 12, "is_rotated": True, "nominal_labels": 80, "preset_name": "Pre-cut: Niimbot 75x12mm"},
}

def decode_niimbot_barcode(barcode: str) -> dict:
    """
    Decodes standard Niimbot roll barcode into label dimensions.
    Example: '01222281' -> 12x40mm -> 40x12mm rotated preset.
    """
    clean_bc = (barcode or "").strip()

    # 1. Exact catalog match
    if clean_bc in KNOWN_NIIMBOT_BARCODES:
        return {
            **KNOWN_NIIMBOT_BARCODES[clean_bc],
            "media_type": "pre-cut",
        }

    # 2. Prefix match in known barcodes
    for prefix, info in KNOWN_NIIMBOT_BARCODES.items():
        if clean_bc.startswith(prefix):
            return {
                **info,
                "media_type": "pre-cut",
            }

    # 3. Standard Niimbot 8-digit or 7-digit roll barcode: 0[WW][LL][CCC]
    w_mm = 40
    h_mm = 12
    match = re.match(r"^0?(\d{2})(\d{2})", clean_bc)
    if match:
        try:
            val1 = int(match.group(1))
            val2 = int(match.group(2))
            if 10 <= val1 <= 100 and 10 <= val2 <= 150:
                long_dim = max(val1, val2)
                short_dim = min(val1, val2)
                w_mm = long_dim
                h_mm = short_dim
        except Exception:
            pass

    return {
        "width_mm": w_mm,
        "height_mm": h_mm,
        "is_rotated": True,
        "media_type": "pre-cut",
    }


async def get_niimbot_rfid(mac: str) -> dict:
    from bleak import BleakClient
    NIIM_CHAR_UUID = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"

    logger.info("Reading RFID chip from printer at %s...", mac)
    resp_bytes = bytearray()
    event = asyncio.Event()

    def on_notify(sender, data: bytearray):
        resp_bytes.extend(data)
        if len(resp_bytes) >= 7 and resp_bytes[-2:] == b"\xaa\xaa":
            event.set()

    try:
        async with BleakClient(mac, timeout=8.0) as client:
            if not client.is_connected:
                return {"success": False, "error": f"Could not connect to {mac}"}

            target_char = None
            for service in client.services:
                for char in service.characteristics:
                    if NIIM_CHAR_UUID in char.uuid.lower():
                        target_char = char
                        break
                if target_char:
                    break
            if not target_char:
                target_char = NIIM_CHAR_UUID

            await client.start_notify(target_char, on_notify)
            # Send RfidInfo packet (type 26)
            pkt = make_niimbot_packet(26, b"")
            await client.write_gatt_char(target_char, pkt, response=False)

            try:
                await asyncio.wait_for(event.wait(), timeout=4.0)
            except asyncio.TimeoutError:
                return {"success": False, "error": "Printer did not respond to RFID query"}
            finally:
                try:
                    await client.stop_notify(target_char)
                except Exception:
                    pass

        if len(resp_bytes) < 7 or resp_bytes[2] != 27:
            return {"success": False, "error": "Invalid RFID packet structure"}

        payload_len = resp_bytes[3]
        payload = bytes(resp_bytes[4 : 4 + payload_len])
        if len(payload) <= 1:
            return {"success": True, "tag_present": False, "message": "No RFID tag detected in roll"}

        idx = 0
        tag_uuid = payload[idx : idx + 8].hex()
        idx += 8

        barcode_len = payload[idx]
        idx += 1
        barcode = payload[idx : idx + barcode_len].decode("ascii", errors="ignore")
        idx += barcode_len

        serial_len = payload[idx]
        idx += 1
        serial = payload[idx : idx + serial_len].decode("ascii", errors="ignore")
        idx += serial_len

        total_labels, used_labels = struct.unpack(">HH", payload[idx : idx + 4])
        idx += 4
        consumables_type = payload[idx] if idx < len(payload) else 1

        dim = decode_niimbot_barcode(barcode)
        nominal_labels = dim.get("nominal_labels")

        if nominal_labels:
            total_display = nominal_labels
            remaining_labels = max(0, min(nominal_labels, nominal_labels - used_labels))
        else:
            total_display = total_labels
            remaining_labels = max(0, min(total_labels, total_labels - used_labels))

        logger.info(
            "RFID parsed: Barcode=%s, Dimensions=%dx%dmm, Labels=%d/%d (Used=%d)",
            barcode, dim["width_mm"], dim["height_mm"], remaining_labels, total_display, used_labels
        )

        return {
            "success": True,
            "tag_present": True,
            "mac_address": mac,
            "uuid": tag_uuid,
            "barcode": barcode,
            "serial": serial,
            "total_labels": total_display,
            "used_labels": used_labels,
            "remaining_labels": remaining_labels,
            "consumables_type": consumables_type,
            "width_mm": dim["width_mm"],
            "height_mm": dim["height_mm"],
            "is_rotated": dim["is_rotated"],
            "preset_name": f"Pre-cut: Niimbot {dim['width_mm']}x{dim['height_mm']}mm",
        }
    except Exception as e:
        logger.exception("Error querying RFID on printer %s: %s", mac, e)
        return {"success": False, "error": str(e)}


async def get_niimbot_battery(mac: str) -> dict:
    """Query current battery level from a Niimbot BLE printer."""
    from bleak import BleakClient
    NIIM_CHAR_UUID = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"

    logger.info("Reading battery level from printer at %s...", mac)
    resp_bytes = bytearray()
    event = asyncio.Event()

    def on_notify(sender, data: bytearray):
        resp_bytes.extend(data)
        if len(resp_bytes) >= 7 and resp_bytes[-2:] == b"\xaa\xaa":
            event.set()

    try:
        async with BleakClient(mac, timeout=8.0) as client:
            if not client.is_connected:
                return {"success": False, "error": f"Could not connect to {mac}"}

            target_char = None
            for service in client.services:
                for char in service.characteristics:
                    if NIIM_CHAR_UUID in char.uuid.lower():
                        target_char = char
                        break
                if target_char:
                    break
            if not target_char:
                target_char = NIIM_CHAR_UUID

            await client.start_notify(target_char, on_notify)
            # Query battery info (type 64: GET_INFO, payload [10]: BATTERY)
            pkt = make_niimbot_packet(64, bytes([10]))
            await client.write_gatt_char(target_char, pkt, response=False)

            try:
                await asyncio.wait_for(event.wait(), timeout=4.0)
            except asyncio.TimeoutError:
                return {"success": False, "error": "Printer did not respond to battery query"}
            finally:
                try:
                    await client.stop_notify(target_char)
                except Exception:
                    pass

        if len(resp_bytes) >= 7 and resp_bytes[2] in (65, 74):
            payload_len = resp_bytes[3]
            payload = resp_bytes[4 : 4 + payload_len]
            if payload:
                raw_val = payload[0]
                battery_pct = raw_val * 25 if raw_val <= 4 else min(100, raw_val)
                logger.info("Battery level for %s: %d%% (raw=%d)", mac, battery_pct, raw_val)
                return {"success": True, "battery_level": battery_pct}

        return {"success": False, "error": "Invalid battery packet received"}
    except Exception as e:
        logger.exception("Error querying battery on printer %s: %s", mac, e)
        return {"success": False, "error": str(e)}


# --- Niimbot BLE Protocol Printing ---
def make_niimbot_packet(type_: int, data: bytes = b"") -> bytes:
    checksum = type_ ^ len(data)
    for b in data:
        checksum ^= b
    return bytes((0x55, 0x55, type_, len(data), *data, checksum, 0xAA, 0xAA))


def count_pixels_for_bitmap(
    line_data: bytes, printhead_pixels: int = 96
) -> Tuple[int, Tuple[int, int, int], bytes]:
    chunk_size = max(1, printhead_pixels // 8 // 3)
    total = 0
    parts = [0, 0, 0]
    indices = []

    for byte_idx, b in enumerate(line_data):
        if b == 0:
            continue
        chunk_idx = min(2, byte_idx // chunk_size)
        for bit in range(8):
            if b & (1 << (7 - bit)):
                total += 1
                parts[chunk_idx] += 1
                pixel_idx = byte_idx * 8 + bit
                indices.extend([(pixel_idx >> 8) & 0xFF, pixel_idx & 0xFF])

    return total, (min(255, parts[0]), min(255, parts[1]), min(255, parts[2])), bytes(indices)


async def print_niimbot_ble(mac: str, pil_images: List[any], progress_cb=None):
    from bleak import BleakClient
    from PIL import Image

    NIIM_WRITE_UUID = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"

    logger.info("Connecting to Niimbot printer at %s...", mac)
    if progress_cb:
        await progress_cb(10, "Connecting to printer...")

    async with BleakClient(mac, timeout=12.0) as client:
        if not client.is_connected:
            raise RuntimeError(f"Could not connect to printer at {mac}")

        # Known Niimbot write characteristics (standard combined UUID or ISSC transparent UART)
        KNOWN_WRITE_UUIDS = [
            "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
            "49535343-8841-43f4-a8d4-ecbe34729bb3",
            "0000fe01-0000-1000-8000-00805f9b34fb",
        ]

        target_char = None
        # 1. Search for known Niimbot vendor characteristics
        for service in client.services:
            for char in service.characteristics:
                uuid_str = str(char.uuid).lower()
                if any(known in uuid_str for known in KNOWN_WRITE_UUIDS):
                    target_char = char
                    break
            if target_char:
                break

        # 2. Fallback: search vendor services (skip 0x1800 Generic Access and 0x180A Device Info)
        if not target_char:
            for service in client.services:
                svc_uuid = str(service.uuid).lower()
                if "1800" in svc_uuid or "1801" in svc_uuid or "180a" in svc_uuid:
                    continue
                for char in service.characteristics:
                    props = char.properties
                    if "write-without-response" in props or "write" in props:
                        target_char = char
                        break
                if target_char:
                    break

        if not target_char:
            target_char = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"

        logger.info("Using BLE characteristic for Niimbot print: %s", getattr(target_char, "uuid", target_char))

        use_response = False
        if hasattr(target_char, "properties"):
            if "write-without-response" not in target_char.properties and "write" in target_char.properties:
                use_response = True

        # Helper to send packet
        async def send(type_: int, data: bytes = b""):
            pkt = make_niimbot_packet(type_, data)
            await client.write_gatt_char(target_char, pkt, response=use_response)
            await asyncio.sleep(0.015)

        logger.info("Sending print initialization packets for Niimbot (D110_M / B1 protocol)...")
        if progress_cb:
            await progress_cb(20, "Initializing print session...")

        # 1. Set label density (cmd 33: 0x03 = normal/high)
        await send(33, b"\x03")
        # 2. Set label type (cmd 35: 0x01 = gap label)
        await send(35, b"\x01")

        # 3. Start print session with 7-byte B1/D110_M payload:
        # [total_pages_hi, total_pages_lo, 0, 0, 0, 0, page_color=1]
        total_pages = len(pil_images)
        start_payload = struct.pack(">H4BB", total_pages, 0, 0, 0, 0, 1)
        await send(1, start_payload)

        for page_idx, raw_img in enumerate(pil_images):
            if progress_cb:
                pct = int(25 + (page_idx / total_pages) * 70)
                await progress_cb(pct, f"Printing label {page_idx + 1}/{total_pages}...")

            img = raw_img.copy()

            # If landscape label (width > height), rotate 90 degrees so width fits the physical printhead
            # D110 roll feeds lengthwise: width must match printhead (96px)
            if img.width > img.height:
                img = img.rotate(90, expand=True)

            # Ensure width is padded to multiple of 8
            remainder = img.width % 8
            if remainder != 0:
                new_w = img.width + (8 - remainder)
                padded = Image.new("RGB", (new_w, img.height), "white")
                padded.paste(img, (0, 0))
                img = padded

            # Convert to grayscale and build packed 1-bit line buffers (0=black, 255=white in PIL 'L')
            gray = img.convert("L")
            width, height = gray.size
            width_bytes = (width + 7) // 8
            pixels = gray.load()

            packed_rows = []
            for y in range(height):
                row_bytes = bytearray(width_bytes)
                for x in range(width):
                    # In grayscale 'L', values < 128 are dark/black pixels
                    if pixels[x, y] < 128:
                        row_bytes[x // 8] |= (1 << (7 - (x % 8)))
                packed_rows.append(bytes(row_bytes))

            # Start page print: cmd 3 (1 byte 0x01)
            await send(3, b"\x01")

            # Set dimension for B1/D110_M: cmd 19 -> 6 bytes [height_hi, height_lo, width_hi, width_lo, copies_hi, copies_lo]
            await send(19, struct.pack(">HHH", height, width, 1))

            printhead_pixels = max(96, width)

            for y in range(height):
                line_data = packed_rows[y]
                total_black, parts, indices = count_pixels_for_bitmap(line_data, printhead_pixels)

                if total_black == 0:
                    # Empty row: cmd 132 (0x84), payload: [row_hi, row_lo, repeats]
                    await send(132, struct.pack(">HB", y, 1))
                elif total_black <= 6 and indices:
                    # Indexed row: cmd 131 (0x83), payload: [row_hi, row_lo, chunk0, chunk1, chunk2, repeats, indices...]
                    header = struct.pack(">HBBBB", y, parts[0], parts[1], parts[2], 1)
                    await send(131, header + indices)
                else:
                    # Bitmap row: cmd 133 (0x85) with 6-byte header
                    header = struct.pack(">HBBBB", y, parts[0], parts[1], parts[2], 1)
                    await send(133, header + line_data)

                if y % 16 == 0:
                    await asyncio.sleep(0.01)

            # End page print: cmd 227 (1 byte 0x01)
            await send(227, b"\x01")
            # Wait for physical thermal printing and paper feed to advance
            await asyncio.sleep(1.8)

        # End entire print session: cmd 243 (1 byte 0x01)
        await send(243, b"\x01")
        await asyncio.sleep(0.5)
        logger.info("Print job sent successfully.")
        if progress_cb:
            await progress_cb(100, "Done")


# --- WebSocket Handler ---
async def websocket_handler(websocket):
    global LATEST_SERVER_VERSION, LATEST_SERVER_URL
    CONNECTED_CLIENTS.add(websocket)
    cancel_auto_shutdown()
    logger.info("Browser tab connected via WebSocket (active tabs: %d)", len(CONNECTED_CLIENTS))
    update_tray_state()

    try:
        # Send greeting with version, platform, and log file location
        await websocket.send(json.dumps({
            "action": "ready",
            "version": VERSION,
            "build_type": BUILD_TYPE,
            "is_frozen": IS_FROZEN,
            "platform": platform.system(),
            "status": "connected",
            "log_file": str(LOG_FILE_PATH),
        }))

        async for raw_msg in websocket:
            try:
                data = json.loads(raw_msg)
            except Exception:
                continue

            action = data.get("action")
            if action == "client_hello":
                srv_ver = data.get("server_version")
                srv_url = data.get("server_url")
                if srv_url:
                    LATEST_SERVER_URL = srv_url
                if srv_ver:
                    LATEST_SERVER_VERSION = srv_ver
                update_avail = bool(srv_ver and srv_ver > VERSION)
                update_tray_state()
                await websocket.send(json.dumps({
                    "action": "hello_ack",
                    "version": VERSION,
                    "build_type": BUILD_TYPE,
                    "is_frozen": IS_FROZEN,
                    "update_available": update_avail,
                    "latest_version": srv_ver,
                    "log_file": str(LOG_FILE_PATH),
                }))

            elif action == "get_logs":
                await websocket.send(json.dumps({
                    "action": "logs_result",
                    "logs": list(LOG_BUFFER),
                    "log_file": str(LOG_FILE_PATH),
                }))

            elif action == "clear_logs":
                LOG_BUFFER.clear()
                await websocket.send(json.dumps({
                    "action": "logs_cleared",
                }))

            elif action == "check_update":
                srv_url = data.get("server_url", LATEST_SERVER_URL)
                has_up, new_v = check_server_update(srv_url)
                if has_up and new_v:
                    LATEST_SERVER_VERSION = new_v
                    update_tray_state()
                await websocket.send(json.dumps({
                    "action": "update_status",
                    "update_available": has_up,
                    "latest_version": new_v,
                    "current_version": VERSION,
                }))

            elif action == "self_update":
                srv_url = data.get("server_url", LATEST_SERVER_URL)
                logger.info("Self-update requested from browser tab via server %s", srv_url)
                await websocket.send(json.dumps({
                    "action": "self_update_progress",
                    "status": "downloading",
                }))
                ok, msg = perform_self_update(srv_url)
                await websocket.send(json.dumps({
                    "action": "self_update_result",
                    "success": ok,
                    "message": msg,
                }))

            elif action == "ping":
                await websocket.send(json.dumps({
                    "action": "pong",
                    "version": VERSION,
                    "build_type": BUILD_TYPE,
                    "is_frozen": IS_FROZEN,
                    "time": asyncio.get_event_loop().time()
                }))

            elif action == "get_info":
                await websocket.send(json.dumps({
                    "action": "info_result",
                    "version": VERSION,
                    "build_type": BUILD_TYPE,
                    "is_frozen": IS_FROZEN,
                    "platform": platform.system(),
                    "log_file": str(LOG_FILE_PATH),
                }))

            elif action == "scan":
                logger.info("Scan requested by browser tab.")
                devices = await scan_devices()
                await websocket.send(json.dumps({
                    "action": "scan_result",
                    "devices": devices,
                }))

            elif action == "get_rfid":
                mac = data.get("mac_address")
                logger.info("RFID query requested for printer %s", mac)
                if not mac:
                    await websocket.send(json.dumps({
                        "action": "rfid_result",
                        "success": False,
                        "error": "Missing mac_address",
                    }))
                    continue

                rfid_res = await get_niimbot_rfid(mac)
                await websocket.send(json.dumps({
                    "action": "rfid_result",
                    **rfid_res,
                }))

            elif action == "get_battery":
                mac = data.get("mac_address")
                logger.info("Battery query requested for printer %s", mac)
                if not mac:
                    await websocket.send(json.dumps({
                        "action": "battery_result",
                        "success": False,
                        "error": "Missing mac_address",
                    }))
                    continue

                bat_res = await get_niimbot_battery(mac)
                await websocket.send(json.dumps({
                    "action": "battery_result",
                    **bat_res,
                }))

            elif action == "print":
                mac = data.get("mac_address")
                images_b64 = data.get("images", [])
                logger.info("Print requested to %s (%d image(s))", mac, len(images_b64))

                if not mac or not images_b64:
                    await websocket.send(json.dumps({
                        "action": "print_result",
                        "success": False,
                        "error": "Missing mac_address or images",
                    }))
                    continue

                from PIL import Image
                pil_images = []
                for b64 in images_b64:
                    data_str = b64.split(",", 1)[1] if "," in b64 else b64
                    decoded = base64.b64decode(data_str)
                    pil_images.append(Image.open(BytesIO(decoded)))

                async def progress_notifier(pct, status_text):
                    await websocket.send(json.dumps({
                        "action": "print_progress",
                        "progress": pct,
                        "status": status_text,
                    }))

                try:
                    await print_niimbot_ble(mac, pil_images, progress_notifier)
                    await websocket.send(json.dumps({
                        "action": "print_result",
                        "success": True,
                        "message": f"Successfully printed {len(pil_images)} label(s).",
                    }))
                except Exception as e:
                    logger.exception("Print failed on helper: %s", e)
                    await websocket.send(json.dumps({
                        "action": "print_result",
                        "success": False,
                        "error": str(e),
                    }))

    except Exception as e:
        logger.debug("Client connection closed: %s", e)
    finally:
        CONNECTED_CLIENTS.discard(websocket)
        logger.info("Browser tab disconnected (active tabs: %d)", len(CONNECTED_CLIENTS))
        update_tray_state()
        if not CONNECTED_CLIENTS:
            schedule_auto_shutdown()


async def main():
    import websockets

    # Register protocol handler on startup
    register_protocol_handler()

    # Launch desktop system tray icon thread (cross-platform, graceful fallback)
    start_system_tray_thread()

    # Start WebSocket server
    async with websockets.serve(websocket_handler, HOST, PORT):
        logger.info("==================================================")
        logger.info(" OpenNiimStudio Local Print Helper v%s", VERSION)
        logger.info(" Running on ws://%s:%d (%s mode)", HOST, PORT, BUILD_TYPE)
        logger.info(" Log file: %s", LOG_FILE_PATH)
        logger.info(" Auto-shutdown: Exits %ds after all tabs close.", int(AUTO_SHUTDOWN_GRACE_SEC))
        logger.info("==================================================")

        # Start initial grace timer in case launched without an open tab
        schedule_auto_shutdown()

        # Run until process termination
        await asyncio.Future()


if __name__ == "__main__":
    if "--register" in sys.argv:
        register_protocol_handler()
        print("Registration complete.")
        sys.exit(0)

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Terminated by user.")
        sys.exit(0)
