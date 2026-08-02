#!/bin/bash

set -e

echo "[Ollama Setup] Starting automated installation..."

# Install required packages
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y \
    curl \
    zstd \
    procps \
    ca-certificates

# Install Ollama if missing
if ! command -v ollama >/dev/null 2>&1; then
    echo "[Ollama Setup] Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "[Ollama Setup] Ollama already installed."
fi

# Kill old Ollama instances if stuck
if pgrep -x "ollama" >/dev/null 2>&1; then
    echo "[Ollama Setup] Existing Ollama process detected."
else
    echo "[Ollama Setup] Starting Ollama server..."

    nohup ollama serve \
        > /var/log/ollama.log \
        2>&1 &

    # Wait until API responds
    echo "[Ollama Setup] Waiting for Ollama API..."

    for i in {1..30}; do
        if curl -s http://127.0.0.1:11434 >/dev/null; then
            echo "[Ollama Setup] Ollama is online."
            break
        fi

        sleep 2
    done
fi

# Pull lightweight model automatically if none exists
if ! ollama list | grep -q "llama3"; then
    echo "[Ollama Setup] Downloading llama3 model..."
    ollama pull llama3
else
    echo "[Ollama Setup] llama3 already downloaded."
fi

echo ""
echo "======================================"
echo " Ollama installation complete"
echo "======================================"
echo ""
echo "API Endpoint:"
echo "  http://127.0.0.1:11434"
echo ""
echo "Run model:"
echo "  ollama run llama3"
echo ""
echo "View logs:"
echo "  tail -f /var/log/ollama.log"
echo ""
echo "Check running process:"
echo "  pgrep -a ollama"
echo ""
