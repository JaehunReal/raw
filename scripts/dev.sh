#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export UV_CACHE_DIR="${UV_CACHE_DIR:-$PWD/.rulecraft/cache/uv}"
export npm_config_cache="${npm_config_cache:-$PWD/.rulecraft/cache/npm}"
mkdir -p .rulecraft

# The supervisor owns separate server process groups. Terminal signals reach
# the supervisor; cleanup then stops its groups and reaps its direct children.
rulecraft_uv_options=(run --project backend --frozen --no-sync)
if [[ -f .env ]]; then
    rulecraft_uv_options+=(--env-file .env)
fi
exec uv "${rulecraft_uv_options[@]}" python - <<'PY'
from contextlib import ExitStack
import json
from pathlib import Path
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from urllib.error import URLError
from urllib.request import urlopen

root = Path.cwd()
children = []
shutdown = threading.Event()
exit_signal = 0


def request_shutdown(signum, frame):
    global exit_signal
    exit_signal = signum
    shutdown.set()


def stop_children():
    # All groups were created by this supervisor; never select processes by
    # their name or their port when choosing what to terminate.
    for process in children:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 6
    while any(process.poll() is None for process in children) and time.monotonic() < deadline:
        time.sleep(0.1)
    for process in children:
        # Also stop descendants that survived an already exited server.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)


def ready():
    try:
        with urlopen('http://127.0.0.1:8000/api/health', timeout=1) as response:
            if json.load(response).get('service') != 'rulecraft':
                return False
        with urlopen('http://127.0.0.1:5173/api/graph', timeout=1) as response:
            if not isinstance(json.load(response).get('nodes'), list):
                return False
        with urlopen('http://127.0.0.1:5173', timeout=1) as response:
            return b'RuleCraft' in response.read()
    except (OSError, URLError, ValueError):
        return False


def show_logs():
    for name in ('backend', 'frontend'):
        path = root / '.rulecraft' / f'{name}.log'
        if path.exists():
            print(path.read_text(errors='replace')[-10000:], file=sys.stderr, flush=True)


def main():
    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)
    if os.environ.get('RULECRAFT_API_TOKEN', '').strip() or os.environ.get('RULECRAFT_DEPLOYMENT', '').strip().lower() == 'production':
        print('Authenticated production settings detected. Use the backend-only command in docs/macmini-setup.md; the development frontend has no authenticated gateway.', file=sys.stderr)
        return 1
    for port in (8000, 5173):
        with socket.socket() as probe:
            # Ignore TIME_WAIT sockets left by the previous development run.
            # Active listeners still fail this bind check.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('127.0.0.1', port))
            except OSError:
                print(f'Port {port} is already in use. Check the existing service before starting RuleCraft.', file=sys.stderr)
                return 1
    with ExitStack() as files:
        try:
            backend_log = files.enter_context((root / '.rulecraft/backend.log').open('w'))
            frontend_log = files.enter_context((root / '.rulecraft/frontend.log').open('w'))
            children.append(subprocess.Popen(
                [str(root / 'backend/.venv/bin/python'), '-m', 'uvicorn', 'rulecraft.api:app',
                 '--host', '127.0.0.1', '--port', '8000', '--timeout-graceful-shutdown', '5'],
                cwd=root, stdout=backend_log, stderr=subprocess.STDOUT, start_new_session=True,
            ))
            children.append(subprocess.Popen(
                [str(root / 'frontend/node_modules/.bin/vite'), '--host', '0.0.0.0', '--port', '5173', '--strictPort'],
                cwd=root / 'frontend', stdout=frontend_log, stderr=subprocess.STDOUT, start_new_session=True,
                env={key: value for key, value in os.environ.items()
                     if not key.startswith('RULECRAFT_') and key not in {'VERCEL_TOKEN', 'RENDER_API_KEY'}},
            ))
            deadline = time.monotonic() + 30
            while not shutdown.is_set() and time.monotonic() < deadline:
                if any(process.poll() is not None for process in children):
                    show_logs()
                    return 1
                if ready():
                    print('RuleCraft ready: API, frontend, and proxied knowledge graph verified. Logs: .rulecraft/*.log', flush=True)
                    break
                shutdown.wait(0.25)
            else:
                if shutdown.is_set():
                    return 128 + exit_signal
                show_logs()
                return 1
            while not shutdown.wait(0.2):
                for process in children:
                    code = process.poll()
                    if code is not None:
                        return code if code >= 0 else 128 - code
            return 128 + exit_signal
        except OSError as error:
            print(f'RuleCraft startup failed: {error}', file=sys.stderr)
            return 1
        finally:
            # Repeated terminal signals must not interrupt ownership cleanup.
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            stop_children()


raise SystemExit(main())
PY
