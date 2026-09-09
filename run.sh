#!/bin/bash

set -e

trap 'echo -e "\n=======================================================\nERROR: A critical error occurred during the setup on line $LINENO.\nPlease review the output above to see what went wrong.\n======================================================="; exit 1' ERR

# 1. Explicitly set the root prefix to keep the installation portable
export MAMBA_ROOT_PREFIX="$(pwd)/data/mamba_root"

mkdir -p data

hash_file() {
    local file_path="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file_path" | awk '{print $1}'
    else
        shasum -a 256 "$file_path" | awk '{print $1}'
    fi
}

REQUIREMENTS_HASH_FILE="data/.requirements.sha256"
current_requirements_hash="$(hash_file requirements.txt)"
saved_requirements_hash=""

if [ -f "$REQUIREMENTS_HASH_FILE" ]; then
    saved_requirements_hash="$(cat "$REQUIREMENTS_HASH_FILE")"
fi

echo "=== CatLabel Bootstrapper ==="

if [ ! -d "env" ]; then
    echo "[1/3] Environment not found. Starting installation..."
    
    mkdir -p bin data
    if [ ! -f "bin/micromamba" ]; then
        echo "      Downloading standalone Micromamba..."
        OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
        if [ "$OS" = "darwin" ]; then OS="osx"; fi
        ARCH="$(uname -m)"
        if [ "$ARCH" = "x86_64" ]; then ARCH="64"; fi
        if [ "$ARCH" = "aarch64" ]; then ARCH="aarch64"; fi
        if [ "$ARCH" = "arm64" ]; then ARCH="arm64"; fi
        
        # Download and extract just the binary directly into ./bin/
        curl -Ls "https://micro.mamba.pm/api/micromamba/${OS}-${ARCH}/latest" | tar -xvj -C bin bin/micromamba --strip-components=1
        
        # Ensure it has execute permissions
        chmod +x bin/micromamba
    fi

    echo "[2/3] Creating isolated environment (Python 3.11)..."
    ./bin/micromamba create -p ./env -c conda-forge python=3.11 pip git -y

    echo "[3/3] Installing backend dependencies..."
    ./bin/micromamba run -p ./env python -m pip install -r requirements.txt

    echo ""
    echo "----------------------------------------------------------------------"
    echo "OPTIONAL: Headless Browser (Third-Party API Integrations)"
    echo "If you plan to send print jobs to CatLabel from external scripts via"
    echo "the API, you need Playwright (~150MB download). Normal UI usage does NOT."
    echo "Auto-skipping in 15 seconds if no input is provided."
    
    read -t 15 -p "Install Headless API support? [y/N]: " INSTALL_PLAYWRIGHT || true
    
    if [[ "$INSTALL_PLAYWRIGHT" =~ ^[Yy]$ ]]; then
        echo ""
        echo "      Installing Playwright and Headless Chromium..."
        ./bin/micromamba run -p ./env python -m pip install 'playwright>=1.40.0'
        export PLAYWRIGHT_BROWSERS_PATH=0
        ./bin/micromamba run -p ./env python -m playwright install chromium
    else
        echo ""
        echo "      Skipping Playwright installation."
    fi
    echo "----------------------------------------------------------------------"
    echo ""

    printf '%s' "$current_requirements_hash" > "$REQUIREMENTS_HASH_FILE"

    echo "Installation complete!"
    echo "-----------------------------------"
else
    needs_backend_refresh=0

    if [ -f ".update_needed" ]; then
        echo "[*] Update detected. Refreshing dependencies..."
        needs_backend_refresh=1
    else
        if [ "$current_requirements_hash" != "$saved_requirements_hash" ]; then
            echo "[*] Detected requirements.txt changes. Refreshing backend dependencies..."
            needs_backend_refresh=1
        fi
    fi

    if [ "$needs_backend_refresh" -eq 1 ]; then
        ./bin/micromamba run -p ./env python -m pip install -r requirements.txt
        printf '%s' "$current_requirements_hash" > "$REQUIREMENTS_HASH_FILE"
    else
        echo "[*] Fast booting. Dependencies are up to date."
    fi

    rm -f .update_needed
fi

echo "Starting CatLabel Server (http://localhost:8000)..."
./bin/micromamba run -p ./env python -m catlabel
