<div align="center">
  <img src="logo.webp" width="160" alt="CatLabel Logo">
  <h1>CatLabel Studio</h1>
  <p><strong>Self-hosted web studio for portable Bluetooth thermal printers</strong></p>

  <p>
    <a href="https://forgejo.syncedmedia.be/matieke/OpenNiimStudio/releases"><img src="https://img.shields.io/badge/version-v0.2.0-blue.svg" alt="Version 0.2.0"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg" alt="License"></a>
    <a href="https://forgejo.syncedmedia.be/matieke/OpenNiimStudio"><img src="https://img.shields.io/badge/docker%20package-forgejo%20registry-orange.svg" alt="Docker Package"></a>
  </p>
</div>

CatLabel Studio is a modern web application designed for creating, templating, and printing labels to portable Bluetooth thermal printers. 

Originally forked from [TiMini Print](https://github.com/Dejniel/TiMini-Print), CatLabel transforms the original desktop logic into a full-featured web studio built with **FastAPI**, **React 19**, and **Konva.js**, with native support for Niimbot, Phomemo, and generic thermal printers.

https://github.com/user-attachments/assets/d7103905-7133-41c0-b20b-ee69727d9418

---

## ✨ Key Features in v0.2

* 📦 **Pre-built Docker Container Package**: Deploy instantly on your server, NAS, or Raspberry Pi using our pre-built image from the Forgejo Container Registry (`forgejo.syncedmedia.be/matieke/openniimstudio:latest`). No Git clone or local compilation required.
* 📶 **Dual Bluetooth Architecture**:
  * **Direct Web Bluetooth**: Connect straight from Chrome, Edge, or Android browsers with zero desktop software or drivers installed.
  * **Local Print Helper (`catlabel-helper.py`)**: A lightweight background companion for Firefox, desktop Linux, or non-HTTPS remote server connections. Features automatic `catlabel://start` URL protocol handling and a 15-second idle auto-shutdown.
* 🎯 **Strict Device Filtering**: Eliminates unwanted smart TVs, refrigerators, computers, and audio gadgets from Bluetooth scans—only verified thermal printers appear.
* 🏷️ **Hardware RFID Roll Auto-Detection**: Real-time Niimbot RFID tag scanning. Automatically identifies the inserted roll barcode (e.g. 12x40mm), sets optimal landscape canvas dimensions, and tracks remaining label counts.
* 🎨 **Hybrid Canvas & HTML/CSS Templating**: Combine visual drag-and-drop elements with flexible HTML/CSS layouts, dynamic `.auto-text` scaling, and thermal-tuned image dithering.
* 🔢 **Variables & Batch Generation**: Print sequences (`BOX-001`), variable permutations, or bulk datasets imported directly from CSV spreadsheets.
* 🤖 **AI Layout Assistant**: Integrated conversational AI assistant compatible with OpenAI, Google Gemini, Anthropic Claude, and local LLMs (Ollama / LM Studio).

---

## 🖨️ Supported Printers

CatLabel communicates directly over Bluetooth Low Energy (BLE) and classic Bluetooth SPP:

* **Niimbot:** D-Series (D11, D110, D101), B-Series (B1, B21, B3S, B24, B18) with hardware RFID roll decoding.
* **Phomemo:** M-Series (M02, M03, M04, M110, M200, M220), D-Series (D30), T02, P12, PM-241.
* **Generic Thermal:** Over 130 source-backed model records across Tiny/Tiny-prefixed, Luck (including PPA2L/PPA2LH), V5G/V5X/V5C, Eleph HPRT ESC, Eleph TSPL, Instaprint Core, and Funny LX families.

---

## 🚀 Quick Start & Deployment

### 1. Docker Container (Recommended for Servers & Self-Hosting)

You do **not** need Git or source code on your server. Run CatLabel directly from the published container package:

#### Standalone `docker-compose.yml`:
Create a folder on your server and save this `docker-compose.yml`:

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
    environment:
      - PYTHONUNBUFFERED=1

volumes:
  catlabel_data:
    name: catlabel_data
```

Start the container:
```bash
docker compose up -d
```

Open `http://your-server-ip:8000` in your browser. All your saved designs, custom fonts, and SQLite database are permanently stored in the `catlabel_data` volume.

#### Updating to New Releases:
Because the package uses `:latest` with `pull_policy: always`, updating takes just two commands:
```bash
docker compose pull
docker compose up -d
```

---

### 2. Standalone Windows Launcher

1. Download `CatLabel-Launcher.exe` from the [Releases](https://forgejo.syncedmedia.be/matieke/OpenNiimStudio/releases) page.
2. Place it in a folder where you want the application to reside.
3. Double-click the executable. It sets up an isolated environment and opens your browser.

---

### 3. Native Linux & macOS

1. Clone the repository:
   ```bash
   git clone https://forgejo.syncedmedia.be/matieke/OpenNiimStudio.git catlabel
   cd catlabel
   ```
2. Run the bootstrap script:
   ```bash
   chmod +x run.sh && ./run.sh
   ```
3. Open `http://localhost:8000` in your browser.

---

## 🔌 Connecting Printers: How Bluetooth Works

CatLabel offers two ways to connect your printers depending on your environment:

### Method A: Direct Web Bluetooth (Zero Software)
* **Best for**: Laptops, Chromebooks, and Android devices running Chrome or Edge.
* **Requirements**: Must be accessed either on `http://localhost:8000` or through a secure **HTTPS** domain (e.g. behind Caddy, Nginx Proxy Manager, or Cloudflare).
* **How to use**: Select **Web Bluetooth (Direct)** from the printer dropdown and click **Connect**.

### Method B: Local Print Helper (`catlabel-helper.py`)
* **Best for**: Connecting to a self-hosted CatLabel server over plain HTTP, Firefox users, or Linux desktops.
* **How it works**: A lightweight Python script runs on your personal workstation and manages the local Bluetooth antenna, relaying print jobs from the web browser over `ws://127.0.0.1:9123`.
* **Running the helper**:
  ```bash
  python3 catlabel/bridge/helper.py
  # or download the standalone catlabel-helper.py from Releases
  ```
* **Smart Auto-Shutdown**: The helper automatically exits 15 seconds after you close your CatLabel browser tab to keep system resources free.

---

## 📖 User Guide & Canvas Studio

### 1. Canvas Editor (WYSIWYG)
* **Millimeter Precision**: Click and drag horizontally on X/Y and dimension labels (where you see `⇹`) to smoothly scrub values.
* **Default Landscape View**: Labels automatically open in natural landscape orientation for intuitive editing.
* **Icons & Thermal Dithering**: Search from hundreds of built-in Lucide icons. Uploaded images are automatically thresholded and dithered for thermal print heads.
* **Z-Ordering & Grouping**: Select multiple elements (`Shift + Click`) to group, align, or scale them together.

### 2. Hardware RFID Roll Detection
Niimbot printers with RFID readers communicate roll status directly to CatLabel:
* When a printer connects, the app reads the roll's hardware RFID chip.
* CatLabel automatically sets canvas dimensions (e.g. `40x12mm`) to match the installed paper.
* The sidebar displays the detected roll name, barcode ID, and the exact count of remaining labels (e.g., `142 / 160 left`).
* Click **Re-read** anytime you swap rolls without disconnecting.

### 3. Hybrid HTML & CSS Designing
For complex layouts (like shipping labels or split columns), each label can include an HTML/CSS background layered with visual canvas elements.
* **Auto-Scaling Text**: Wrap text in an `.auto-text` container inside a `.bound-box` to have CatLabel dynamically calculate the largest font size that fits without overflowing:
  ```html
  <div style="display: flex; flex-direction: column; height: 100%; padding: 4px;">
    <div class="bound-box" style="flex: 2;">
      <div class="auto-text" style="font-weight: 900;">{{ product_name }}</div>
    </div>
    <div class="bound-box" style="flex: 1;">
      <div class="catlabel-code" data-type="barcode" data-format="code128" data-value="{{ sku }}"></div>
    </div>
  </div>
  ```

### 4. Variables & Batch Printing
1. Insert `{{ variable_name }}` into any text, barcode, or HTML block.
2. Open the **Batch Data** tab to populate values:
   * **Table / CSV**: Import rows from spreadsheets.
   * **Permutations**: Generate every combination of attributes (e.g., Size: S, M, L × Color: Blue, Green).
   * **Sequences**: Produce serialized batches (e.g., `SN-001` through `SN-250`).

### 5. AI Layout Assistant
Chat with an AI assistant to generate label templates from natural language descriptions:
* **Live API**: Use your own API key for Google Gemini, OpenAI, Anthropic Claude, or local OpenAI-compatible hosts (Ollama / LM Studio at `http://localhost:1234/v1`).
* **Copy/Paste Prompt Mode**: Generate system prompt blocks to paste into web chats (like ChatGPT Plus or Claude Pro) without spending API credits.

---

## 🏗️ Architecture

```
CatLabel Studio
├── catlabel/
│   ├── api/          # FastAPI web routes, static files, REST endpoints
│   ├── bridge/       # Companion print helper daemon & protocol handler
│   ├── core/         # SQLite models, device configuration & engine
│   ├── services/     # Layout rendering, font management & PDF rasterization
│   └── vendors/      # Printer drivers (Niimbot, Phomemo, Generic V5/Luck/TSPL)
└── frontend/
    ├── src/          # React 19 + Zustand + Konva visual canvas
    ├── src/utils/    # Web Bluetooth, Companion bridge, client storage & tests
    └── dist/         # Production-built web assets bundled into container
```

---

## 📄 License & Attribution

This project is licensed under the **Apache License 2.0**.

* Based on [TiMini Print](https://github.com/Dejniel/TiMini-Print) by Dejniel. The original reverse-engineering of V5/Generic printer protocols and core encoding logic belong to the original author.
* Niimbot BLE protocol support powered by reverse engineering research and [NiimBlueLib](https://github.com/MultiMote/niimbluelib).
