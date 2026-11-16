from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import secrets
import shutil
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "dashboard.sqlite3"
HOST = "127.0.0.1"
PORT = 8000
MAX_BODY_BYTES = 1_000_000
TELEMETRY_RETENTION_DAYS = 30
SESSION_TTL_SECONDS = 8 * 60 * 60
SESSIONS: dict[str, tuple[str, float]] = {}
SESSIONS_LOCK = Lock()
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}
PROFILE_ID_KEY = "profileId"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db_connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def legacy_profile_id(name: str) -> str:
    digest = hashlib.sha256(name.strip().casefold().encode("utf-8")).hexdigest()[:16]
    return f"legacy-{digest}"


def read_json_rows(conn: sqlite3.Connection, table: str) -> list[dict]:
    if table not in {"records", "reports"}:
        raise ValueError("invalid table")
    rows = conn.execute(f"SELECT id, payload FROM {table} ORDER BY id ASC").fetchall()
    output = []
    for row in rows:
        try:
            output.append((row["id"], json.loads(row["payload"])))
        except json.JSONDecodeError:
            continue
    return output


def migrate_legacy_profiles(conn: sqlite3.Connection) -> None:
    profile_rows: dict[str, dict] = {}
    settings_row = conn.execute("SELECT value FROM metadata WHERE key = 'settings'").fetchone()
    session_row = conn.execute("SELECT value FROM metadata WHERE key = 'session'").fetchone()
    try:
        settings = json.loads(settings_row["value"]) if settings_row else {}
        session = json.loads(session_row["value"]) if session_row else {}
    except (json.JSONDecodeError, TypeError):
        settings, session = {}, {}

    baseline_name = str(settings.get("participantId") or "").strip()
    baseline_summary = session.get("baselineSummary") if isinstance(session, dict) else None
    for table in ("records", "reports"):
        for row_id, payload in read_json_rows(conn, table):
            if not isinstance(payload, dict):
                continue
            name = str(payload.get("profileName") or payload.get("participantId") or "").strip()
            profile_id = payload.get(PROFILE_ID_KEY)
            if not isinstance(profile_id, str) or not profile_id:
                profile_id = None
            if not profile_id and name:
                profile_id = legacy_profile_id(name)
                payload["profileId"] = profile_id
                payload["profileName"] = name
                conn.execute(
                    f"UPDATE {table} SET payload = ? WHERE id = ?",
                    (json.dumps(payload, ensure_ascii=False), row_id),
                )
            if profile_id and name and profile_id not in profile_rows:
                profile_rows[profile_id] = {
                    "profileId": profile_id,
                    "name": name,
                    "createdAt": utc_now(),
                    "baseline": None,
                }

    telemetry_rows = conn.execute("SELECT id, payload FROM telemetry_events").fetchall()
    for row in telemetry_rows:
        try:
            payload = json.loads(row["payload"])
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        name = str(payload.get("profileName") or payload.get("participantId") or "").strip()
        profile_id = payload.get(PROFILE_ID_KEY)
        if not isinstance(profile_id, str) or not profile_id:
            profile_id = None
        if not name and not profile_id:
            name = baseline_name
        if not profile_id and name:
            profile_id = legacy_profile_id(name)
            payload["profileId"] = profile_id
            payload["profileName"] = name
            conn.execute(
                "UPDATE telemetry_events SET payload = ? WHERE id = ?",
                (json.dumps(payload, ensure_ascii=False), row["id"]),
            )
        if profile_id and name and profile_id not in profile_rows:
            profile_rows[profile_id] = {
                "profileId": profile_id,
                "name": name,
                "createdAt": utc_now(),
                "baseline": None,
            }

    if baseline_name and isinstance(baseline_summary, dict):
        profile_id = legacy_profile_id(baseline_name)
        profile = profile_rows.setdefault(profile_id, {
            "profileId": profile_id,
            "name": baseline_name,
            "createdAt": utc_now(),
            "baseline": None,
        })
        if not profile["baseline"]:
            profile["baseline"] = {
                "hr": baseline_summary.get("hr"),
                "gsr": baseline_summary.get("gsr"),
                "temp": baseline_summary.get("temp"),
                "motion": baseline_summary.get("motion"),
                "sampleCount": baseline_summary.get("samples", 0),
                "durationSec": baseline_summary.get("durationSec", 0),
                "completedAt": baseline_summary.get("completedAt"),
            }

    history = session.get("history") if isinstance(session, dict) else None
    session_changed = False
    if isinstance(history, list):
        for sample in history:
            if not isinstance(sample, dict):
                continue
            name = str(sample.get("profileName") or sample.get("participantId") or baseline_name).strip()
            profile_id = sample.get(PROFILE_ID_KEY)
            if not isinstance(profile_id, str) or not profile_id:
                profile_id = legacy_profile_id(name) if name else None
                if profile_id:
                    sample["profileId"] = profile_id
                    session_changed = True
            if profile_id and name and profile_id not in profile_rows:
                profile_rows[profile_id] = {
                    "profileId": profile_id,
                    "name": name,
                    "createdAt": utc_now(),
                    "baseline": None,
                }
    if session_changed:
        set_metadata(conn, "session", session)

    for profile in profile_rows.values():
        conn.execute(
            """
            INSERT OR IGNORE INTO profiles (profile_id, payload, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                profile["profileId"],
                json.dumps(profile, ensure_ascii=False),
                profile["createdAt"],
                utc_now(),
            ),
        )


def init_db() -> None:
    with db_connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
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
            CREATE TABLE IF NOT EXISTS profiles (
                profile_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS telemetry_events (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL CHECK (kind IN ('sample', 'record')),
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_telemetry_events_kind_created
                ON telemetry_events (kind, created_at);
            """
        )
        migrate_legacy_profiles(conn)
        retention_cutoff = (datetime.now(timezone.utc) - timedelta(days=TELEMETRY_RETENTION_DAYS)).isoformat()
        conn.execute("DELETE FROM telemetry_events WHERE created_at < ?", (retention_cutoff,))


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


def replace_json_rows(conn: sqlite3.Connection, table: str, items: list[dict]) -> None:
    if table not in {"records", "reports"}:
        raise ValueError("invalid table")
    conn.execute(f"DELETE FROM {table}")
    now = utc_now()
    conn.executemany(
        f"INSERT INTO {table} (payload, created_at) VALUES (?, ?)",
        [(json.dumps(item, ensure_ascii=False), now) for item in items],
    )


def read_profiles(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT payload FROM profiles ORDER BY created_at, profile_id").fetchall()
    profiles = []
    for row in rows:
        try:
            payload = json.loads(row["payload"])
            if isinstance(payload, dict):
                profiles.append(payload)
        except json.JSONDecodeError:
            continue
    return profiles


def replace_profiles(conn: sqlite3.Connection, profiles: list[dict]) -> None:
    conn.execute("DELETE FROM profiles")
    now = utc_now()
    conn.executemany(
        """
        INSERT INTO profiles (profile_id, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        """,
        [
            (
                profile["profileId"],
                json.dumps(profile, ensure_ascii=False),
                profile.get("createdAt") or now,
                now,
            )
            for profile in profiles
        ],
    )


def delete_profile_data(conn: sqlite3.Connection, profile_id: str) -> dict[str, int]:
    profile_row = conn.execute(
        "SELECT payload FROM profiles WHERE profile_id = ?",
        (profile_id,),
    ).fetchone()
    profile_name = ""
    if profile_row:
        try:
            profile_name = str(json.loads(profile_row["payload"]).get("name") or "")
        except (json.JSONDecodeError, AttributeError):
            pass

    deleted = {"records": 0, "reports": 0, "telemetry": 0}
    for table in ("records", "reports"):
        rows = conn.execute(f"SELECT id, payload FROM {table}").fetchall()
        for row in rows:
            try:
                payload = json.loads(row["payload"])
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(payload, dict) and payload.get(PROFILE_ID_KEY) == profile_id:
                conn.execute(f"DELETE FROM {table} WHERE id = ?", (row["id"],))
                deleted[table] += 1

    telemetry_rows = conn.execute("SELECT id, payload FROM telemetry_events").fetchall()
    for row in telemetry_rows:
        try:
            payload = json.loads(row["payload"])
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(payload, dict) and payload.get(PROFILE_ID_KEY) == profile_id:
            conn.execute("DELETE FROM telemetry_events WHERE id = ?", (row["id"],))
            deleted["telemetry"] += 1

    session = get_metadata(conn, "session") or {}
    if isinstance(session, dict):
        history = session.get("history")
        session["history"] = [
            item for item in history
            if not isinstance(item, dict) or item.get(PROFILE_ID_KEY) != profile_id
        ] if isinstance(history, list) else []
        if session.get(PROFILE_ID_KEY) == profile_id:
            for key in ("profileId", "profileName", "baselineSummary", "id"):
                session.pop(key, None)
            session["baselineCaptureActive"] = False
            session["baselineCompletedAt"] = 0
            session["baselineEndsAt"] = 0
        set_metadata(conn, "session", session)

    if get_metadata(conn, "activeProfileId") == profile_id:
        set_metadata(conn, "activeProfileId", None)
    if profile_name:
        settings = get_metadata(conn, "settings")
        if isinstance(settings, dict) and settings.get("participantId") == profile_name:
            settings.pop("participantId", None)
            set_metadata(conn, "settings", settings)
    conn.execute("DELETE FROM profiles WHERE profile_id = ?", (profile_id,))
    return deleted


def update_profile_name(conn: sqlite3.Connection, profile_id: str, name: str) -> bool:
    row = conn.execute(
        "SELECT payload FROM profiles WHERE profile_id = ?",
        (profile_id,),
    ).fetchone()
    if not row:
        return False
    profile = json.loads(row["payload"])
    if not isinstance(profile, dict):
        raise ValueError("Invalid patient profile data")
    old_name = str(profile.get("name") or "")
    profile["name"] = name
    conn.execute(
        "UPDATE profiles SET payload = ?, updated_at = ? WHERE profile_id = ?",
        (json.dumps(profile, ensure_ascii=False), utc_now(), profile_id),
    )

    for table in ("records", "reports", "telemetry_events"):
        rows = conn.execute(f"SELECT id, payload FROM {table}").fetchall()
        for item in rows:
            try:
                payload = json.loads(item["payload"])
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(payload, dict) and payload.get(PROFILE_ID_KEY) == profile_id:
                payload["profileName"] = name
                conn.execute(
                    f"UPDATE {table} SET payload = ? WHERE id = ?",
                    (json.dumps(payload, ensure_ascii=False), item["id"]),
                )

    session = get_metadata(conn, "session") or {}
    if isinstance(session, dict):
        if session.get(PROFILE_ID_KEY) == profile_id:
            session["profileName"] = name
        history = session.get("history")
        if isinstance(history, list):
            for sample in history:
                if isinstance(sample, dict) and sample.get(PROFILE_ID_KEY) == profile_id:
                    sample["profileName"] = name
        set_metadata(conn, "session", session)

    settings = get_metadata(conn, "settings")
    if isinstance(settings, dict) and settings.get("participantId") == old_name:
        settings["participantId"] = name
        set_metadata(conn, "settings", settings)
    return True


def build_bootstrap_payload() -> dict:
    with db_connect() as conn:
        settings = get_metadata(conn, "settings")
        active_profile_id = get_metadata(conn, "activeProfileId")
        records = [payload for _, payload in read_json_rows(conn, "records")]
        reports = [payload for _, payload in read_json_rows(conn, "reports")]
        profiles = read_profiles(conn)
        session = get_metadata(conn, "session") or {}
        return {
            "settings": settings,
            "activeProfileId": active_profile_id,
            "records": records,
            "reports": reports,
            "profiles": profiles,
            "session": session,
            "serverHasData": bool(settings or active_profile_id or records or reports or profiles),
        }


def prepare_public_assets() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    for filename in (
        "index.html",
        "styles.css",
        "project_config.js",
        "main.js",
        "main_extension.js",
        "main_backend.js",
        "lstm_predictor.js",
        "label_map.json",
        "lstm_norm_params.json",
    ):
        source = ROOT / filename
        if source.is_file():
            shutil.copy2(source, PUBLIC_DIR / filename)

    static_dirs = (("assets", ("logo.png",)), ("tfjs_lstm_model", ("model.json", "group1-shard1of1.bin")))
    for directory, files in static_dirs:
        (PUBLIC_DIR / directory).mkdir(parents=True, exist_ok=True)
        for filename in files:
            source = ROOT / directory / filename
            if source.is_file():
                shutil.copy2(source, PUBLIC_DIR / directory / filename)

    model_names = (
        "face_expression_model",
        "face_landmark_68_model",
        "face_landmark_68_tiny_model",
        "ssd_mobilenetv1_model",
        "tiny_face_detector_model",
    )
    (PUBLIC_DIR / "models").mkdir(parents=True, exist_ok=True)
    for source in (ROOT / "models").glob("*"):
        if source.is_file() and source.name.startswith(model_names):
            shutil.copy2(source, PUBLIC_DIR / "models" / source.name)


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

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

    def _validate_host_origin(self) -> bool:
        host = self.headers.get("Host", "")
        parsed_host = urlparse(f"//{host}")
        if parsed_host.hostname not in ALLOWED_HOSTS:
            self._send_json({"ok": False, "error": "Invalid Host"}, HTTPStatus.FORBIDDEN)
            return False
        origin = self.headers.get("Origin")
        if origin:
            parsed_origin = urlparse(origin)
            if (
                parsed_origin.scheme not in {"http", "https"}
                or parsed_origin.hostname not in ALLOWED_HOSTS
                or parsed_origin.netloc.lower() != host.lower()
            ):
                self._send_json({"ok": False, "error": "Invalid Origin"}, HTTPStatus.FORBIDDEN)
                return False
        return True

    def _read_json_body(self):
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if length < 0:
            raise ValueError("Invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise OverflowError("Request body too large")
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Transfer-Encoding is not supported")
        if length == 0:
            return {}
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Invalid JSON body") from exc
        if not isinstance(payload, dict):
            raise ValueError("Expected a JSON object")
        return payload

    def _authorized_user(self) -> str | None:
        header = self.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return None
        now = time.time()
        with SESSIONS_LOCK:
            session = SESSIONS.get(token)
            if not session:
                return None
            user, expires_at = session
            if expires_at <= now:
                SESSIONS.pop(token, None)
                return None
            SESSIONS[token] = (user, now + SESSION_TTL_SECONDS)
        return user

    def _require_auth(self) -> str | None:
        user = self._authorized_user()
        if not user:
            self._send_json({"ok": False, "error": "Authentication required"}, HTTPStatus.UNAUTHORIZED)
        return user

    def do_OPTIONS(self):
        if not self._validate_host_origin():
            return
        path = urlparse(self.path).path
        if path.startswith("/api/") and path != "/api/login" and not self._require_auth():
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "GET, POST, HEAD, OPTIONS")
        self.end_headers()

    def do_HEAD(self):
        if not self._validate_host_origin():
            return
        if urlparse(self.path).path.startswith("/api/") and not self._require_auth():
            return
        super().do_HEAD()

    def do_GET(self):
        if not self._validate_host_origin():
            return
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            if not self._require_auth():
                return
            if parsed.path == "/api/health":
                self._send_json({"ok": True, "database": DB_PATH.name})
                return
            if parsed.path == "/api/bootstrap":
                payload = build_bootstrap_payload()
                payload["user"] = self._authorized_user()
                self._send_json(payload)
                return
            self._send_json({"ok": False, "error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        if not self._validate_host_origin():
            return
        path = urlparse(self.path).path
        if path != "/api/login" and not self._require_auth():
            return
        try:
            payload = self._read_json_body()
        except OverflowError:
            self._send_json({"ok": False, "error": "Request body too large"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return
        except ValueError:
            self._send_json({"ok": False, "error": "Invalid JSON request"}, HTTPStatus.BAD_REQUEST)
            return

        if path == "/api/login":
            configured_password = os.environ.get("PSYCHESCAN_OPERATOR_PASSWORD")
            username = payload.get("username")
            password = payload.get("password")
            if not configured_password:
                self._send_json({"ok": False, "error": "Server authentication is not configured"}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            if (
                not isinstance(username, str)
                or not username.strip()
                or not isinstance(password, str)
                or not secrets.compare_digest(password, configured_password)
            ):
                self._send_json({"ok": False, "error": "Invalid credentials"}, HTTPStatus.UNAUTHORIZED)
                return
            token = secrets.token_urlsafe(32)
            user = username.strip()[:120]
            with SESSIONS_LOCK:
                SESSIONS[token] = (user, time.time() + SESSION_TTL_SECONDS)
            self._send_json({"ok": True, "token": token, "user": user})
            return

        if path == "/api/logout":
            header = self.headers.get("Authorization", "")
            token = header.partition(" ")[2]
            with SESSIONS_LOCK:
                SESSIONS.pop(token, None)
            self._send_json({"ok": True})
            return

        if path == "/api/profiles/create":
            profile = payload.get("profile")
            if (
                not isinstance(profile, dict)
                or not isinstance(profile.get("profileId"), str)
                or not profile["profileId"]
                or len(profile["profileId"]) > 128
                or not isinstance(profile.get("name"), str)
                or not profile["name"].strip()
                or len(profile["name"].strip()) > 120
                or (profile.get("baseline") is not None and not isinstance(profile.get("baseline"), dict))
            ):
                self._send_json({"ok": False, "error": "Invalid patient profile"}, HTTPStatus.BAD_REQUEST)
                return
            profile_id = profile["profileId"]
            name = profile["name"].strip()
            created_at = profile.get("createdAt")
            if not isinstance(created_at, str) or not created_at or len(created_at) > 64:
                created_at = utc_now()
            profile_data = {
                "profileId": profile_id,
                "name": name,
                "createdAt": created_at,
                "baseline": profile.get("baseline"),
            }
            try:
                with db_connect() as conn:
                    if conn.execute(
                        "SELECT 1 FROM profiles WHERE profile_id = ?",
                        (profile_id,),
                    ).fetchone():
                        self._send_json({"ok": False, "error": "Patient profile already exists"}, HTTPStatus.CONFLICT)
                        return
                    for row in conn.execute("SELECT payload FROM profiles"):
                        try:
                            existing = json.loads(row["payload"])
                        except json.JSONDecodeError:
                            continue
                        if isinstance(existing, dict) and str(existing.get("name", "")).strip().casefold() == name.casefold():
                            self._send_json({"ok": False, "error": "A patient with that name or code already exists"}, HTTPStatus.CONFLICT)
                            return
                    now = utc_now()
                    conn.execute(
                        """
                        INSERT INTO profiles (profile_id, payload, created_at, updated_at)
                        VALUES (?, ?, ?, ?)
                        """,
                        (profile_id, json.dumps(profile_data, ensure_ascii=False), created_at, now),
                    )
                self._send_json({"ok": True, "profile": profile_data}, HTTPStatus.CREATED)
            except sqlite3.Error:
                self.log_error("Patient profile creation failed")
                self._send_json({"ok": False, "error": "Storage failure"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/profiles/delete":
            profile_id = payload.get("profileId")
            if not isinstance(profile_id, str) or not profile_id or len(profile_id) > 128:
                self._send_json({"ok": False, "error": "Invalid patient profile ID"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                with db_connect() as conn:
                    deleted = delete_profile_data(conn, profile_id)
                self._send_json({"ok": True, **deleted})
            except sqlite3.Error:
                self.log_error("Patient profile deletion failed")
                self._send_json({"ok": False, "error": "Storage failure"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/profiles/update":
            profile_id = payload.get("profileId")
            name = payload.get("name")
            if (
                not isinstance(profile_id, str)
                or not profile_id
                or len(profile_id) > 128
                or not isinstance(name, str)
                or not name.strip()
                or len(name.strip()) > 120
            ):
                self._send_json({"ok": False, "error": "Invalid patient profile update"}, HTTPStatus.BAD_REQUEST)
                return
            name = name.strip()
            try:
                with db_connect() as conn:
                    for row in conn.execute(
                        "SELECT profile_id, payload FROM profiles WHERE profile_id != ?",
                        (profile_id,),
                    ):
                        try:
                            existing = json.loads(row["payload"])
                        except json.JSONDecodeError:
                            continue
                        if isinstance(existing, dict) and str(existing.get("name", "")).strip().casefold() == name.casefold():
                            self._send_json({"ok": False, "error": "A patient with that name or code already exists"}, HTTPStatus.CONFLICT)
                            return
                    if not update_profile_name(conn, profile_id, name):
                        self._send_json({"ok": False, "error": "Patient profile not found"}, HTTPStatus.NOT_FOUND)
                        return
                self._send_json({"ok": True, "profileId": profile_id, "name": name})
            except (sqlite3.Error, TypeError, ValueError):
                self.log_error("Patient profile update failed")
                self._send_json({"ok": False, "error": "Storage failure"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/telemetry":
            self._store_telemetry(payload)
            return

        if path == "/api/sync":
            self._store_sync(payload)
            return

        self._send_json({"ok": False, "error": "Not found"}, HTTPStatus.NOT_FOUND)

    def _store_telemetry(self, payload: dict) -> None:
        events = payload.get("events")
        if not isinstance(events, list) or len(events) > 100:
            self._send_json({"ok": False, "error": "Expected up to 100 telemetry events"}, HTTPStatus.BAD_REQUEST)
            return
        rows = []
        for event in events:
            if not isinstance(event, dict):
                self._send_json({"ok": False, "error": "Invalid telemetry event"}, HTTPStatus.BAD_REQUEST)
                return
            event_id = event.get("id")
            kind = event.get("kind")
            event_payload = event.get("payload")
            created_at = event.get("createdAt")
            if (
                not isinstance(event_id, str)
                or not event_id
                or kind not in {"sample", "record"}
                or not isinstance(event_payload, dict)
                or not isinstance(event_payload.get(PROFILE_ID_KEY), str)
                or not event_payload[PROFILE_ID_KEY]
                or not isinstance(created_at, str)
                or not created_at
            ):
                self._send_json({"ok": False, "error": "Invalid telemetry event"}, HTTPStatus.BAD_REQUEST)
                return
            rows.append((event_id[:128], kind, json.dumps(event_payload, ensure_ascii=False), created_at[:64]))
        try:
            with db_connect() as conn:
                valid_profile_ids = {
                    row["profile_id"] for row in conn.execute("SELECT profile_id FROM profiles")
                }
                if any(event["payload"][PROFILE_ID_KEY] not in valid_profile_ids for event in events):
                    self._send_json({"ok": False, "error": "Telemetry references an unknown profile"}, HTTPStatus.BAD_REQUEST)
                    return
                before = conn.total_changes
                conn.executemany(
                    """
                    INSERT OR IGNORE INTO telemetry_events (id, kind, payload, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    rows,
                )
                inserted = conn.total_changes - before
            self._send_json({"ok": True, "saved": inserted})
        except sqlite3.Error:
            self.log_error("Telemetry database write failed")
            self._send_json({"ok": False, "error": "Storage failure"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def _store_sync(self, payload: dict) -> None:
        settings = payload.get("settings", {})
        records = payload.get("records", [])
        reports = payload.get("reports", [])
        profiles = payload.get("profiles", [])
        session = payload.get("session", {})
        active_profile_id = payload.get("activeProfileId")
        if (
            not isinstance(settings, dict)
            or not isinstance(records, list)
            or not isinstance(reports, list)
            or not isinstance(profiles, list)
            or not isinstance(session, dict)
        ):
            self._send_json({"ok": False, "error": "Invalid synchronization payload"}, HTTPStatus.BAD_REQUEST)
            return
        if any(not isinstance(item, dict) for item in records + reports):
            self._send_json({"ok": False, "error": "Invalid record payload"}, HTTPStatus.BAD_REQUEST)
            return
        if any(
            not isinstance(profile, dict)
            or not isinstance(profile.get("profileId"), str)
            or not profile["profileId"]
            or not isinstance(profile.get("name"), str)
            or not profile["name"].strip()
            for profile in profiles
        ):
            self._send_json({"ok": False, "error": "Invalid profile payload"}, HTTPStatus.BAD_REQUEST)
            return
        profile_ids = {profile["profileId"] for profile in profiles}
        if active_profile_id is not None and (
            not isinstance(active_profile_id, str) or active_profile_id not in profile_ids
        ):
            self._send_json({"ok": False, "error": "Invalid active profile"}, HTTPStatus.BAD_REQUEST)
            return
        if len(profile_ids) != len(profiles):
            self._send_json({"ok": False, "error": "Duplicate profile ID"}, HTTPStatus.BAD_REQUEST)
            return
        if any(
            item.get(PROFILE_ID_KEY) is not None
            and (not isinstance(item[PROFILE_ID_KEY], str) or item[PROFILE_ID_KEY] not in profile_ids)
            for item in records + reports
        ):
            self._send_json({"ok": False, "error": "Record references an unknown profile"}, HTTPStatus.BAD_REQUEST)
            return
        history = session.get("history", [])
        if (
            not isinstance(history, list)
            or any(
                not isinstance(sample, dict)
                or not isinstance(sample.get(PROFILE_ID_KEY), str)
                or sample[PROFILE_ID_KEY] not in profile_ids
                for sample in history
            )
            or (
                session.get(PROFILE_ID_KEY) is not None
                and (
                    not isinstance(session[PROFILE_ID_KEY], str)
                    or session[PROFILE_ID_KEY] not in profile_ids
                )
            )
        ):
            self._send_json({"ok": False, "error": "Session history references an unknown profile"}, HTTPStatus.BAD_REQUEST)
            return
        try:
            with db_connect() as conn:
                set_metadata(conn, "settings", settings)
                set_metadata(conn, "session", session)
                set_metadata(conn, "activeProfileId", active_profile_id)
                replace_profiles(conn, profiles)
                replace_json_rows(conn, "records", records)
                replace_json_rows(conn, "reports", reports)
            self._send_json({
                "ok": True,
                "records": len(records),
                "reports": len(reports),
                "profiles": len(profiles),
                "updatedAt": utc_now(),
            })
        except (sqlite3.Error, TypeError, ValueError):
            self.log_error("Synchronization database write failed")
            self._send_json({"ok": False, "error": "Storage failure"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main() -> None:
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("application/wasm", ".wasm")
    prepare_public_assets()
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), DashboardHandler)
    print(f"Dashboard server running at http://{HOST}:{PORT}")
    print(f"Public files: {PUBLIC_DIR}")
    print(f"Database file: {DB_PATH}")
    if not os.environ.get("PSYCHESCAN_OPERATOR_PASSWORD"):
        print("Set PSYCHESCAN_OPERATOR_PASSWORD before signing in.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
