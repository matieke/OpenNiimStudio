# OpenNiimStudio

OpenNiimStudio is an open-source, self-hosted web app for designing and printing labels on portable Bluetooth thermal printers (Niimbot, Phomemo, and generic thermal labelers).

It started as a web-focused fork of [TiMini Print](https://github.com/Dejniel/TiMini-Print). Instead of running a Tkinter desktop GUI, OpenNiimStudio runs a FastAPI backend with a modern React canvas editor in your browser, backed by a reverse-engineered Niimbot BLE print engine.

---

## What's New in 0.3

- **Canvas Splitting (Grid & Cut Lines)**: Print multiple small labels or sub-tags on a single physical sticker roll. Split your label into grids (e.g. 1×2, 2×2, 3×1), see exact millimeter sub-cell dimensions in real time, replicate elements across cells, and print optional dashed or solid cut lines.
- **Niimbot D110_M & B1-Family Printing Engine**: Fully resolved protocol differences for newer D110_M, D110, and B1-series printers (7-byte job headers, 6-byte dimension packets, bitmap row chunking, and automatic 90° orientation so landscape canvases feed lengthwise).
- **First-Time Setup Wizard**: Automatically detects your browser's Bluetooth capabilities on first launch. Offers instant 1-click Web Bluetooth pairing on Chrome/Edge, or provides the lightweight `openniim-helper.py` companion for Firefox and Safari.
- **Full Rebrand to OpenNiimStudio**: Updated companion protocol (`openniim://start`), helper script (`openniim-helper.py`), and prebuilt container images (`openniimstudio:0.3` and `openniimstudio:latest`).
- **Automated Docker CI/CD**: Automated Forgejo Actions workflow that builds multi-arch containers and tags both the release version and `:latest` whenever a git tag is pushed.

---

## Canvas Splitting: Multiple Labels per Sticker

If you use standard continuous rolls or pre-cut labels (like 40×12 mm or 50×30 mm), you don't need to waste an entire sticker for a tiny serial number or cable tag:

1. In the right-hand **Canvas** panel, find **Canvas Split**.
2. Select your grid size: **1×2**, **2×1**, **2×2**, **3×1**, or custom rows and columns up to 6×6.
3. The editor automatically computes the usable area for each sub-section in millimeters (e.g. a 40×12 mm label split 2×1 gives two 20.0 × 12.0 mm sections).
4. **Alignment Guides & Cut Lines**: Turn on on-screen alignment guides while designing, and optionally enable printable cut lines (**solid** or **dashed**) so you know exactly where to snip with scissors after printing.
5. **Replicate Section**: Design your first sub-cell, then hit "Replicate Section" to clone all elements across the entire grid automatically.
6. **Batch Variable Support**: When batch printing from CSV or sequences, variables can populate individual sub-cells so each cut label gets unique data.

---

## Supported Printers

OpenNiimStudio communicates over Bluetooth Low Energy (BLE) and classic Bluetooth SPP:

- **Niimbot**:
  - D-series: D11, D110, D110_M, D101
  - B-series: B1, B21, B3S, B24, B18, B203
  - Automatic RFID roll detection (reads label dimensions, barcode, and remaining count)
- **Phomemo**:
  - M-series (M02, M03, M04, M110, M200, M220)
  - D30, T02, P12, PM-241
- **Generic thermal printers**:
  - Over 130 portable printer models using common protocols (V5G, V5X, Luck, Eleph TSPL/ESC, Instaprint, Funny LX)

---

## Quick Start

### Option 1: Docker (Recommended for Servers & NAS)

You don't need Python or Node installed on your server. You can pull the prebuilt image directly from the Forgejo container registry:

1. Create a `docker-compose.yml` file:

```yaml
services:
  openniimstudio:
    image: forgejo.syncedmedia.be/matieke/openniimstudio:latest
    pull_policy: always
    container_name: openniimstudio
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - openniimstudio_data:/app/data
    environment:
      - PYTHONUNBUFFERED=1

volumes:
  openniimstudio_data:
    name: catlabel_data # Preserves existing data volumes seamlessly
```

2. Start the service:
```bash
docker compose up -d
```

3. Open `http://your-server-ip:8000` in your browser.

To update to new releases in the future:
```bash
docker compose pull && docker compose up -d
```

---

### Option 2: Linux & macOS (Run from Source)

```bash
git clone https://forgejo.syncedmedia.be/matieke/OpenNiimStudio.git
cd OpenNiimStudio
chmod +x run.sh && ./run.sh
```

Then visit `http://localhost:8000`.

---

## How Bluetooth Printing Works

Browsers have strict security policies for hardware access. OpenNiimStudio gives you two clean options depending on your setup:

### 1. Direct Web Bluetooth (Zero Install)
- **Supported Browsers**: Google Chrome, Microsoft Edge, Brave, Opera, Chrome for Android.
- **Requirement**: The app must be opened on `localhost` or served over **HTTPS** (e.g. behind Nginx Proxy Manager, Traefik, Caddy, or Cloudflare). Browsers disable Web Bluetooth over unencrypted remote HTTP.
- **Usage**: Click **Connect Browser Bluetooth** in the sidebar. Select your printer in the browser popup and pair. No background services needed.

### 2. Local Print Helper (`openniim-helper.py`)
- **Supported Browsers**: Mozilla Firefox, Apple Safari, or any browser accessing OpenNiimStudio over plain HTTP (`http://192.168.x.x:8000`).
- **How it works**: A tiny Python script runs locally on your computer, connects to your printer via your system's Bluetooth adapter, and bridges commands to the web app over a local WebSocket (`ws://127.0.0.1:9123`).
- **Auto-Shutdown**: When you close all OpenNiimStudio browser tabs, the helper automatically exits after 15 seconds.
- **Launch via Protocol**: On first run, the helper registers `openniim://start` with your OS so future launches happen automatically from the web UI.

To start the helper manually:
```bash
python3 openniim-helper.py
# or from repo:
python3 catlabel/bridge/helper.py
```

---

## Key Features

### Visual Canvas & Positioning
- **Scrubbable Inputs**: Type exact millimeter dimensions, or click and drag horizontally across inputs marked with `⇹` to scrub values smoothly.
- **Custom Font Uploads**: Upload TTF or OTF fonts directly in the UI. Fonts persist in your server data volume and render cleanly on all clients.
- **Dithering & Image Optimization**: Uploaded images and logos are converted to 1-bit monochrome using Floyd-Steinberg dithering optimized for thermal printheads.

### Niimbot RFID Roll Detection
- When you connect to an RFID-enabled Niimbot printer, OpenNiimStudio automatically reads the roll RFID tag.
- The canvas adapts to the exact roll dimensions (e.g. `40×12 mm`), loads the proper landscape layout, and displays the paper type and remaining label count in the sidebar.
- If you swap paper rolls, click **Re-read** in the sidebar.

### Dynamic Batch Printing & Sequences
- Import data from CSV files.
- Use `{{ variable_name }}` syntax inside text boxes, HTML blocks, QR codes, or barcodes.
- Generate automatic number/date sequences (e.g. `SN-2026-0001` through `SN-2026-0500`).
- Print preview cycles through every record before sending the job to the printer.

### AI Layout Assistant
- **Live Agent Mode**: Connect OpenAI, Google Gemini, Anthropic Claude, or local inference (Ollama, LM Studio) via LiteLLM.
- **External Copy/Paste Mode**: If you prefer using your existing ChatGPT Plus or Claude Pro subscription, generate prompt bundles with canvas previews, paste them into your chat, and paste the JSON tool calls back into OpenNiimStudio.

---

## Docker Automation & CI/CD

OpenNiimStudio includes an automated Forgejo Actions workflow (`.forgejo/workflows/docker-publish.yml`).

### How Tagging & Container Builds Work

Whenever you push a git tag to Forgejo, the workflow automatically:
1. Triggers on tag creation (`refs/tags/*`).
2. Checks out the source and sets up Docker Buildx.
3. Builds the production image with multi-stage caching.
4. Tags the image with both the version tag (e.g. `:0.3`) and `:latest`.
5. Pushes the images to `forgejo.syncedmedia.be/matieke/openniimstudio`.

### Creating a New Release

To release a new version from your terminal:

```bash
# 1. Commit your changes
git add .
git commit -m "feat: release version 0.3"

# 2. Create an annotated git tag
git tag -a 0.3 -m "Release 0.3: Canvas splitting, D110_M print engine, and OpenNiimStudio rebrand"

# 3. Push commits and tags to Forgejo
git push forgejo master --tags
```

Once pushed, Forgejo Actions handles the container build and publishing automatically.

---

## Architecture

- **Frontend**: React 19 single-page app (`frontend/`) using Konva (`react-konva`) for 2D rendering, Lucide icons, and Zustand for state management.
- **Backend**: FastAPI server (`catlabel/`) managing SQLite storage, PDF rendering, raster pipelines, and printer communication.
- **Companion**: Bleak & websockets daemon (`catlabel/bridge/helper.py`) providing local client-side Bluetooth relaying.

---

## License & Acknowledgements

OpenNiimStudio is licensed under the **Apache License 2.0**.

- Forked from [TiMini Print](https://github.com/Dejniel/TiMini-Print) by Dejniel.
- Niimbot BLE reverse engineering based on research from [NiimBlueLib](https://github.com/MultiMote/niimbluelib).
