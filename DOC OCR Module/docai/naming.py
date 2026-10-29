"""Client-name normalisation and Windows-safe names for folders and files."""
from __future__ import annotations

import re
import unicodedata

# Legal-form suffixes written one canonical way. Keys are compared lower-case without dots or spaces.
_SUFFIXES = {
    "llc": "LLC", "fze": "FZE", "fzco": "FZCO", "fzc": "FZC", "fzllc": "FZ-LLC", "fz-llc": "FZ-LLC",
    "fzlle": "FZ-LLE", "fz-lle": "FZ-LLE", "dmcc": "DMCC", "pjsc": "PJSC", "psc": "PSC", "spc": "SPC",
    "ltd": "Ltd", "plc": "PLC", "est": "Est", "co": "Co", "inc": "Inc", "llp": "LLP", "opc": "OPC",
}
_SMALL_WORDS = {"of", "and", "the", "for", "in", "on", "at", "by", "to"}
_WINDOWS_RESERVED ={"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_INVALID_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_LLC_SPACED = re.compile(r"\bL\s*\.\s*L\s*\.\s*C\s*\.?(?=\s|$|,)", re.IGNORECASE)
_FZ_LLC_SPACED = re.compile(r"\bF\s*\.?\s*Z\s*[-\s]\s*L\s*\.?\s*L\s*\.?\s*C\b\.?", re.IGNORECASE)


def _canonical_token(token: str, was_upper: bool) -> str:
    bare = token.lower().replace(".", "")
    if bare in _SUFFIXES:
        return _SUFFIXES[bare]
    if "&" == token:
        return "&"
    if was_upper and len(token.replace(".", "")) <= 4 and token.replace(".", "").isalpha():
        return token.upper()  # initialisms such as ABC or ACE keep their capitals
    parts = re.split(r"([-'])", token)
    return "".join(p[:1].upper() + p[1:].lower() if p not in "-'" else p for p in parts)


def normalize_company_name(name: str) -> str:
    """'abc trading l.l.c.' / 'ABC TRADING LLC.' -> 'ABC Trading LLC' (initialism kept when typed in capitals)."""
    text = unicodedata.normalize("NFKC", name or "").strip()
    text = _FZ_LLC_SPACED.sub(" FZ-LLC", text)
    text = _LLC_SPACED.sub(" LLC", text)
    text = re.sub(r"\s+", " ", text).strip(" .,;-")
    all_caps = text.isupper()
    out = []
    for token in text.split(" "):
        token = token.strip(",")
        if not token:
            continue
        if out and token.lower() in _SMALL_WORDS:
            out.append(token.lower())
            continue
        # In an all-capitals name nothing tells us which words are initialisms, so only short words stay capitalised.
        was_upper = token.isupper() and (not all_caps or len(token.replace(".", "")) <= 3)
        out.append(_canonical_token(token, was_upper))
    return " ".join(out)


def name_key(name: str) -> str:
    """Comparison key: case, punctuation and suffix spelling are ignored, so variants of one name match."""
    norm = normalize_company_name(name).lower()
    norm = norm.replace("fz-llc", "fzllc").replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", norm).strip()


def safe_component(value: str, max_len: int = 80, fallback: str = "Unnamed") -> str:
    """A single Windows-safe path component: no separators, invalid characters, reserved names or trailing dots."""
    text = unicodedata.normalize("NFKC", value or "")
    text = _INVALID_CHARS.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip().rstrip(". ")
    if text.split(".")[0].upper() in _WINDOWS_RESERVED:
        text = f"_{text}"
    if len(text) > max_len:
        text = text[:max_len].rstrip(". ")
    return text or fallback


def client_folder_name(legal_name: str, client_id: str) -> str:
    return f"{safe_component(normalize_company_name(legal_name), 70)} - {client_id}"


def compact(value: str) -> str:
    """'Mohammed Ali' -> 'MohammedAli' for use inside file names."""
    words = re.findall(r"[A-Za-z0-9]+", unicodedata.normalize("NFKD", value or ""))
    return "".join(w[:1].upper() + w[1:] for w in words)[:40]


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]


def document_file_name(client_id: str, doc_type: str, ext: str, person: str | None = None,
                       year: int | None = None, month: int | None = None) -> str:
    """CLIENTID_DocumentType[_Person][_MonthYear].ext - e.g. CL000001_BankStatement_March2026.pdf"""
    parts = [client_id, doc_type]
    if person:
        parts.append(compact(person))
    if year and month:
        parts.append(f"{MONTHS[month - 1]}{year}")
    elif year:
        parts.append(str(year))
    stem = safe_component("_".join(p for p in parts if p), 120)
    return f"{stem}{ext.lower()}"
