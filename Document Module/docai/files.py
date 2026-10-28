"""File service: safe paths inside allowed roots, hashing, upload validation and verified copies."""
from __future__ import annotations

import hashlib
import os
import shutil
import uuid
from pathlib import Path

ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".xls", ".xlsx", ".csv", ".txt", ".zip", ".docx", ".doc"}
ARCHIVE_EXT = {".zip"}
_MAGIC = {
    ".pdf": [b"%PDF"],
    ".png": [b"\x89PNG"],
    ".jpg": [b"\xff\xd8\xff"], ".jpeg": [b"\xff\xd8\xff"],
    ".xlsx": [b"PK\x03\x04"], ".docx": [b"PK\x03\x04"], ".zip": [b"PK\x03\x04", b"PK\x05\x06"],
    ".xls": [b"\xd0\xcf\x11\xe0"], ".doc": [b"\xd0\xcf\x11\xe0"],
}


class PathEscapeError(ValueError):
    pass


def safe_join(root: Path, *parts: str) -> Path:
    """Join path parts under `root`, refusing anything that would land outside it (path traversal)."""
    root_resolved = root.resolve()
    for part in parts:
        if not part or part in (".", "..") or any(sep in part for sep in ("/", "\\")) or ":" in part:
            raise PathEscapeError(f"unsafe path component: {part!r}")
    target = root_resolved.joinpath(*parts).resolve()
    if target != root_resolved and root_resolved not in target.parents:
        raise PathEscapeError("path escapes the allowed root")
    return target


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def extension_of(file_name: str) -> str:
    return os.path.splitext(file_name)[1].lower()


def validate_upload(path: Path, ext: str, size: int, max_bytes: int, max_archive_bytes: int) -> str | None:
    """Return an error message for the client, or None when the file is acceptable."""
    if ext not in ALLOWED_EXT:
        return "This file type isn't supported. Upload a PDF, image, Excel, Word, CSV, TXT or ZIP file."
    limit = max_archive_bytes if ext in ARCHIVE_EXT else max_bytes
    if size == 0:
        return "This file is empty."
    if size > limit:
        return f"This file is larger than {limit // (1024 * 1024)} MB."
    with open(path, "rb") as fh:
        head = fh.read(8)
    if ext in _MAGIC and not any(head.startswith(m) for m in _MAGIC[ext]):
        return "The file's contents don't match its extension. Please upload the original file."
    if ext in (".txt", ".csv"):
        with open(path, "rb") as fh:
            if b"\x00" in fh.read(65536) and not head.startswith((b"\xff\xfe", b"\xfe\xff")):
                return "This doesn't look like a text file."
    return None


def find_same_content(folder: Path, sha: str, size: int) -> Path | None:
    """An existing file in `folder` with identical content (same size, then same SHA-256)."""
    if not folder.is_dir():
        return None
    for entry in folder.iterdir():
        if entry.is_file() and entry.stat().st_size == size and sha256_file(entry) == sha:
            return entry
    return None


def unique_name(folder: Path, name: str) -> Path:
    candidate = folder / name
    stem, ext = os.path.splitext(name)
    n = 2
    while candidate.exists():
        candidate = folder / f"{stem}_{n}{ext}"
        n += 1
    return candidate


def long_path(p: Path) -> Path:
    """Windows extended-length form (\\\\?\\C:\\...) so deep client folders are not cut off at 260 characters."""
    s = str(p.resolve())
    if os.name != "nt" or s.startswith("\\\\?\\"):
        return p
    return Path("\\\\?\\UNC\\" + s[2:]) if s.startswith("\\\\") else Path("\\\\?\\" + s)


def display_path(p: Path) -> Path:
    s = str(p)
    return Path("\\\\" + s[8:]) if s.startswith("\\\\?\\UNC\\") else Path(s[4:]) if s.startswith("\\\\?\\") else p


def copy_verified(src: Path, folder: Path, name: str, sha: str) -> tuple[Path, bool]:
    """Copy `src` into `folder` as `name`. Returns (path, copied). Skips when identical content is already there.

    The copy is written to a temporary name, hash-checked, then renamed, so a half-written file never appears.
    """
    src, folder = long_path(src), long_path(folder)
    target, copied = _copy_verified(src, folder, name, sha)
    return display_path(target), copied


def _copy_verified(src: Path, folder: Path, name: str, sha: str) -> tuple[Path, bool]:
    folder.mkdir(parents=True, exist_ok=True)
    size = src.stat().st_size
    existing = find_same_content(folder, sha, size)
    if existing:
        return existing, False
    target = unique_name(folder, name)
    tmp = folder / f".{uuid.uuid4().hex}.partial"
    try:
        shutil.copyfile(src, tmp)
        if sha256_file(tmp) != sha:
            raise OSError(f"copy verification failed for {target.name}")
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            tmp.unlink()
    return target, True
