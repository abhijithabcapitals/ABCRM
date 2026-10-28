"""Client Module: staff onboarding with the 134-column client master and document auto-fill.

Documents are handled by the shared Document Module (package `docai`), found at config.json "documentModule"
(default: the sibling folder ..\\Document Module).
"""
import json
import sys
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
try:
    _cfg = json.loads((_root / "config.json").read_text(encoding="utf-8"))
except (OSError, ValueError):
    _cfg = {}
_docmod = Path(_cfg.get("documentModule", "../Document Module"))
_docmod = _docmod if _docmod.is_absolute() else (_root / _docmod).resolve()
if str(_docmod) not in sys.path:
    sys.path.insert(0, str(_docmod))
