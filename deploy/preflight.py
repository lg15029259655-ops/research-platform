"""Read-only deployment checks. Run locally, then on the Linux server before activation."""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOMAIN = "lunyu-lab.site"
BACKEND_PORT = 8100
FRONTEND_PORT = 3100
failures: list[str] = []


def check(ok: bool, label: str, advice: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f" — {advice}" if not ok and advice else ""))
    if not ok:
        failures.append(label)


def read_env_keys(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def local_checks() -> None:
    print("Local source checks (read only)")
    required = [
        "frontend/next.config.ts",
        "frontend/pnpm-lock.yaml",
        "frontend/src/lib/api.ts",
        "backend/requirements.txt",
        "deploy/research-platform-frontend.service",
        "deploy/research-platform-backend.service",
        "deploy/nginx-lunyu-lab.conf",
        "deploy/backend.env.example",
    ]
    for name in required:
        check((ROOT / name).is_file(), name)

    source_dir = ROOT / "frontend/src"
    fixed_loopback = [str(p.relative_to(ROOT)) for p in source_dir.rglob("*.tsx")
                      if "http://127.0.0.1:8000" in p.read_text(encoding="utf-8")]
    check(not fixed_loopback, "No browser-side hardcoded local API address",
          ", ".join(fixed_loopback))

    api_file = ROOT / "frontend/src/lib/api.ts"
    if api_file.is_file():
        check("NEXT_PUBLIC_API_URL ??" in api_file.read_text(encoding="utf-8"),
              "Empty NEXT_PUBLIC_API_URL keeps same-origin /api")

    nginx_file = ROOT / "deploy/nginx-lunyu-lab.conf"
    if nginx_file.is_file():
        conf = nginx_file.read_text(encoding="utf-8")
        check(f"server_name {DOMAIN};" in conf and
              f"127.0.0.1:{BACKEND_PORT}" in conf and
              f"127.0.0.1:{FRONTEND_PORT}" in conf,
              "Nginx domain and upstreams match deployment ports")
        check("campusradar.site" not in conf and "sites-enabled/default" not in conf,
              "New Nginx site does not modify Campus Radar/default site")

    env_file = ROOT / "deploy/backend.env.example"
    if env_file.is_file():
        env = read_env_keys(env_file)
        check(env.get("DATABASE_URL", "").startswith("sqlite:////var/lib/research-platform/"),
              "SQLite database lives outside release directory")
        check(env.get("UPLOAD_DIR", "").startswith("/var/lib/research-platform/"),
              "PDF uploads live outside release directory")
        check(env.get("FRONTEND_ORIGIN") == f"https://{DOMAIN}",
              "Backend origin matches public HTTPS domain")


def server_checks() -> None:
    print("Linux server checks (read only; run after staging, before activation)")
    if sys.platform != "linux":
        check(False, "Linux server", "Run --server on the target server")
        return

    for binary in ("node", "python3", "nginx", "systemctl", "curl"):
        check(shutil.which(binary) is not None, f"{binary} installed")
    try:
        import pwd
        pwd.getpwnam("researchplatform")
        check(True, "Dedicated researchplatform user exists")
    except (ImportError, KeyError):
        check(False, "Dedicated researchplatform user exists")

    release = Path("/opt/research-platform/current")
    check((release / "frontend/server.js").is_file(), "Next standalone server staged")
    check((release / "frontend/.next/static").is_dir(), "Next static assets staged")
    check((release / "backend/app/main.py").is_file(), "FastAPI source staged")
    check(Path("/opt/research-platform/venv/bin/uvicorn").is_file(), "Backend venv staged")
    data = Path("/var/lib/research-platform")
    check(data.is_dir() and (data / "uploads").is_dir(), "Persistent DB/uploads directory exists")

    env_path = Path("/etc/research-platform/backend.env")
    check(env_path.is_file(), "Production backend.env exists")
    if env_path.is_file():
        try:
            env = read_env_keys(env_path)
            required = ("BAILIAN_API_KEY", "BAILIAN_BASE_URL", "DATABASE_URL", "UPLOAD_DIR", "FRONTEND_ORIGIN")
            missing = [key for key in required if not env.get(key)]
            check(not missing, "Required environment values are set", ", ".join(missing))
            check(env.get("FRONTEND_ORIGIN") == f"https://{DOMAIN}", "Production origin matches domain")
            check(env.get("DATABASE_URL", "").startswith("sqlite:////var/lib/research-platform/"),
                  "Production DB path is persistent")
            check(env.get("UPLOAD_DIR", "").startswith("/var/lib/research-platform/"),
                  "Production PDF path is persistent")
        except PermissionError:
            check(False, "Read production env file", "Run with permission to read it; values are never printed")
        check(env_path.stat().st_mode & 0o077 == 0, "Production env is not group/world readable")

    for port in (BACKEND_PORT, FRONTEND_PORT):
        sock = socket.socket()
        try:
            sock.bind(("127.0.0.1", port))
            free = True
        except OSError:
            free = False
        finally:
            sock.close()
        print(f"INFO  127.0.0.1:{port} {'free' if free else 'in use'}; identify owner before activation")

    disk = shutil.disk_usage("/")
    check(disk.free >= 5 * 1024**3, "At least 5 GiB free disk for release, PDFs and backup")
    meminfo = Path("/proc/meminfo").read_text(encoding="utf-8")
    mem_available = int(next(line.split()[1] for line in meminfo.splitlines()
                             if line.startswith("MemAvailable:"))) * 1024
    check(mem_available >= 400 * 1024**2,
          "At least 400 MiB currently available RAM before starting new services")
    if shutil.which("systemctl"):
        for service in ("campus-radar.service", "research-platform-frontend.service",
                        "research-platform-backend.service"):
            result = subprocess.run(["systemctl", "is-active", service], capture_output=True, text=True)
            print(f"INFO  {service}: {result.stdout.strip() or result.stderr.strip()}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", action="store_true", help="also inspect the staged Linux host")
    args = parser.parse_args()
    local_checks()
    if args.server:
        server_checks()
    print(f"Result: {len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
