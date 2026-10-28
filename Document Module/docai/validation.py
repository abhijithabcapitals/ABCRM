"""Stage 2 - virus / file validation.

File checks: allowed extension, size limits, content signature matches the extension, text files are text, and
ZIP archives are safe to open (member count, total unpacked size, compression ratio, no absolute or '..' paths,
no nested archives beyond one level). Then a virus scan with Windows Defender's command-line scanner
(MpCmdRun.exe, built into Windows; nothing leaves the PC). A file Defender flags is rejected. When no scanner is
available the file is accepted but marked "not scanned", which the review stage turns into a human-review reason.
"""
from __future__ import annotations

import glob
import os
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .files import validate_upload

MAX_ZIP_MEMBERS = 5000
MAX_ZIP_UNPACKED = 2 * 1024 ** 3      # 2 GB
MAX_ZIP_RATIO = 200                   # unpacked / packed, per member (zip-bomb guard)
SCAN_TIMEOUT = 180


@dataclass
class ValidationResult:
    ok: bool
    error: str | None = None
    scan: str = "not scanned"         # clean | threat | not scanned | error
    scan_detail: str = ""


def find_defender() -> str | None:
    cands = sorted(glob.glob(os.path.expandvars(r"%ProgramData%\Microsoft\Windows Defender\Platform\*\MpCmdRun.exe")),
                   key=os.path.getmtime, reverse=True)
    cands.append(os.path.expandvars(r"%ProgramFiles%\Windows Defender\MpCmdRun.exe"))
    return next((c for c in cands if os.path.isfile(c)), None)


def virus_scan(path: Path) -> tuple[str, str]:
    """(status, detail) using Windows Defender. Exit code 0 = no threat, 2 = threat found."""
    exe = find_defender()
    if not exe:
        return "not scanned", "Windows Defender command-line scanner not found"
    try:
        out = subprocess.run([exe, "-Scan", "-ScanType", "3", "-File", str(path.resolve()), "-DisableRemediation"],
                             capture_output=True, timeout=SCAN_TIMEOUT,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as exc:
        return "error", f"scan did not complete: {type(exc).__name__}"
    text = out.stdout.decode("utf-8", "ignore").strip().splitlines()
    last = text[-1].strip() if text else ""
    if out.returncode == 0:
        return "clean", last or "no threats found"
    if out.returncode == 2:
        return "threat", last or "threat found"
    return "error", f"scanner exit code {out.returncode}"


def check_zip(path: Path) -> str | None:
    try:
        with zipfile.ZipFile(path) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_ZIP_MEMBERS:
                return f"The archive holds more than {MAX_ZIP_MEMBERS} files."
            total = 0
            for i in infos:
                name = i.filename.replace("\\", "/")
                if name.startswith("/") or ".." in name.split("/") or ":" in name:
                    return "The archive contains unsafe file paths."
                if i.flag_bits & 0x1:
                    return "Password-protected archives can't be checked. Upload the files without a password."
                total += i.file_size
                if i.compress_size and i.file_size / max(i.compress_size, 1) > MAX_ZIP_RATIO and i.file_size > 10 * 1024 ** 2:
                    return "The archive looks malformed (extreme compression)."
            if total > MAX_ZIP_UNPACKED:
                return "The archive is too large when unpacked."
    except zipfile.BadZipFile:
        return "The archive is damaged and can't be opened."
    return None


def validate(path: Path, ext: str, size: int, max_bytes: int, max_archive_bytes: int, scan: bool = True) -> ValidationResult:
    problem = validate_upload(path, ext, size, max_bytes, max_archive_bytes)
    if not problem and ext in (".zip", ".xlsx", ".docx"):
        problem = check_zip(path)
    if problem:
        return ValidationResult(False, problem)
    if not scan:
        return ValidationResult(True, scan="not scanned", scan_detail="scanning switched off")
    status, detail = virus_scan(path)
    if status == "threat":
        return ValidationResult(False, f"Windows Defender flagged this file ({detail}). It was not stored.", status, detail)
    return ValidationResult(True, None, status, detail)
