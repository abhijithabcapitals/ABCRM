"""Settings from config.json at the module root. Relative paths are resolved against the module root."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
MODULE_DIR = PACKAGE_DIR.parent


@dataclass
class Settings:
    storage_root: Path
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 8792
    max_upload_mb: int = 40
    virus_scan: bool = True
    ai_enabled: bool = True
    ai_model: str = "haiku"
    ai_cap_usd: float = 0.10
    ai_monthly_budget_usd: float = 5.0
    service_folders: dict[str, str] = field(default_factory=dict)
    embed_origins: list[str] = field(default_factory=list)  # CRM pages allowed to show this module in a frame
    generated_folders: dict[str, Path] = field(default_factory=dict)  # kind -> folder for CRM-generated documents
    proposal_root: Path | None = None  # synced OneDrive folder that receives CRM proposals (Accounting and Business Setup)
    remote_mode: bool = False
    allowed_hosts: list[str] = field(default_factory=list)
    supabase_url: str = ""
    supabase_anon_key: str = ""

    @classmethod
    def load(cls, path: Path | None = None, **overrides) -> "Settings":
        path = path or MODULE_DIR / "config.json"
        raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        ai = raw.get("ai", {})

        def resolve(p: str) -> Path:
            q = Path(p)
            return q if q.is_absolute() else MODULE_DIR / q

        s = cls(
            storage_root=resolve(raw.get("storageRoot", "storage")),
            data_dir=resolve(raw.get("dataDir", "data")),
            host=raw.get("host", "127.0.0.1"),
            port=int(raw.get("port", 8792)),
            max_upload_mb=int(raw.get("maxUploadMb", 40)),
            virus_scan=bool(raw.get("virusScan", True)),
            ai_enabled=bool(ai.get("enabled", True)),
            ai_model=ai.get("model", "haiku"),
            ai_cap_usd=float(ai.get("capPerCallUsd", 0.10)),
            ai_monthly_budget_usd=float(ai.get("monthlyBudgetUsd", 5.0)),
            service_folders=dict(raw.get("serviceFolders", {})),
            embed_origins=[str(o).rstrip("/") for o in raw.get("embedOrigins", [])],
            generated_folders={k: resolve(v) for k, v in raw.get("generatedFolders", {}).items()},
            proposal_root=resolve(raw["proposalRoot"]) if raw.get("proposalRoot") else None,
            remote_mode=bool(raw.get("remoteMode", False)),
            allowed_hosts=[str(h).strip().lower() for h in raw.get("allowedHosts", []) if str(h).strip()],
            supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
            supabase_anon_key=os.environ.get("SUPABASE_ANON_KEY", ""),
        )
        for k, v in overrides.items():
            setattr(s, k, v)
        if s.remote_mode:
            missing = [
                name for name, value in (
                    ("allowedHosts", s.allowed_hosts),
                    ("embedOrigins", s.embed_origins),
                    ("SUPABASE_URL", s.supabase_url),
                    ("SUPABASE_ANON_KEY", s.supabase_anon_key),
                ) if not value
            ]
            if missing:
                raise ValueError(f"Remote mode requires configuration for: {', '.join(missing)}")
        s.data_dir.mkdir(parents=True, exist_ok=True)
        return s
