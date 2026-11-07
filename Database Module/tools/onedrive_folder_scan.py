"""Lists the existing client, employee and lead folders in the OneDrive "CRM AB CAPITAL" folder for the CRM folder map.

Read only: it never creates, renames, moves or deletes a folder or file. It writes one SQL file that calls
public.storage_folders_sync (Client Base migration 007), which links each folder to its CRM record by the code at the end
of the folder name, else by name (see the migration for the rules).

    python "Database Module/tools/onedrive_folder_scan.py" [--root PATH] [--out FILE]

Then run the SQL file on Supabase (SQL editor, or psql). Run again whenever folders are added in OneDrive.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

DEFAULT_ROOT = Path(r"C:\Users\User\OneDrive - AB Capital Services FZE\CRM AB CAPITAL")
CLIENT_AREAS = ("Accounting", "Business Banking", "Business Setup")

CLIENT_CODE = re.compile(r"\s-\s*(CL\d{6})\s*$", re.I)
EMPLOYEE_CODE = re.compile(r"\s-\s*([A-Z]{2,5}-[A-Z0-9]+)\s*$", re.I)
LEAD_CODE = re.compile(r"\s-\s*(LD-\d{4}-\d{6})\s*$", re.I)
CODES = {"client": CLIENT_CODE, "employee": EMPLOYEE_CODE, "lead": LEAD_CODE}


def subdirs(p: Path) -> list[Path]:
    try:
        return sorted((c for c in p.iterdir() if c.is_dir()), key=lambda c: c.name.lower())
    except OSError:  # a OneDrive placeholder that is not on this PC, or a path too long for Windows
        return []


def entry(root: Path, folder: Path, area: str, kind: str, ex: bool = False) -> dict:
    m = CODES[kind].search(folder.name)
    return {"path": str(folder.relative_to(root)), "name": folder.name, "area": area, "kind": kind,
            "code": m.group(1).upper() if m else None, "ex": ex, "subfolders": [s.name for s in subdirs(folder)]}


def scan(root: Path) -> list[dict]:
    """Every folder that stands for one client, employee or lead. Department working folders ("00 ...") are skipped,
    except the "00 Unmatched" ones and the archive, whose folders are old client or employee folders without a code."""
    out: list[dict] = []
    for area in CLIENT_AREAS:
        for f in subdirs(root / area):
            if not f.name.startswith("00 "):
                out.append(entry(root, f, area, "client"))
    unmatched = root / "Accounting" / "00 Unmatched - to link"
    for group in subdirs(unmatched):  # "2. Accounting Clients\<client>", "5. Audit Clients\<client>"
        out.append(entry(root, group, "Accounting", "client"))
        for f in subdirs(group):
            out.append(entry(root, f, "Accounting", "client"))
    for f in subdirs(root / "08 Archive" / "Closed and Liquidated Clients"):
        out.append(entry(root, f, "Archive", "client"))
    for f in subdirs(root / "08 Archive" / "From old OneDrive" / "Various Other Work"):
        out.append(entry(root, f, "Archive", "client"))
    for f in subdirs(root / "Business Development" / "00 Leads (before client code)"):
        out.append(entry(root, f, "Business Development", "lead"))
    emp = root / "EMPLOYEES"
    for f in subdirs(emp):
        if not f.name.startswith("00 "):
            out.append(entry(root, f, "EMPLOYEES", "employee"))
    for f in subdirs(emp / "00 EX EMPLOYEES"):
        out.append(entry(root, f, "EMPLOYEES", "employee", ex=True))
    for f in subdirs(emp / "00 Unmatched"):
        out.append(entry(root, f, "EMPLOYEES", "employee"))
    return out


def sql_literal(text: str, tag: str = "scan") -> str:
    while f"${tag}$" in text:
        tag += "x"
    return f"${tag}${text}${tag}$"


def to_sql(root: Path, folders: list[dict]) -> str:
    return ("-- Made by Database Module/tools/onedrive_folder_scan.py. Links existing OneDrive folders; changes no folder.\n"
            f"select public.storage_folders_sync({sql_literal(str(root), 'root')}, {sql_literal(json.dumps(folders, ensure_ascii=False))}::jsonb);\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    # Client and employee names are in the file, so by default it goes to the temp folder, not into the project.
    ap.add_argument("--out", type=Path, default=Path(tempfile.gettempdir()) / "onedrive_folder_sync.sql")
    args = ap.parse_args(argv)
    if not args.root.is_dir():
        print(f"Folder not found: {args.root}. Check that OneDrive is running and synced.", file=sys.stderr)
        return 1
    folders = scan(args.root)
    args.out.write_text(to_sql(args.root, folders), encoding="utf-8")
    coded = sum(1 for f in folders if f["code"])
    print(f"{len(folders)} folders ({coded} with a code, {len(folders) - coded} to match by name). SQL: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
