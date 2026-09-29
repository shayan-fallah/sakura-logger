"""Mirror time entries into an Obsidian vault as one markdown note per month.

The notes are written straight into the CouchDB database used by the
Self-hosted LiveSync plugin, which then syncs them to every device.
Only unencrypted vaults without path obfuscation are supported.
"""
import base64
import hashlib
import json
import re
import threading
import time
import traceback
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import jalali

JM_FA = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"]
JM_EN = ["Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
         "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"]
GM_EN = ["January", "February", "March", "April", "May", "June", "July",
         "August", "September", "October", "November", "December"]
WD_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]  # date.weekday() order
DEBOUNCE_SECONDS = 3

DEFAULT_CONFIG = {
    "enabled": False,
    "url": "http://127.0.0.1:5984",
    "database": "obsidiannotes",
    "username": "",
    "password": "",
    "folder": "Time Log",
    "link_projects": True,
}


def fa_digits(s):
    return str(s).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


def hrs(sec):
    m = round(sec / 60)
    if m < 60:
        return f"{m}m"
    return f"{m // 60}h {m % 60:02d}m" if m % 60 else f"{m // 60}h"


def hmm(sec):
    m = round(sec / 60)
    return f"{m // 60}:{m % 60:02d}"


def cell(text):
    """Make text safe inside a markdown table cell."""
    return str(text or "").replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


# ------------------------------------------------------------------ months & calendar

def month_of(d, calendar):
    if calendar == "jalali":
        jy, jm, _ = jalali.to_jalali(d.year, d.month, d.day)
        return jy, jm
    return d.year, d.month


def month_bounds(calendar, y, m):
    """First day of the month and first day of the next month, as Gregorian dates."""
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    if calendar == "jalali":
        return date(*jalali.to_gregorian(y, m, 1)), date(*jalali.to_gregorian(ny, nm, 1))
    return date(y, m, 1), date(ny, nm, 1)


def note_path(folder, calendar, y, m):
    name = f"{y}-{m:02d} {JM_EN[m - 1] if calendar == 'jalali' else GM_EN[m - 1]}.md"
    folder = folder.strip().strip("/")
    return f"{folder}/{name}" if folder else name


def render_month(conn, calendar, y, m, tz, link_projects=True, now=None):
    """Returns the markdown for one month, or None if nothing was logged in it."""
    first, nxt = month_bounds(calendar, y, m)
    a = int(datetime(first.year, first.month, first.day, tzinfo=tz).timestamp())
    b = int(datetime(nxt.year, nxt.month, nxt.day, tzinfo=tz).timestamp())
    rows = conn.execute(
        "SELECT e.*, p.name AS project, t.name AS task FROM entries e "
        "LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN tasks t ON t.id = e.task_id "
        "WHERE e.start_ts >= ? AND e.start_ts < ? ORDER BY e.start_ts",
        (a, b),
    ).fetchall()
    if not rows:
        return None
    now = now or int(time.time())

    def project_label(name):
        if not name:
            return "_No project_"
        # Only link names that are valid Obsidian note names.
        if link_projects and not any(c in name for c in '[]|#^\\/:*"<>?'):
            return f"[[{name}]]"
        return cell(name)

    days, per_project, total = {}, {}, 0
    for r in rows:
        dur = (r["end_ts"] or now) - r["start_ts"]
        start = datetime.fromtimestamp(r["start_ts"], tz)
        days.setdefault(start.date(), []).append((r, start, dur))
        per_project[r["project"]] = per_project.get(r["project"], 0) + dur
        total += dur

    if calendar == "jalali":
        title = f"{JM_FA[m - 1]} {fa_digits(y)}"
        month_id = f"{y}-{m:02d}"
    else:
        title = f"{GM_EN[m - 1]} {y}"
        month_id = f"{y}-{m:02d}"

    out = [
        "---",
        "tags: [timelog]",
        f"month: {month_id}",
        f"calendar: {'shamsi' if calendar == 'jalali' else 'gregorian'}",
        f"total_hours: {total / 3600:.2f}",
        f"days_worked: {len(days)}",
        "---",
        f"# {title} — Time Log",
        "",
        "> [!info] Written by Sakura Log. Edits here get overwritten on the next sync.",
        "",
        f"**Month total: {hrs(total)}** · {len(days)} day{'s' if len(days) != 1 else ''} worked",
        "",
        "| Project | Hours | Share |",
        "|---|---:|---:|",
    ]
    for name, sec in sorted(per_project.items(), key=lambda kv: -kv[1]):
        out.append(f"| {project_label(name)} | {hrs(sec)} | {round(sec / total * 100) if total else 0}% |")

    for day in sorted(days, reverse=True):
        entries = days[day]
        jy, jm, jd = jalali.to_jalali(day.year, day.month, day.day)
        greg = f"{WD_EN[day.weekday()]} {day.day} {GM_EN[day.month - 1][:3]}"
        shamsi = f"{fa_digits(jd)} {JM_FA[jm - 1]}"
        heading = f"{shamsi} · {greg}" if calendar == "jalali" else f"{greg} · {shamsi}"
        day_total = sum(d for _, _, d in entries)
        out += [
            "",
            f"## {heading} — {hrs(day_total)}",
            "",
            "| Start | End | Dur | Project | Task | Notes |",
            "|---|---|---:|---|---|---|",
        ]
        for r, start, dur in entries:
            if r["end_ts"] is None:
                end = "⏱ running"
            else:
                end_dt = datetime.fromtimestamp(r["end_ts"], tz)
                end = end_dt.strftime("%H:%M") + (" ⁺¹" if end_dt.date() != start.date() else "")
            out.append(
                f"| {start:%H:%M} | {end} | {hmm(dur)} | {project_label(r['project'])} "
                f"| {cell(r['task'])} | {cell(r['description'])} |"
            )
    out.append("")
    return "\n".join(out)


# ------------------------------------------------------------------ LiveSync / CouchDB

class SyncError(Exception):
    pass


class LiveSyncClient:
    """Tiny CouchDB client that reads/writes notes in LiveSync's document format."""

    def __init__(self, cfg):
        self.base = cfg["url"].rstrip("/") + "/" + urllib.parse.quote(cfg["database"], safe="")
        token = base64.b64encode(f"{cfg['username']}:{cfg['password']}".encode()).decode()
        self.auth = f"Basic {token}"

    def request(self, method, path, body=None, ok_missing=False):
        req = urllib.request.Request(self.base + path, method=method)
        req.add_header("Authorization", self.auth)
        req.add_header("Accept", "application/json")
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, data, timeout=15) as res:
                return json.loads(res.read() or b"null")
        except urllib.error.HTTPError as e:
            if e.code == 404 and ok_missing:
                return None
            detail = e.read().decode(errors="replace")[:200]
            if e.code == 401:
                raise SyncError("CouchDB rejected the username/password") from None
            if e.code == 404:
                raise SyncError(f"Not found on CouchDB ({path or 'database'}): {detail}") from None
            raise SyncError(f"CouchDB error {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            raise SyncError(f"Can't reach CouchDB: {e.reason}") from None

    def doc_url(self, doc_id):
        return "/" + urllib.parse.quote(doc_id, safe="")

    def check(self):
        """Verifies the database is a LiveSync vault we can safely write to. Returns its settings."""
        info = self.request("GET", "")
        ver = self.request("GET", "/obsydian_livesync_version", ok_missing=True)
        if not ver:
            raise SyncError("This database has no LiveSync version document — is it the right database?")
        if ver.get("version") not in (12, 13):
            raise SyncError(f"Unsupported LiveSync database version {ver.get('version')}")
        features = set(ver.get("used_features") or [])
        if features & {"independent-id-derivation-v1", "encrypted-internal-metadata-v1"}:
            raise SyncError("This vault uses encryption features Sakura Log can't write")
        milestone = self.request("GET", "/_local/obsydian_livesync_milestone", ok_missing=True) or {}
        tweaks = milestone.get("tweak_values") or {}
        for node in tweaks.values():
            if node.get("encrypt") or node.get("usePathObfuscation"):
                raise SyncError("This vault uses end-to-end encryption or path obfuscation — not supported")
        # Belt and braces: obfuscated paths ("f:") or encrypted chunks ("h:+") in the data itself.
        for prefix in ("f:", "h:+"):
            hit = self.request("GET", "/_all_docs?" + urllib.parse.urlencode(
                {"startkey": json.dumps(prefix), "endkey": json.dumps(prefix + "￰"), "limit": 1}))
            if hit.get("rows"):
                raise SyncError("This vault contains encrypted/obfuscated documents — not supported")
        preferred = tweaks.get("PREFERRED") or next(iter(tweaks.values()), {})
        case_sensitive = bool(preferred.get("handleFilenameCaseSensitive", False))
        return {
            "case_sensitive": case_sensitive,
            "message": f"Connected to “{info.get('db_name')}” ({info.get('doc_count', 0)} docs, "
                       f"LiveSync v{ver.get('version')}, unencrypted) — ready to write ✿",
        }

    @staticmethod
    def normalize(path):
        path = unicodedata.normalize("NFC", path.replace("\\", "/").replace(" ", " ").replace(" ", " "))
        return re.sub(r"/+", "/", path).strip("/")

    @staticmethod
    def path_to_id(path, case_sensitive):
        doc_id = path if case_sensitive else path.lower()
        return "/" + doc_id if doc_id.startswith("_") else doc_id

    def write_note(self, path, text, settings):
        """Creates or replaces a text note, exactly like LiveSync's DirectFileManipulator does."""
        path = self.normalize(path)
        doc_id = self.path_to_id(path, settings["case_sensitive"])
        children = []
        if text:
            # Chunks are content-addressed and immutable, so an existing one (409) is fine as-is.
            chunk_id = "h:" + hashlib.sha256(text.encode()).hexdigest()
            try:
                self.request("PUT", self.doc_url(chunk_id), {"_id": chunk_id, "type": "leaf", "data": text})
            except SyncError as e:
                if "409" not in str(e):
                    raise
            children = [chunk_id]
        now_ms = int(time.time() * 1000)
        for attempt in range(3):
            old = self.request("GET", self.doc_url(doc_id), ok_missing=True)
            doc = {
                "_id": doc_id,
                "path": path,
                "type": "plain",
                "children": children,
                "ctime": (old or {}).get("ctime") or now_ms,
                "mtime": now_ms,
                "size": len(text.encode()),  # UTF-8 bytes; LiveSync refuses files whose size doesn't match
                "eden": {},
            }
            if old:
                doc["_rev"] = old["_rev"]
            try:
                return self.request("PUT", self.doc_url(doc_id), doc)
            except SyncError as e:
                if "409" not in str(e) or attempt == 2:
                    raise


# ------------------------------------------------------------------ background worker

class ObsidianSync:
    def __init__(self, db_factory):
        self.db = db_factory
        self.lock = threading.Lock()          # guards the dirty set
        self.push_lock = threading.Lock()     # one writer to CouchDB at a time
        self.wake = threading.Event()
        self.dirty_ts, self.dirty_all = set(), False
        self.status = {"last_sync": None, "last_error": None, "last_note": None}
        threading.Thread(target=self._run, daemon=True, name="obsidian-sync").start()

    # -- config
    @staticmethod
    def load_config(conn):
        row = conn.execute("SELECT value FROM kv WHERE key='obsidian'").fetchone()
        cfg = dict(DEFAULT_CONFIG)
        if row:
            cfg.update(json.loads(row["value"]))
        return cfg

    @staticmethod
    def save_config(conn, cfg):
        conn.execute(
            "INSERT INTO kv(key,value) VALUES('obsidian',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(cfg),),
        )

    @staticmethod
    def prefs(conn):
        row = conn.execute("SELECT value FROM kv WHERE key='prefs'").fetchone()
        p = json.loads(row["value"]) if row else {}
        try:
            tz = ZoneInfo(p.get("tz") or "UTC")
        except (ZoneInfoNotFoundError, ValueError):
            tz = ZoneInfo("UTC")
        return p.get("calendar", "jalali"), tz

    # -- change tracking (call after the change is committed)
    def mark(self, *timestamps):
        with self.lock:
            self.dirty_ts.update(t for t in timestamps if t)
        self.wake.set()

    def mark_all(self):
        with self.lock:
            self.dirty_all = True
        self.wake.set()

    # -- syncing
    def _run(self):
        while True:
            self.wake.wait()
            time.sleep(DEBOUNCE_SECONDS)  # batch bursts of edits into one write
            self.wake.clear()
            with self.lock:
                stamps, everything = self.dirty_ts, self.dirty_all
                self.dirty_ts, self.dirty_all = set(), False
            try:
                self.sync(stamps, everything)
            except SyncError as e:
                self.status["last_error"] = str(e)
            except Exception as e:  # keep the worker alive no matter what
                traceback.print_exc()
                self.status["last_error"] = f"Unexpected error: {e}"

    def sync(self, stamps=(), everything=False, force=False):
        """Re-renders the affected months and pushes changed notes. Returns the number written."""
        conn = self.db()
        try:
            cfg = self.load_config(conn)
            if not cfg["enabled"]:
                return 0
            calendar, tz = self.prefs(conn)
            if everything:
                stamps = [r[0] for r in conn.execute("SELECT start_ts FROM entries")]
            months = {month_of(datetime.fromtimestamp(t, tz).date(), calendar) for t in stamps}
            if not months:
                return 0
            client = LiveSyncClient(cfg)
            written = 0
            with self.push_lock:
                settings = client.check()  # re-checked every run, in case the vault got encrypted since
                for y, m in sorted(months):
                    path = note_path(cfg["folder"], calendar, y, m)
                    key = "obsidian_hash:" + path
                    row = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
                    body = render_month(conn, calendar, y, m, tz, cfg["link_projects"])
                    if body is None:
                        if not row:
                            continue
                        # Month emptied out after we wrote it: leave a stub rather than
                        # deleting a note the user might have linked to.
                        body = f"# {path.rsplit('/', 1)[-1][:-3]}\n\nNo time logged this month.\n"
                    digest = hashlib.sha256(body.encode()).hexdigest()
                    if not force and row and row["value"] == digest:
                        continue
                    client.write_note(path, body, settings)
                    conn.execute(
                        "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, digest),
                    )
                    conn.commit()
                    written += 1
                    self.status["last_note"] = path
            self.status["last_sync"] = int(time.time())
            self.status["last_error"] = None
            return written
        finally:
            conn.close()
