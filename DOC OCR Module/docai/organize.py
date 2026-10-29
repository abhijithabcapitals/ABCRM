"""Stage 9 - file organization.

Copies a document into one or more client folders:
    <parent>/<Client Name - ID>/<category>/[<year>/<month>/[Tally/]]<ID>_<DocType>[_Person|_MonthYear].ext
Every client folder gets the same standard subfolders. Copies are hash-checked before they are renamed into place,
identical content is never stored twice in one folder, and Windows long paths are handled.
"""
from __future__ import annotations

from pathlib import Path

from .classify import CATEGORIES, FINANCIALS, SECRETS
from .files import copy_verified, long_path, safe_join
from .naming import MONTHS, client_folder_name, document_file_name

SECRETS_NOTICE = ("SENSITIVE - this folder holds login details supplied by the client.\n"
                  "Do not copy, email or share these files. Restrict access to the people working on this client.\n")


def ensure_client_folder(root: Path, parent: list[str], client_id: str, client_name: str,
                         subfolders: list[str] = CATEGORIES) -> Path:
    """`root/<parent...>/<Name - ID>` with the standard subfolders. An existing folder for the same ID is reused
    even if the name has changed since."""
    base = safe_join(root, *parent) if parent else root
    long_path(base).mkdir(parents=True, exist_ok=True)
    existing = next((p for p in base.iterdir() if p.is_dir() and p.name.endswith(f" - {client_id}")), None)
    client_dir = existing or base / client_folder_name(client_name, client_id)
    for sub in subfolders:
        long_path(client_dir / sub).mkdir(parents=True, exist_ok=True)
    notice = client_dir / SECRETS / "_SENSITIVE - READ ME.txt"
    if SECRETS in subfolders and not notice.exists():
        notice.write_text(SECRETS_NOTICE, encoding="utf-8")
    return client_dir


def target_name(client_id: str, doc: dict) -> str:
    category = doc.get("category") or "Others"
    dated = category == FINANCIALS or doc.get("doc_type") == "BankStatement"
    people = (doc.get("extraction") or {}).get("people") or []
    person = people[0]["name"] if people and category == "KYC" else None
    return document_file_name(client_id, doc.get("doc_type") or "Other", doc["ext"], person,
                              doc.get("year") if dated else None, doc.get("month") if dated else None)


def file_document(src: Path, doc: dict, client_id: str, client_dirs: list[Path]) -> list[Path]:
    """Copy one processed document into every client folder. Returns the stored paths."""
    category = doc.get("category") or "Others"
    name = target_name(client_id, doc)
    stored = []
    for cd in client_dirs:
        target = cd / category
        if category == FINANCIALS and doc.get("year"):
            target = target / str(doc["year"])
            if doc.get("month"):
                target = target / MONTHS[doc["month"] - 1]
            if doc.get("is_tally"):
                target = target / "Tally"
        path, _copied = copy_verified(src, target, name, doc["sha256"])
        stored.append(path)
    return stored
