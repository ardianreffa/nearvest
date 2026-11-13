# Deploying the NEARvest game server

How the hosted demo runs, in general terms. The private operational details (server address, user
names, folders, secret and backup locations, release names, the other software on the server and how
to check it) are kept outside this repo. Maintainers: read `~/nearvest-private/OPS.md` before any
release or server step.

## Shape of the deployment

- **Web:** static site (`web/`) on Vercel, deployed on every push to `main`. `VITE_API_URL` points to the
  game server's public HTTPS address.
- **Game server:** one small Linux VPS shared with other software. The server (`server/`) runs on its own
  Node.js 24 (not the system Node), as its own system user, under systemd (`deploy/nearvest.service`),
  listening on 127.0.0.1 only, with memory and CPU limits.
- **HTTPS:** Caddy (`deploy/Caddyfile`, `deploy/nearvest-caddy.service`) with automatic Let's Encrypt
  certificates, reverse proxy to the game server. Caddy writes the visitor's IP as the last
  `X-Forwarded-For` entry (`server/src/client-ip.ts`).
- **Secrets:** the server's `.env` (game account key, `MASTER_KEY`, Google Client ID, API keys) is copied
  from the maintainer's computer straight into a root-only file on the server over SSH: never shown on
  screen, never in a log, never in a commit. `deploy/production.env` holds only non-secret settings and
  is read after the secrets, so its values win.
- **Database:** one SQLite file (`node:sqlite`). A daily systemd timer (`deploy/nearvest-backup.*`,
  `server/scripts/backup-db.ts`) makes a consistent copy and keeps the last 14.
- **Only one signer:** the game account key is used by exactly one running server. A local server must
  never run with the production key (local work uses `CHAIN_MODE=fake`).

## Safety rules

1. The server is shared: never stop, change or restart other software on it. Check it read-only
   before and after every change.
2. No system package installs or upgrades (they can restart other services). NEARvest's Node and Caddy
   are plain files in its own folder.
3. No firewall changes from the command line. The game server listens on 127.0.0.1 only.
4. Every step that changes the server needs the owner's explicit OK first.
5. Never print the secrets file; check only variable names or one line with `grep`.

## Releasing an update

1. Ask the owner. Read-only check of the other software on the server and of free memory.
2. Back up the database on the server (same command as the daily backup).
3. Stage a release on the maintainer's computer: `sh deploy/stage.sh <out-dir> <node-24-bin-dir>`
   (server code, production `node_modules`, deploy files; nothing secret).
4. Copy it into a new release folder on the server, point the "current release" link at it and restart
   only the NEARvest service.
5. Manual checks: `/health`, `/api/stats`, `/api/config` (switches), a signed-in route answering 401
   without a token, the service log (no errors), memory use, the Vercel deploy, the live site
   (`/`, `/play`), and the other software unchanged.
6. **Rollback:** point the link back at the previous release folder and restart the service. Releases
   are written so the previous one runs on the upgraded database (new tables / columns are ignored), so
   a rollback normally needs no database restore.

## Switches (no code change)

`FISHING=on|off` and `ARENA_ONLINE=on|off` in the server's secrets file. Change the one line, restart
only the NEARvest service, then check `/api/config` (`"fishing"`, `"arenaOnline"`).

## First setup (done 2026-11-08)

System users and folders, NEARvest's own Node 24 and Caddy (checksums verified against the official
lists), the release, the secrets and the database copied over SSH, then the three systemd units
(server, Caddy, backup timer), then the Vercel site and the Google OAuth origins. Each step was done
with the owner's OK.
