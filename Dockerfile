# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.12.19 AS uv
FROM python:3.12.14-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/backend \
    PATH=/app/backend/.venv/bin:$PATH \
    UV_PYTHON_DOWNLOADS=never \
    UV_NO_CACHE=1 \
    UV_LINK_MODE=copy \
    RULECRAFT_DEPLOYMENT=production \
    RULECRAFT_DATA_DIR=/var/data \
    RULECRAFT_VAULT=/var/data/vault \
    RULECRAFT_LAW_DIR=/var/data/national-law \
    RULECRAFT_PACKAGE_DIR=/var/data/packages \
    PORT=10000

WORKDIR /app
COPY --from=uv /uv /usr/local/bin/uv

# The optional combined CA bundle is mounted only during networked build steps.
# Render uses normal public CA trust; managed Codex builds supply proxy_ca.
RUN --mount=type=secret,id=proxy_ca \
    set -eu; \
    set --; \
    if [ -f /run/secrets/proxy_ca ]; then \
        set -- -o Acquire::https::CaInfo=/run/secrets/proxy_ca; \
    fi; \
    apt-get "$@" update; \
    apt-get "$@" install --no-install-recommends -y git ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid 10001 rulecraft; \
    useradd --uid 10001 --gid rulecraft --no-create-home --shell /usr/sbin/nologin rulecraft

COPY backend/pyproject.toml backend/uv.lock /app/backend/
RUN --mount=type=secret,id=proxy_ca \
    set -eu; \
    if [ -f /run/secrets/proxy_ca ]; then \
        export SSL_CERT_FILE=/run/secrets/proxy_ca; \
    fi; \
    uv sync --project /app/backend --frozen --no-dev --no-install-project

# Source is imported through PYTHONPATH, so project build dependencies cannot
# introduce an unlocked setuptools download. MCP uses this same Python env.
COPY backend/rulecraft /app/backend/rulecraft
COPY legal-knowledge-vault /app/seed-vault
COPY scripts/production-entrypoint.py /app/scripts/production-entrypoint.py

RUN mkdir -p /var/data && chown -R rulecraft:rulecraft /app /var/data
USER rulecraft

EXPOSE 10000
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/backend/.venv/bin/python", "/app/scripts/production-entrypoint.py"]
