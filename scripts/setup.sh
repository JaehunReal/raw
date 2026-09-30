#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export UV_CACHE_DIR="${UV_CACHE_DIR:-/workspace/.cache/uv}"
export npm_config_cache="${npm_config_cache:-/workspace/.cache/npm}"
uv sync --project backend --frozen
npm ci --prefix frontend --no-fund --no-audit
npm run build --prefix frontend
uv run --project backend python -m unittest discover -s tests -v
