"""Prepare durable Render paths, drop privileges, and start one API process."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import sys
import tempfile


APP_UID = 10001
APP_GID = 10001


def _safe_directory(path: Path, data_root: Path) -> Path:
    if not path.is_absolute():
        raise ValueError("Production data paths must be absolute.")
    for component in (path, *path.parents):
        if component.is_symlink():
            raise ValueError("Production data paths must not contain symlinks.")
    if not path.resolve().is_relative_to(data_root.resolve()):
        raise ValueError("Vault, corpus, and packages must remain inside RULECRAFT_DATA_DIR.")
    return path


def _own_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o750)
    if os.getuid() == 0:
        os.chown(path, APP_UID, APP_GID)


def prepare_data(data_root: Path, seed_vault: Path) -> None:
    """Seed only an absent vault; an existing empty or edited vault is preserved."""
    _safe_directory(data_root, data_root)
    vault = _safe_directory(Path(os.environ.get("RULECRAFT_VAULT", str(data_root / "vault"))), data_root)
    corpus = _safe_directory(Path(os.environ.get("RULECRAFT_LAW_DIR", str(data_root / "national-law"))), data_root)
    packages = _safe_directory(Path(os.environ.get("RULECRAFT_PACKAGE_DIR", str(data_root / "packages"))), data_root)
    _own_directory(data_root)
    _own_directory(vault.parent)
    if not vault.exists():
        temporary = Path(tempfile.mkdtemp(prefix=".rulecraft-seed-", dir=vault.parent))
        try:
            shutil.copytree(seed_vault, temporary, dirs_exist_ok=True, symlinks=False)
            if os.getuid() == 0:
                for path in (temporary, *temporary.rglob("*")):
                    os.chown(path, APP_UID, APP_GID)
            temporary.rename(vault)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    for path in (vault, corpus, packages):
        _own_directory(path)
    os.environ["RULECRAFT_VAULT"] = str(vault)
    os.environ["RULECRAFT_LAW_DIR"] = str(corpus)
    os.environ["RULECRAFT_PACKAGE_DIR"] = str(packages)


def main() -> None:
    # Fail before importing API modules or creating any SQLite files.
    if os.environ.get("RULECRAFT_DEPLOYMENT", "production").strip().lower() != "production":
        raise ValueError("This launcher requires RULECRAFT_DEPLOYMENT=production.")
    if not os.environ.get("RULECRAFT_API_TOKEN", "").strip():
        raise ValueError("RULECRAFT_API_TOKEN must be set before production startup.")
    os.environ["RULECRAFT_DEPLOYMENT"] = "production"
    port = int(os.environ.get("PORT", "10000"))
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535.")
    os.umask(0o027)
    prepare_data(Path(os.environ.get("RULECRAFT_DATA_DIR", "/var/data")), Path("/app/seed-vault"))
    if os.getuid() == 0:
        os.setgroups([])
        os.setgid(APP_GID)
        os.setuid(APP_UID)
    os.execv(sys.executable, [sys.executable, "-m", "uvicorn", "rulecraft.api:app",
                             "--host", "0.0.0.0", "--port", str(port), "--workers", "1",
                             "--timeout-graceful-shutdown", "30"])


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(f"RuleCraft production startup failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
