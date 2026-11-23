"""Bounded in-process cache for the text already read by PDF searches."""

from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from stat import S_ISREG
from sys import getsizeof
from threading import Lock

import pymupdf


_MATCH_LIMIT = 30
_CACHE_FILES = 6
_CACHE_BYTES_PER_FILE = 4 * 1024 * 1024


class PdfChangedDuringSearch(Exception):
    pass


@dataclass(frozen=True)
class TextPrefix:
    pages: tuple[tuple[str, str], ...] = ()
    bytes_used: int = 0
    complete: bool = False


_cache: OrderedDict[tuple, TextPrefix] = OrderedDict()
_cache_lock = Lock()


def _file_signature(path: Path) -> tuple[int, int, int, int, int]:
    stat = path.stat()
    if not S_ISREG(stat.st_mode):
        raise FileNotFoundError(path)
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


def _cached_prefix(key: tuple) -> TextPrefix:
    with _cache_lock:
        prefix = _cache.get(key)
        if prefix is None:
            return TextPrefix()
        _cache.move_to_end(key)
        return prefix


def _save_prefix(key: tuple, candidate: TextPrefix) -> None:
    with _cache_lock:
        previous = _cache.get(key)
        if previous is not None and (previous.complete or len(previous.pages) > len(candidate.pages)):
            return
        _cache[key] = candidate
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_FILES:
            _cache.popitem(last=False)


def _record_match(hits: list[dict], number: int, text: str, folded: str, query: str) -> bool:
    index = folded.find(query)
    if index >= 0:
        hits.append({
            "page": number,
            "snippet": text[max(0, index - 60):index + len(query) + 100].replace("\n", " "),
        })
    return len(hits) >= _MATCH_LIMIT


def search_pdf_text(path: Path, query: str, revision: str | None) -> list[dict]:
    signature = _file_signature(path)
    key = (path, revision, signature)
    prefix = _cached_prefix(key)
    hits: list[dict] = []
    for number, (text, folded) in enumerate(prefix.pages, 1):
        if _record_match(hits, number, text, folded, query):
            break

    candidate = None
    if len(hits) < _MATCH_LIMIT and not prefix.complete:
        pages = list(prefix.pages)
        bytes_used = prefix.bytes_used
        with pymupdf.open(path) as document:
            for index in range(len(pages), document.page_count):
                text = document[index].get_text("text")
                folded = text.lower()
                size = getsizeof(text) + getsizeof(folded) + 64
                if index == len(pages) and bytes_used + size <= _CACHE_BYTES_PER_FILE:
                    pages.append((text, folded))
                    bytes_used += size
                if _record_match(hits, index + 1, text, folded, query):
                    break
            candidate = TextPrefix(tuple(pages), bytes_used, len(pages) == document.page_count)
    if _file_signature(path) != signature:
        raise PdfChangedDuringSearch
    if candidate is not None:
        _save_prefix(key, candidate)
    return hits
