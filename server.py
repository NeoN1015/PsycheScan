from __future__ import annotations

import json
import mimetypes
import os
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "dashboard.sqlite3"
HOST = "127.0.0.1"
PORT = 8000


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def db_connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with db_connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        conn.commit()


def get_metadata(conn: sqlite3.Connection, key: str):
    row = conn.execute("SELECT value FROM metadata WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["value"])
    except json.JSONDecodeError:
        return None


def set_metadata(conn: sqlite3.Connection, key: str, value) -> None:
    conn.execute(
        """
        INSERT INTO metadata (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, json.dumps(value, ensure_ascii=False), utc_now()),
    )


def replace_json_rows(conn: sqlite3.Connection, table: str, items) -> None:
    if table not in {"records", "reports"}:
        raise ValueError("invalid table")
    conn.execute(f"DELETE FROM {table}")
    if not items:
        return
    now = utc_now()
    conn.executemany(
        f"INSERT INTO {table} (payload, created_at) VALUES (?, ?)",
        [(json.dumps(item, ensure_ascii=False), now) for item in items],
    )


def read_json_rows(conn: sqlite3.Connection, table: str):
    if table not in {"records", "reports"}:
        raise ValueError("invalid table")
    rows = conn.execute(f"SELECT payload FROM {table} ORDER BY id ASC").fetchall()
    out = []
    for row in rows:
        try:
            out.append(json.loads(row["payload"]))
        except json.JSONDecodeError:
            continue
    return out


def build_bootstrap_payload() -> dict:
    with db_connect() as conn:
        settings = get_metadata(conn, "settings")
        auth = get_metadata(conn, "auth")
        participant_counter = get_metadata(conn, "participantCounter") or 0
        records = read_json_rows(conn, "records")
        reports = read_json_rows(conn, "reports")
        server_has_data = bool(settings or auth or participant_counter or records or reports)
        return {
            "settings": settings,
            "auth": auth,
            "participantCounter": participant_counter,
            "records": records,
            "reports": reports,
            "serverHasData": server_has_data,
        }


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._send_json({"ok": True, "database": str(DB_PATH.name)})
            return
        if parsed.path == "/api/bootstrap":
            self._send_json(build_bootstrap_payload())
            return
        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/sync":
            self._send_json({"ok": False, "error": "Not found"}, status=404)
            return

        try:
            payload = self._read_json_body()
            settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else None
            auth = payload.get("auth") if isinstance(payload.get("auth"), dict) else None
            participant_counter = int(payload.get("participantCounter") or 0)
            records = payload.get("records") if isinstance(payload.get("records"), list) else []
            reports = payload.get("reports") if isinstance(payload.get("reports"), list) else []

            with db_connect() as conn:
                set_metadata(conn, "settings", settings or {})
                set_metadata(conn, "auth", auth or {})
                set_metadata(conn, "participantCounter", participant_counter)
                replace_json_rows(conn, "records", records)
                replace_json_rows(conn, "reports", reports)
                conn.commit()

            self._send_json(
                {
                    "ok": True,
                    "records": len(records),
                    "reports": len(reports),
                    "participantCounter": participant_counter,
                    "updatedAt": utc_now(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            self._send_json({"ok": False, "error": str(exc)}, status=500)


if __name__ == "__main__":
    mimetypes.add_type("application/javascript", ".js")
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), DashboardHandler)
    print(f"Dashboard server running at http://{HOST}:{PORT}")
    print(f"Database file: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
    finally:
        server.server_close()
