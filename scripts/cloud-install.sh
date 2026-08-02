#!/usr/bin/env bash
# One-time bootstrap on a fresh Ubuntu 22.04/24.04 VM (Oracle Always Free, etc.)
set -euo pipefail

echo "==> Installing Docker..."
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" || true

echo "==> Done. Log out and back in, then:"
echo "    git clone <your-repo> opensteam && cd opensteam"
echo "    cp .env.cloud.example .env   # fill in Neon + Discord + TUNNEL_TOKEN"
echo "    docker compose -f docker-compose.cloud.yml up -d --build"
echo "    docker compose -f docker-compose.cloud.yml logs -f bot"
