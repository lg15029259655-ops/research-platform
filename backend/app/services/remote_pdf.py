"""Fetch an OpenAlex-listed public PDF with size and network limits."""

import hashlib
import ipaddress
import socket
from pathlib import Path
from urllib.parse import urljoin, urlparse
from uuid import uuid4

import httpx

from app.config import max_pdf_bytes, upload_dir


class RemotePDFError(Exception):
    pass


def public_https(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return False
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(entry[4][0]).is_global for entry in addresses)
    except (OSError, ValueError):
        return False


async def fetch_pdf(url: str, owner: str, paper_id: str) -> tuple[str, int, str]:
    folder = upload_dir() / owner / paper_id
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{uuid4()}.pdf"
    current = url
    completed = False
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(35, connect=12), follow_redirects=False) as client:
            for _ in range(5):
                if not public_https(current):
                    raise RemotePDFError("开放 PDF 地址无效，请手动上传")
                async with client.stream("GET", current, headers={"Accept": "application/pdf"}) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            raise RemotePDFError("开放 PDF 地址已失效，请手动上传")
                        current = urljoin(current, location)
                        continue
                    if response.status_code != 200:
                        raise RemotePDFError("暂时无法获取开放 PDF，请手动上传")
                    digest = hashlib.sha256()
                    size = 0
                    prefix = b""
                    with target.open("wb") as output:
                        async for chunk in response.aiter_bytes(1024 * 256):
                            size += len(chunk)
                            if size > max_pdf_bytes():
                                raise RemotePDFError("开放 PDF 超过大小限制，请手动上传")
                            if len(prefix) < 5:
                                prefix += chunk[:5 - len(prefix)]
                            output.write(chunk)
                            digest.update(chunk)
                    if prefix != b"%PDF-":
                        raise RemotePDFError("开放链接未返回 PDF 文件，请手动上传")
                    completed = True
                    return str(target), size, digest.hexdigest()
            raise RemotePDFError("开放 PDF 跳转过多，请手动上传")
    except RemotePDFError:
        raise
    except (httpx.HTTPError, OSError) as exc:
        raise RemotePDFError("暂时无法获取开放 PDF，请手动上传") from exc
    finally:
        if not completed:
            target.unlink(missing_ok=True)
