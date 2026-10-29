"""Command line: run stages 2-6 and the review decision on files and print the result as JSON.

    python -m docai FILE [FILE ...] [--no-scan] [--type DocType]

Nothing is filed and no CRM is touched; a temporary work folder is used and removed afterwards.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

from .pipeline import DocumentPipeline, PipelineConfig, PipelineError


def main() -> int:
    args = sys.argv[1:]
    scan = "--no-scan" not in args
    forced = args[args.index("--type") + 1] if "--type" in args else None
    files = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--type")]
    if not files:
        print(__doc__)
        return 2
    work = Path(tempfile.mkdtemp(prefix="docai-cli-"))
    try:
        p = DocumentPipeline(PipelineConfig(work_dir=work, virus_scan=scan, ai_enabled=False))
        batch = p.new_batch()
        out = []
        for f in files:
            try:
                with open(f, "rb") as fh:
                    d = p.receive(batch, Path(f).name, fh)
                if forced:
                    d = p.set_type(batch, d["id"], forced)
                out.append(d)
            except PipelineError as exc:
                out.append({"name": Path(f).name, "error": exc.message})
        print(json.dumps(out, ensure_ascii=False, indent=1))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
