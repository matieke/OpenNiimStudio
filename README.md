# CatLabel Studio

CatLabel Studio is a self-hosted web app for designing and printing labels on portable Bluetooth thermal printers (like Niimbot, Phomemo, and various generic portable printers).

It started as a web-focused fork of [TiMini Print](https://github.com/Dejniel/TiMini-Print). Instead of running a Tkinter desktop GUI, it runs a local FastAPI backend with a React canvas editor in your browser, with added support for Niimbot BLE printers.

https://github.com/user-attachments/assets/d7103905-7133-41c0-b20b-ee69727d9418

---

## What's New in 0.2

- **Prebuilt Docker package**: You don't need Git or Python on your server. You can pull the ready-to-run image directly from the Forgejo container registry (`forgejo.syncedmedia.be/matieke/openniimstudio:latest`).
- **Clean Bluetooth scanning**: The device picker filters out random non-printer Bluetooth devices nearby (no more smart TVs, fridges, or headphones cluttering the list).
- **Niimbot RFID roll detection**: When connected to an RFID-equipped Niimbot printer (like the D110 or B-series), it reads the inserted paper roll, detects the dimensions (e.g. 12x40mm), automatically loads the preset in landscape view, and shows remaining labels.
- **Companion print helper (`catlabel-helper.py`)**: Web Bluetooth in browsers only works over HTTPS or on `localhost`. If you host CatLabel on a local server over plain HTTP, or if you use Firefox, you can run the small Python helper script locally. It handles the Bluetooth connection and talks to the web UI over a local WebSocket, then shuts itself down 15 seconds after you close the tab.

---

## Supported Printers

CatLabel communicates with thermal printers over Bluetooth Low Energy (BLE) and classic Bluetooth SPP:

- **Niimbot**: D-series (D11, D110, D101) and B-series (B1, B21, B3S, B24, B18) with RFID roll reading.
- **Phomemo**: M-series (M02, M03, M04, M110, M200, M220), D30, T02, P12, PM-241.
- **Generic thermal printers**: Over 130 models using common portable protocols (V5G, V5X, Luck, Eleph TSPL/ESC, Instaprint, Funny LX).

---

## Quick Start & Installation

### Option 1: Docker (Server / Self-Hosted)

If you're running this on a home server, VPS, or NAS, you don't need to clone the git repository.

1. Create a `docker-compose.yml` file:

```yaml
services:
  catlabel:
    image: forgejo.syncedmedia.be/matieke/openniimstudio:latest
    pull_policy: always
    container_name: catlabel
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - catlabel_data:/app/data

volumes:
  catlabel_data:
```

2. Start the container:
```bash
docker compose up -d
```

3. Open `http://your-server-ip:8000` in your browser.

Your saved projects, custom fonts, and settings stay saved inside the `catlabel_data` volume. To update to a newer build later, just run:
```bash
docker compose pull && docker compose up -d
```

---

### Option 2: Windows (Standalone Launcher)

1. Grab `CatLabel-Launcher.exe` from the [Releases](https://forgejo.syncedmedia.be/matieke/OpenNiimStudio/releases) page.
2. Put it in an empty folder and run it.
3. It downloads the required runtime into that folder and launches the app in your default browser.

---

### Option 3: Linux & macOS (From Source)

```bash
git clone https://forgejo.syncedmedia.be/matieke/OpenNiimStudio.git catlabel
cd catlabel
chmod +x run.sh && ./run.sh
```
Then visit `http://localhost:8000`.

---

## How Bluetooth Printing Works

Connecting Bluetooth devices from a web browser comes with a few browser security rules. CatLabel gives you two ways to handle it:

### 1. Direct Web Bluetooth (No extra software)
- **Works in**: Chrome, Edge, Brave, Opera, and Chrome for Android.
- **Requirement**: The app must either be running on `localhost` or served over **HTTPS** (e.g. through Nginx Proxy Manager, Caddy, or Cloudflare). Browsers completely disable the Web Bluetooth API on plain remote HTTP.
- **Usage**: Click the printer dropdown in the top bar, pick **Web Bluetooth (Direct)**, and pair your printer.

### 2. Local Print Helper (For Firefox, Linux, or plain HTTP setups)
- If your server is on `http://192.168.x.x:8000` without SSL, or if you use Firefox (which doesn't support Web Bluetooth), run the companion script on your computer:
  ```bash
  python3 catlabel/bridge/helper.py
  # or use the standalone catlabel-helper.py from the releases page
  ```
- The web app talks to this helper via `ws://127.0.0.1:9123`.
- When you close your CatLabel browser tabs, the helper automatically shuts down after 15 seconds so it doesn't hang around in the background.

---

## Features & Tips

### Visual Canvas
- **Sizing & Positioning**: Enter millimeter measurements in the right-hand panel, or click and drag horizontally across input labels (where you see `⇹`) to scrub values up and down.
- **Landscape by default**: New canvases open in landscape orientation so standard label rolls match how you read them.
- **Icons**: Search and drop icons from the built-in Lucide library.
- **Images**: Uploaded pictures are automatically dithered and converted to 1-bit monochrome so they print cleanly on thermal paper.

### RFID Paper Roll Detection
- For Niimbot printers with RFID readers, CatLabel automatically reads the roll tag on connection.
- The canvas switches to the detected roll size (like `40x12mm`), and the sidebar shows the roll barcode, paper type, and how many labels are left on the spool.
- If you switch rolls, click the **Re-read** button in the sidebar.

### HTML/CSS Templates & Dynamic Text
You can build layouts using regular drag-and-drop elements, or write custom HTML/CSS for advanced designs.
- Use `.bound-box` and `.auto-text` in custom HTML blocks: the text will automatically size itself to fill the box without overflowing or wrapping awkwardly.
- Use `{{ variable_name }}` syntax inside text elements, HTML blocks, or barcode values for dynamic templates.

### Batch Printing & Sequences
- In the **Batch Data** tab, you can import spreadsheet data via CSV, generate combinations/permutations, or generate numbered sequences (e.g. `INV-001` through `INV-100`).

### AI Layout Helper
- If you have an OpenAI, Gemini, or Claude API key, or a local model running in Ollama/LM Studio, the AI panel can generate label designs from natural language prompts.
- If you don't want to use API keys, you can use the prompt generator mode to copy the instructions into ChatGPT or Claude and paste the output JSON back in.

---

## Architecture

- **Backend**: FastAPI server (`catlabel/`) handling device communication, SQLite persistence, PDF rasterization, and printer protocols.
- **Frontend**: React 19 single-page app (`frontend/`) using Konva for the canvas and Zustand for state.
- **Helper**: Standalone Bleak/websockets daemon (`catlabel/bridge/helper.py`) for client-side Bluetooth relaying.

---

## License & Credits

Distributed under the **Apache License 2.0**.

- Forked from [TiMini Print](https://github.com/Dejniel/TiMini-Print) by Dejniel.
- Niimbot BLE packet structures and decoding based on research from [NiimBlueLib](https://github.com/MultiMote/niimbluelib).
