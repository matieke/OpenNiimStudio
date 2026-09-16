# OpenNiimStudio

OpenNiimStudio is a self-hosted web studio for designing and printing labels directly to portable Bluetooth thermal printers. 

It pairs an in-browser visual canvas editor with reverse-engineered Bluetooth print engines, allowing you to design labels on your desktop, laptop, tablet, or phone and send jobs directly to Niimbot, Phomemo, and generic thermal label makers without relying on proprietary mobile apps or cloud services.

---

## Features

### Visual Label Designer
- **Millimeter-Accurate Canvas**: Design on continuous rolls or pre-cut label sizes. Switch between portrait and landscape modes with automatic printhead orientation.
- **Scrubbable Numeric Inputs**: Type exact millimeter dimensions, or click and drag horizontally across inputs marked with `⇹` to adjust values smoothly.
- **Custom Fonts**: Upload TTF and OTF font files directly through the web interface. Uploaded fonts persist on your server and render identically across all connected devices.
- **Barcode & QR Generation**: High-density QR codes and standard 1D barcodes (Code 128, EAN-13, UPC-A) rendered crisp and sharp for thermal heads.
- **Dithering Pipeline**: Built-in image thresholding and Floyd-Steinberg error diffusion dithering convert photos, graphics, and logos into clean 1-bit monochrome raster data.

### Canvas Splitting (Multi-Labels per Sticker)
- **Grid Sub-Sections**: Split a single physical label into grids (1×2, 2×1, 2×2, 3×1, or custom up to 6×6) to fit multiple small labels or cable markers on one sticker.
- **Live Dimension Calculations**: View the exact width and height of each sub-cell in millimeters in real time as you adjust the grid.
- **Section Replication**: Design an element in the first cell and replicate it across all remaining cells with a single click.
- **Printable Cut Lines**: Add optional dashed or solid cutting guides to your print job so you know exactly where to trim with scissors.

### Hardware & Roll Monitoring
- **Automatic RFID Roll Detection**: Connects to RFID-enabled Niimbot printers and immediately identifies the inserted label dimensions, barcode, and total roll capacity.
- **Live Sticker Counter**: Tracks remaining labels and automatically decrements the count after every print job, accompanied by background hardware verification.
- **Third-Party Paper Compatibility**: Fully compatible with non-RFID third-party label paper. The printer uses its built-in optical gap sensors to align labels normally while the interface lets you select dimensions manually from presets.
- **Battery Status Indicator**: Real-time printer battery gauge with automatic 1-minute polling so you always know your charge before printing large batches.

### Batch Printing & Sequences
- **CSV Data Import**: Upload spreadsheets to generate batches of product tags, shipping labels, or inventory badges.
- **Dynamic Placeholders**: Use `{{ variable_name }}` syntax inside text blocks, barcodes, or QR codes to populate fields per record.
- **Sequence Generator**: Automatically create numbered runs (e.g. `ASSET-0001` to `ASSET-0500`) and date-based serials with live print preview cycling.

### Declarative Templates
- Built-in customizable layouts for spice and apothecary jars, pantry containers, cable flags, retail price tags, asset management, and shipping badges.
- Adjust template fields (title, subtitle, dates, logos, codes) without manually arranging canvas coordinates.

### AI Layout Assistant
- Generate label designs using natural language prompts.
- **Direct Mode**: Connect Google Gemini, Anthropic Claude, OpenAI, or local models (Ollama, LM Studio) via LiteLLM.
- **Offline Copy/Paste Mode**: Generate structured prompt bundles with live canvas previews to use with web-based ChatGPT Plus or Claude Pro, then paste the generated tool calls back into the editor.

---

## Supported Printers

OpenNiimStudio communicates via Bluetooth Low Energy (BLE) and classic Bluetooth SPP:

### Niimbot
- **D-Series**: D11, D110, D110_M, D101
- **B-Series**: B1, B21, B3S, B24, B18, B203
- Supports automatic RFID roll reading, gap detection, continuous rolls, and non-RFID third-party paper.

### Phomemo
- **M-Series**: M02, M03, M04, M110, M200, M220
- **Other Models**: D30, T02, P12, PM-241

### Generic Thermal Printers
- Over 130 portable printer models supported via common protocol implementations:
  - V5G / V5X
  - Luck / Luck A4
  - Eleph TSPL / ESC
  - Instaprint
  - Funny LX

---

## How Bluetooth Printing Works

Browsers enforce strict security boundaries for local hardware access. OpenNiimStudio provides two ways to connect depending on your browser and network environment:

```
┌────────────────────────────────────────────────────────┐
│               Your Browser (OpenNiimStudio)            │
└──────────────┬─────────────────────────┬───────────────┘
               │ (Chrome/Edge/HTTPS)     │ (Firefox/Safari/HTTP)
               ▼                         ▼
┌───────────────────────────┐  ┌───────────────────────────┐
│ Direct Web Bluetooth API  │  │ Local Print Helper Script │
│ (Zero install, 1-click)   │  │ (openniim-helper.py)      │
└──────────────┬────────────┘  └─────────────┬─────────────┘
               │                             │ ws://127.0.0.1:9123
               ▼                             ▼
       ┌─────────────────────────────────────────────┐
       │       Local Bluetooth Thermal Printer       │
       └─────────────────────────────────────────────┘
```

### 1. Direct Web Bluetooth (Zero Installation)
- **Supported Browsers**: Google Chrome, Microsoft Edge, Brave, Opera, Chrome for Android, and Bluefy (iOS).
- **Requirements**: Served over `localhost` or **HTTPS** (Web Bluetooth is disabled by browsers over unencrypted remote HTTP).
- **How to use**: Click **Connect Browser Bluetooth** in the sidebar, choose your printer from the native browser prompt, and print directly. No local software needed.

### 2. Local Print Helper (`openniim-helper.py`)
- **Supported Browsers**: Mozilla Firefox, Apple Safari, or any browser accessing OpenNiimStudio over local HTTP (e.g. `http://192.168.1.50:8000`).
- **How to use**: Download and run the lightweight companion script on your computer:
  ```bash
  python3 openniim-helper.py
  ```
- **How it works**: The script communicates with your printer using your operating system's native Bluetooth stack and relays commands to OpenNiimStudio over a local WebSocket (`ws://127.0.0.1:9123`).
- **Auto-Shutdown**: Automatically shuts down 15 seconds after you close all OpenNiimStudio browser tabs so it never lingers in the background.

---

## Installation & Deployment

### Docker Compose (Recommended)

Run OpenNiimStudio on a home server, Raspberry Pi, or NAS using the prebuilt container image:

```yaml
services:
  openniimstudio:
    image: forgejo.syncedmedia.be/matieke/openniimstudio:latest
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
    # Preserves existing CatLabel data volumes if upgrading:
    name: catlabel_data
```

Start the container:
```bash
docker compose up -d
```

Open `http://localhost:8000` (or your server's IP address) in your browser.

To pull updates:
```bash
docker compose pull && docker compose up -d
```

---

### Running from Source

Requirements: Python 3.10+ and Node.js 18+ (if building the frontend).

```bash
git clone https://forgejo.syncedmedia.be/matieke/OpenNiimStudio.git
cd OpenNiimStudio

# Make run script executable and start backend
chmod +x run.sh
./run.sh
```

The application will be accessible at `http://localhost:8000`.

---

## Automated Releases & Container Builds

OpenNiimStudio uses a Forgejo Actions workflow (`.forgejo/workflows/docker-publish.yml`) to automate image publishing.

Whenever a git tag is created and pushed, the runner:
1. Builds a multi-stage, pruned production image.
2. Tags the image with both the release version (e.g. `:0.3`) and `:latest`.
3. Pushes the artifacts to the container registry (`forgejo.syncedmedia.be/matieke/openniimstudio`).

To publish a release:
```bash
git add .
git commit -m "Release version 0.3.2"
git tag -a 0.3.2 -m "Release 0.3.2"
git push forgejo master --tags
```

---

## Architecture

- **Frontend**: Single-page application built with React 19, Konva (`react-konva`) for interactive canvas manipulation, Lucide icons, and Zustand for state management.
- **Backend**: FastAPI server (`catlabel/`) handling local SQLite persistence, thermal print rasterization, PDF rendering, and server-side Bluetooth relays.
- **Companion**: Standalone Python daemon (`catlabel/bridge/helper.py`) utilizing Bleak and websockets for non-Web Bluetooth client environments.

---

## License & Credits

OpenNiimStudio is open-source software licensed under the **Apache License 2.0**.

- Forked originally from [TiMini Print](https://github.com/Dejniel/TiMini-Print) by Dejniel.
- Reverse engineering of Niimbot protocols is built upon research from [NiimBlueLib](https://github.com/MultiMote/niimbluelib).
