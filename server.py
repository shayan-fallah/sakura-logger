#!/usr/bin/env python3
"""Sakura Log — a tiny single-user time & work logger.

Python standard library only. Data lives in one SQLite file.

    python3 server.py                  # run the server
    python3 server.py --set-password   # set / change the login password

Environment:
    LOGGER_HOST            bind address            (default 127.0.0.1)
    LOGGER_PORT            port                    (default 8765)
    LOGGER_DB              sqlite file path        (default ./data/logger.db)
    LOGGER_PASSWORD        initial password, used only if none is set yet
    LOGGER_SECURE_COOKIE   "1" when served over HTTPS (recommended)
"""
import argparse
import getpass
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import traceback
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from obsidian import LiveSyncClient, ObsidianSync, SyncError

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
DB_PATH = Path(os.environ.get("LOGGER_DB", BASE / "data" / "logger.db"))
HOST = os.environ.get("LOGGER_HOST", "127.0.0.1")
PORT = int(os.environ.get("LOGGER_PORT", "8765"))
SECURE_COOKIE = os.environ.get("LOGGER_SECURE_COOKIE", "0") == "1"
SESSION_SECONDS = 30 * 24 * 3600
SYNC = None  # ObsidianSync, created in main()
MAX_BODY = 256 * 1024
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#e0508f',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entries(
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  start_ts INTEGER NOT NULL,
  end_ts INTEGER
);
CREATE INDEX IF NOT EXISTS entries_start ON entries(start_ts);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


# ---------------------------------------------------------------- database

def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = db()
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def kv_get(conn, key, default=None):
    row = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def kv_set(conn, key, value):
    conn.execute(
        "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


# ---------------------------------------------------------------- passwords

def hash_password(pw):
    salt = secrets.token_bytes(16)
    iters = 400_000
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, iters)
    return f"pbkdf2${iters}${salt.hex()}${digest.hex()}"


def check_password(pw, stored):
    try:
        _, iters, salt, digest = stored.split("$")
        test = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(test.hex(), digest)
    except (ValueError, AttributeError):
        return False


# ---------------------------------------------------------------- routing

class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status, self.msg = status, msg


ROUTES = []


def route(method, pattern, auth=True):
    def deco(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn, auth))
        return fn
    return deco


def now():
    return int(time.time())


def s(body, key, maxlen=200, required=True):
    val = body.get(key)
    if val is None and not required:
        return None
    if not isinstance(val, str):
        raise ApiError(400, f"{key} must be text")
    val = val.strip()
    if required and not val:
        raise ApiError(400, f"{key} is required")
    if len(val) > maxlen:
        raise ApiError(400, f"{key} is too long")
    return val


def opt_int(val, key):
    if val is None or val == "":
        return None
    if isinstance(val, bool) or not isinstance(val, (int, float, str)):
        raise ApiError(400, f"{key} must be a number")
    try:
        return int(val)
    except ValueError:
        raise ApiError(400, f"{key} must be a number")


def get_or_404(conn, table, id_):
    row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (int(id_),)).fetchone()
    if not row:
        raise ApiError(404, f"{table[:-1]} not found")
    return row


def touched(req, *timestamps):
    """Queue the Obsidian notes covering these entry start times for a rewrite (after commit)."""
    req.after_commit.append(lambda: SYNC and SYNC.mark(*timestamps))


def touched_all(req):
    req.after_commit.append(lambda: SYNC and SYNC.mark_all())


# ---------------------------------------------------------------- auth

_login_fail = {"count": 0, "since": 0.0}
_login_lock = threading.Lock()


@route("POST", "/api/login", auth=False)
def login(req, conn, body, q):
    with _login_lock:
        if time.time() - _login_fail["since"] > 900:
            _login_fail.update(count=0, since=time.time())
        if _login_fail["count"] >= 10:
            raise ApiError(429, "Too many attempts. Try again in a few minutes.")
    pw = body.get("password") or ""
    if not isinstance(pw, str) or not check_password(pw, kv_get(conn, "password", "")):
        with _login_lock:
            _login_fail["count"] += 1
        time.sleep(0.7)
        raise ApiError(401, "Wrong password")
    conn.execute("DELETE FROM sessions WHERE expires < ?", (now(),))
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions(token,expires) VALUES(?,?)", (token, now() + SESSION_SECONDS))
    req.set_cookie(token, SESSION_SECONDS)
    return {"ok": True}


@route("POST", "/api/logout", auth=False)
def logout(req, conn, body, q):
    token = req.session_token()
    if token:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    req.set_cookie("", 0)
    return {"ok": True}


@route("GET", "/api/me")
def me(req, conn, body, q):
    return {"ok": True}


@route("POST", "/api/password")
def change_password(req, conn, body, q):
    old, new = body.get("old") or "", body.get("new") or ""
    if not check_password(old, kv_get(conn, "password", "")):
        raise ApiError(400, "Current password is wrong")
    if not isinstance(new, str) or len(new) < 6:
        raise ApiError(400, "New password needs at least 6 characters")
    kv_set(conn, "password", hash_password(new))
    current = req.session_token()
    conn.execute("DELETE FROM sessions WHERE token != ?", (current,))
    return {"ok": True}


# ---------------------------------------------------------------- prefs

@route("GET", "/api/prefs")
def get_prefs(req, conn, body, q):
    return json.loads(kv_get(conn, "prefs", "{}"))


@route("PUT", "/api/prefs")
def put_prefs(req, conn, body, q):
    old = json.loads(kv_get(conn, "prefs", "{}"))
    if (old.get("calendar"), old.get("tz")) != (body.get("calendar"), body.get("tz")):
        touched_all(req)
    kv_set(conn, "prefs", json.dumps(body))
    return body


# ---------------------------------------------------------------- projects & tasks

@route("GET", "/api/projects")
def list_projects(req, conn, body, q):
    t = now()
    totals = {
        r["project_id"]: r["total"]
        for r in conn.execute(
            "SELECT project_id, SUM(COALESCE(end_ts, ?) - start_ts) total FROM entries GROUP BY project_id", (t,)
        )
    }
    task_totals = {
        r["task_id"]: r["total"]
        for r in conn.execute(
            "SELECT task_id, SUM(COALESCE(end_ts, ?) - start_ts) total FROM entries "
            "WHERE task_id IS NOT NULL GROUP BY task_id", (t,)
        )
    }
    projects = []
    for p in conn.execute("SELECT * FROM projects ORDER BY archived, name COLLATE NOCASE"):
        d = dict(p)
        d["total"] = totals.get(p["id"], 0)
        d["tasks"] = []
        projects.append(d)
    by_id = {p["id"]: p for p in projects}
    for tk in conn.execute("SELECT * FROM tasks ORDER BY done, created_at"):
        d = dict(tk)
        d["total"] = task_totals.get(tk["id"], 0)
        by_id[tk["project_id"]]["tasks"].append(d)
    return projects


@route("POST", "/api/projects")
def create_project(req, conn, body, q):
    name = s(body, "name", 80)
    color = body.get("color") or "#e0508f"
    if not COLOR_RE.match(color):
        raise ApiError(400, "Invalid color")
    cur = conn.execute(
        "INSERT INTO projects(name,color,created_at) VALUES(?,?,?)", (name, color, now())
    )
    return dict(get_or_404(conn, "projects", cur.lastrowid))


@route("PATCH", r"/api/projects/(\d+)")
def update_project(req, conn, pid, body, q):
    p = dict(get_or_404(conn, "projects", pid))
    if "name" in body:
        p["name"] = s(body, "name", 80)
    if "color" in body:
        if not isinstance(body["color"], str) or not COLOR_RE.match(body["color"]):
            raise ApiError(400, "Invalid color")
        p["color"] = body["color"]
    if "archived" in body:
        p["archived"] = 1 if body["archived"] else 0
    conn.execute(
        "UPDATE projects SET name=?, color=?, archived=? WHERE id=?",
        (p["name"], p["color"], p["archived"], p["id"]),
    )
    if "name" in body:
        touched_all(req)
    return p


@route("DELETE", r"/api/projects/(\d+)")
def delete_project(req, conn, pid, body, q):
    get_or_404(conn, "projects", pid)
    touched(req, *[r[0] for r in conn.execute("SELECT start_ts FROM entries WHERE project_id=?", (int(pid),))])
    conn.execute("DELETE FROM projects WHERE id=?", (int(pid),))


@route("POST", "/api/tasks")
def create_task(req, conn, body, q):
    pid = opt_int(body.get("project_id"), "project_id")
    if pid is None:
        raise ApiError(400, "project_id is required")
    get_or_404(conn, "projects", pid)
    name = s(body, "name", 120)
    cur = conn.execute(
        "INSERT INTO tasks(project_id,name,created_at) VALUES(?,?,?)", (pid, name, now())
    )
    d = dict(get_or_404(conn, "tasks", cur.lastrowid))
    d["total"] = 0
    return d


@route("PATCH", r"/api/tasks/(\d+)")
def update_task(req, conn, tid, body, q):
    t = dict(get_or_404(conn, "tasks", tid))
    if "name" in body:
        t["name"] = s(body, "name", 120)
    if "done" in body:
        t["done"] = 1 if body["done"] else 0
    conn.execute("UPDATE tasks SET name=?, done=? WHERE id=?", (t["name"], t["done"], t["id"]))
    if "name" in body:
        touched_all(req)
    return t


@route("DELETE", r"/api/tasks/(\d+)")
def delete_task(req, conn, tid, body, q):
    get_or_404(conn, "tasks", tid)
    touched(req, *[r[0] for r in conn.execute("SELECT start_ts FROM entries WHERE task_id=?", (int(tid),))])
    conn.execute("DELETE FROM tasks WHERE id=?", (int(tid),))


# ---------------------------------------------------------------- entries

def validate_refs(conn, project_id, task_id):
    """Returns (project_id, task_id), deriving the project from the task if needed."""
    if task_id is not None:
        task = get_or_404(conn, "tasks", task_id)
        if project_id is not None and task["project_id"] != project_id:
            raise ApiError(400, "Task does not belong to that project")
        project_id = task["project_id"]
    if project_id is not None:
        get_or_404(conn, "projects", project_id)
    return project_id, task_id


@route("GET", "/api/entries")
def list_entries(req, conn, body, q):
    frm, to = opt_int(q.get("from"), "from"), opt_int(q.get("to"), "to")
    if frm is None or to is None:
        raise ApiError(400, "from and to are required")
    rows = conn.execute(
        "SELECT * FROM entries WHERE start_ts < ? AND COALESCE(end_ts, ?) > ? ORDER BY start_ts DESC",
        (to, now(), frm),
    )
    return [dict(r) for r in rows]


@route("POST", "/api/entries")
def create_entry(req, conn, body, q):
    pid, tid = validate_refs(
        conn, opt_int(body.get("project_id"), "project_id"), opt_int(body.get("task_id"), "task_id")
    )
    start, end = opt_int(body.get("start_ts"), "start_ts"), opt_int(body.get("end_ts"), "end_ts")
    if start is None or end is None:
        raise ApiError(400, "start and end are required")
    if end <= start:
        raise ApiError(400, "End must be after start")
    desc = s(body, "description", 500, required=False) or ""
    cur = conn.execute(
        "INSERT INTO entries(project_id,task_id,description,start_ts,end_ts) VALUES(?,?,?,?,?)",
        (pid, tid, desc, start, end),
    )
    touched(req, start)
    return dict(get_or_404(conn, "entries", cur.lastrowid))


@route("PATCH", r"/api/entries/(\d+)")
def update_entry(req, conn, eid, body, q):
    e = dict(get_or_404(conn, "entries", eid))
    old_start = e["start_ts"]
    if "description" in body:
        e["description"] = s(body, "description", 500, required=False) or ""
    if "project_id" in body or "task_id" in body:
        pid = opt_int(body.get("project_id", e["project_id"]), "project_id")
        tid = opt_int(body.get("task_id", e["task_id"]), "task_id")
        e["project_id"], e["task_id"] = validate_refs(conn, pid, tid)
    if "start_ts" in body:
        e["start_ts"] = opt_int(body["start_ts"], "start_ts")
        if e["start_ts"] is None:
            raise ApiError(400, "start is required")
    if "end_ts" in body and e["end_ts"] is not None:
        e["end_ts"] = opt_int(body["end_ts"], "end_ts")
        if e["end_ts"] is None:
            raise ApiError(400, "end is required")
    if e["end_ts"] is None:
        if e["start_ts"] > now():
            raise ApiError(400, "A running entry can't start in the future")
    elif e["end_ts"] <= e["start_ts"]:
        raise ApiError(400, "End must be after start")
    conn.execute(
        "UPDATE entries SET project_id=?, task_id=?, description=?, start_ts=?, end_ts=? WHERE id=?",
        (e["project_id"], e["task_id"], e["description"], e["start_ts"], e["end_ts"], e["id"]),
    )
    touched(req, old_start, e["start_ts"])
    return e


@route("DELETE", r"/api/entries/(\d+)")
def delete_entry(req, conn, eid, body, q):
    touched(req, get_or_404(conn, "entries", eid)["start_ts"])
    conn.execute("DELETE FROM entries WHERE id=?", (int(eid),))


# ---------------------------------------------------------------- timer

def running(conn):
    row = conn.execute("SELECT * FROM entries WHERE end_ts IS NULL ORDER BY start_ts DESC LIMIT 1").fetchone()
    return dict(row) if row else None


@route("GET", "/api/timer")
def get_timer(req, conn, body, q):
    return {"running": running(conn)}


@route("POST", "/api/timer/start")
def start_timer(req, conn, body, q):
    pid, tid = validate_refs(
        conn, opt_int(body.get("project_id"), "project_id"), opt_int(body.get("task_id"), "task_id")
    )
    desc = s(body, "description", 500, required=False) or ""
    t = now()
    prev = running(conn)
    conn.execute("UPDATE entries SET end_ts=MAX(?, start_ts+1) WHERE end_ts IS NULL", (t,))
    touched(req, t, prev and prev["start_ts"])
    cur = conn.execute(
        "INSERT INTO entries(project_id,task_id,description,start_ts,end_ts) VALUES(?,?,?,?,NULL)",
        (pid, tid, desc, t),
    )
    return {"running": dict(get_or_404(conn, "entries", cur.lastrowid))}


@route("POST", "/api/timer/stop")
def stop_timer(req, conn, body, q):
    r = running(conn)
    if not r:
        return {"stopped": None}
    conn.execute("UPDATE entries SET end_ts=MAX(?, start_ts+1) WHERE id=?", (now(), r["id"]))
    touched(req, r["start_ts"])
    return {"stopped": dict(get_or_404(conn, "entries", r["id"]))}


# ---------------------------------------------------------------- obsidian

def obsidian_view(conn):
    cfg = ObsidianSync.load_config(conn)
    cfg["has_password"] = bool(cfg.pop("password"))
    cfg["status"] = SYNC.status if SYNC else {}
    return cfg


@route("GET", "/api/obsidian")
def get_obsidian(req, conn, body, q):
    return obsidian_view(conn)


@route("PUT", "/api/obsidian")
def put_obsidian(req, conn, body, q):
    cfg = ObsidianSync.load_config(conn)
    for key in ("url", "database", "username", "folder"):
        if key in body:
            cfg[key] = s(body, key, 300, required=key != "folder") or ""
    if not re.match(r"^https?://", cfg["url"]):
        raise ApiError(400, "CouchDB URL must start with http:// or https://")
    if ".." in cfg["folder"].split("/"):
        raise ApiError(400, "Folder can't contain '..'")
    if body.get("password"):  # empty means "keep the saved one"
        cfg["password"] = s(body, "password", 300)
    for key in ("enabled", "link_projects"):
        if key in body:
            cfg[key] = bool(body[key])
    ObsidianSync.save_config(conn, cfg)
    if cfg["enabled"]:
        touched_all(req)
    return obsidian_view(conn)


@route("POST", "/api/obsidian/test")
def test_obsidian(req, conn, body, q):
    try:
        return LiveSyncClient(ObsidianSync.load_config(conn)).check()
    except SyncError as e:
        raise ApiError(400, str(e))


@route("POST", "/api/obsidian/sync")
def sync_obsidian(req, conn, body, q):
    try:
        written = SYNC.sync(everything=True, force=True)
    except SyncError as e:
        SYNC.status["last_error"] = str(e)
        raise ApiError(400, str(e))
    return {"written": written, "status": SYNC.status}


# ---------------------------------------------------------------- backup

@route("GET", "/api/backup")
def backup(req, conn, body, q):
    return {
        "exported_at": now(),
        "projects": [dict(r) for r in conn.execute("SELECT * FROM projects")],
        "tasks": [dict(r) for r in conn.execute("SELECT * FROM tasks")],
        "entries": [dict(r) for r in conn.execute("SELECT * FROM entries")],
    }


# ---------------------------------------------------------------- HTTP handler

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: https:; "
        "frame-ancestors 'none'"
    ),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "SakuraLog/1.0"
    sys_version = ""

    def log_message(self, fmt, *args):
        if os.environ.get("LOGGER_ACCESS_LOG") == "1":
            super().log_message(fmt, *args)

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PATCH(self):
        self.dispatch("PATCH")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    # -- helpers
    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return cookie["sid"].value if "sid" in cookie else None

    def set_cookie(self, value, max_age):
        parts = [f"sid={value}", "Path=/", "HttpOnly", "SameSite=Strict", f"Max-Age={max_age}"]
        if SECURE_COOKIE:
            parts.append("Secure")
        self._cookies.append("; ".join(parts))

    def authed(self, conn):
        token = self.session_token()
        if not token:
            return False
        row = conn.execute("SELECT expires FROM sessions WHERE token=?", (token,)).fetchone()
        return bool(row and row["expires"] > now())

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "Request too large")
        if length == 0:
            return {}
        # Requiring a JSON content type means plain cross-site form posts can't reach the API.
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            raise ApiError(415, "Expected JSON")
        try:
            data = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, "Invalid JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "Expected a JSON object")
        return data

    def send(self, status, payload, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        for c in self._cookies:
            self.send_header("Set-Cookie", c)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def send_json(self, data, status=200):
        self.send(status, json.dumps(data).encode(), "application/json", {"Cache-Control": "no-store"})

    def serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        target = (STATIC / path.lstrip("/")).resolve()
        if not target.is_relative_to(STATIC) or not target.is_file():
            target = STATIC / "index.html"
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        self.send(200, target.read_bytes(), ctype, {"Cache-Control": "no-cache"})

    def dispatch(self, method):
        self._cookies = []
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            if method != "GET":
                return self.send_json({"error": "not found"}, 404)
            return self.serve_static(url.path)
        for m, rx, fn, auth in ROUTES:
            match = rx.match(url.path) if m == method else None
            if not match:
                continue
            conn = db()
            try:
                if auth and not self.authed(conn):
                    raise ApiError(401, "Login required")
                body = self.read_json() if method in ("POST", "PATCH", "PUT") else {}
                query = {k: v[0] for k, v in parse_qs(url.query).items()}
                self.after_commit = []
                result = fn(self, conn, *match.groups(), body=body, q=query)
                conn.commit()
                for hook in self.after_commit:
                    hook()
                return self.send_json({"ok": True} if result is None else result)
            except ApiError as e:
                conn.rollback()
                return self.send_json({"error": e.msg}, e.status)
            except Exception:
                conn.rollback()
                traceback.print_exc()
                return self.send_json({"error": "Server error"}, 500)
            finally:
                conn.close()
        self.send_json({"error": "not found"}, 404)


# ---------------------------------------------------------------- main

def prompt_password():
    while True:
        pw = getpass.getpass("New password: ")
        if len(pw) < 6:
            print("Use at least 6 characters.")
            continue
        if getpass.getpass("Repeat: ") != pw:
            print("Passwords don't match.")
            continue
        return pw


def main():
    ap = argparse.ArgumentParser(description="Sakura Log time tracker")
    ap.add_argument("--set-password", action="store_true", help="set or change the login password and exit")
    args = ap.parse_args()

    init_db()
    conn = db()
    try:
        if args.set_password:
            kv_set(conn, "password", hash_password(prompt_password()))
            conn.execute("DELETE FROM sessions")
            conn.commit()
            print("Password saved. All sessions were logged out.")
            return
        if not kv_get(conn, "password"):
            env_pw = os.environ.get("LOGGER_PASSWORD")
            if env_pw:
                kv_set(conn, "password", hash_password(env_pw))
            elif sys.stdin.isatty():
                print("No password set yet — let's create one.")
                kv_set(conn, "password", hash_password(prompt_password()))
            else:
                sys.exit("No password set. Run `python3 server.py --set-password` or set LOGGER_PASSWORD.")
            conn.commit()
    finally:
        conn.close()

    global SYNC
    SYNC = ObsidianSync(db)
    SYNC.mark_all()  # catch up on anything changed while we were down
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"✿ Sakura Log running on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nおやすみ~ bye!")


if __name__ == "__main__":
    main()
