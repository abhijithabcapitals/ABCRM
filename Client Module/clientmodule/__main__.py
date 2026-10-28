"""python -m clientmodule [--no-browser]  -> http://127.0.0.1:8792"""
from __future__ import annotations

import logging
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

from .api import create_app
from .config import Settings


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = sys.argv[sys.argv.index("--config") + 1] if "--config" in sys.argv else None  # e.g. a test configuration
    settings = Settings.load(Path(cfg) if cfg else None)
    app = create_app(settings)
    url = f"http://{settings.host}:{settings.port}/"
    print(f"Client Module running at {url}  (close this window to stop)")
    print(f"Master file: {app.state.master.csv_path}")
    print(f"Document storage: {settings.storage_root}")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
