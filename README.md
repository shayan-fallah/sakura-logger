# 🌸 Sakura Log

A tiny, single-user time & work logger — like Clockify, minus everything you don't need.
Pastel anime theme, a mascot who cheers you on, and a full **Hijri Shamsi (شمسی)** calendar.

- **Timer**: one click start/stop, edit the running entry on the fly, "continue" any past entry
- **Projects → sub tasks**: colors, check tasks off, archive old projects, per-project/task totals
- **Manual entries**: add/edit/delete, with a Shamsi or Gregorian date picker (entries past midnight handled)
- **Calendar**: month view in Shamsi (RTL, Saturday-first, Persian digits) or Gregorian, both dates on every day
- **Reports**: today / week / month / year / custom range, stacked hours chart, breakdown by project & task, CSV export
- **Obsidian sync**: monthly time-log notes written into your vault through Self-hosted LiveSync's CouchDB
- **Settings**: day/night theme, custom wallpaper, daily goal, week start, password change, JSON backup

No dependencies: Python 3.9+ standard library and a single SQLite file.

## Run locally

```bash
python3 server.py            # asks you to create a password on the first run
# open http://127.0.0.1:8765
```

## Deploy on a VPS

```bash
# 1. copy the files
sudo useradd --system --home /opt/sakura-log sakura
sudo mkdir -p /opt/sakura-log && sudo cp -r *.py static /opt/sakura-log/
sudo mkdir -p /opt/sakura-log/data && sudo chown -R sakura: /opt/sakura-log

# 2. set your password (stored as a salted PBKDF2 hash in the DB)
sudo -u sakura python3 /opt/sakura-log/server.py --set-password

# 3. run it as a service
sudo cp deploy/sakura-log.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now sakura-log
```

The server only listens on `127.0.0.1`, so put HTTPS in front of it. Easiest is
[Caddy](https://caddyserver.com): point a domain at the VPS, edit `deploy/Caddyfile`, and
`sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

**No domain?** Use an SSH tunnel instead and set `LOGGER_SECURE_COOKIE=0` in the service file:

```bash
ssh -L 8765:127.0.0.1:8765 you@your-vps     # then open http://127.0.0.1:8765
```

### Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `LOGGER_HOST` | `127.0.0.1` | bind address |
| `LOGGER_PORT` | `8765` | port |
| `LOGGER_DB` | `./data/logger.db` | database file |
| `LOGGER_PASSWORD` | – | initial password if none is set (handy for Docker-style setups) |
| `LOGGER_SECURE_COOKIE` | `0` | set `1` when served over HTTPS |
| `LOGGER_ACCESS_LOG` | `0` | set `1` to log every request |

## Obsidian sync

If you run Obsidian with the **Self-hosted LiveSync** plugin, Sakura Log can write your logs into the
vault as one note per month, e.g. `Time Log/1405-07 Mehr.md`. Each note has a per-project summary and a
table per day, newest first. Notes are rewritten a few seconds after you log or edit time, and LiveSync
delivers them to every device.

Set it up in **Settings → Obsidian sync**:

1. **CouchDB URL.** Use the address Sakura Log can reach from the VPS. If CouchDB runs in Docker with its port
   published, that's usually `http://127.0.0.1:5984`. If it's only on a Docker network, publish the port to
   localhost (`-p 127.0.0.1:5984:5984`).
2. **Database, username and password.** Use the same ones you entered in the LiveSync plugin.
3. Press **Test connection**, then turn sync **On**. **Sync all now** rewrites every month from scratch.

Things to know:

- **Encryption:** only vaults *without* end-to-end encryption or path obfuscation are supported. Sakura Log
  checks this before every write and refuses otherwise, so it can't corrupt an encrypted vault.
- **Sakura Log owns these notes:** anything you type into them is overwritten on the next change.
- **Calendar and timezone:** months follow your main calendar (Shamsi or Gregorian), and days follow your
  browser's timezone.
- **Moving or deleting notes:** notes are never deleted. A month whose entries you delete becomes a stub note.
  If you delete or move a note inside Obsidian, press **Sync all now** to recreate it.

## Wallpapers

Put your favourite anime art in `static/wallpapers/` and set the wallpaper in **Settings** to
`wallpapers/your-file.jpg` (or paste any image URL). The UI stays readable thanks to frosted-glass cards.

## Backups

Everything is in `data/logger.db`. Copy it (`sqlite3 data/logger.db ".backup backup.db"`), or use
**Settings → Download backup** for a JSON dump.

## Security notes

- Single password, 30-day `HttpOnly` + `SameSite=Strict` session cookie; changing the password logs out other sessions.
- Login is throttled (10 failures per 15 minutes).
- The API only accepts JSON bodies, which blocks cross-site form posts.
