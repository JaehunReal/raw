#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export UV_CACHE_DIR="${UV_CACHE_DIR:-$PWD/.rulecraft/cache/uv}"
export npm_config_cache="${npm_config_cache:-$PWD/.rulecraft/cache/npm}"
uv sync --project backend --frozen
npm ci --no-fund --no-audit
npm ci --prefix frontend --no-fund --no-audit
npm run build --prefix frontend
npm run test:proxy
npm run test:official
uv run --project backend --frozen python -m unittest discover -s tests -v
