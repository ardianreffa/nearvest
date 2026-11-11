# Deploying the NEARvest game server to the VPS

VPS: `ssh ubuntu@150.109.24.35` (Ubuntu 22.04, 2 cores, 1.9 GB RAM, Asia/Jakarta time).
Public address: `https://150-109-24-35.sslip.io` (Caddy + Let's Encrypt).

**Other bots share this VPS. Entropy (the most important one) must never be touched.**
Checked read-only on 2026-11-08:

- Entropy runs as `entropy-bot` under **pm2** (Python `main.py` in `/home/ubuntu/entropy`) plus two
  cron jobs (00:00 and 00:05). pm2 itself runs on the global Node (`/usr/bin/node`, v24.22.0 from
  NodeSource), and the running pm2 still uses an older Node file that apt replaced (shown as
  "deleted").
- `needrestart` is set to **restart services automatically** after any `apt install`. It would
  restart `pm2-ubuntu.service` (because of that replaced Node file), which restarts Entropy.
- Ports 80, 443 and 8787 are free; no bot listens on any port. ufw is off. No Caddy, nginx, Docker.
- Free: about 1.1 GB RAM (plus swap), 27 GB disk.

## Safety rules (every step)

1. **No apt** (no `apt install`, `apt upgrade`, `apt update` + install): needrestart would restart pm2
   and Entropy. Node and Caddy come as plain files in `/opt/nearvest`.
2. **Never change the global Node, npm or pm2.** Never run `pm2` commands. NEARvest uses its own Node
   in `/opt/nearvest/node`.
3. **No ufw changes** (could cut SSH or the bots' connections). Ports 80/443 are opened in the Tencent
   Cloud security group by Ardian; the game server listens on 127.0.0.1 only.
4. NEARvest runs as its own users (`nearvest`, `nearvest-caddy`) with no access to `/home`, with
   memory and CPU limits (server 300 MB / 60% of one core, Caddy 120 MB / 40%, backup 150 MB / 30%,
   lowest priority).
5. Secrets (`server/.env`) go from the Mac straight into a root-only file over SSH: never shown on
   screen, never in a log, never in a commit.
6. Before and after every step that changes the VPS: check that Entropy is still online with the same
   restart count (read-only): `pm2 jlist` is NOT used; instead
   `ps -o pid,etime,cmd -C python3 | grep main.py` (same PID and growing uptime = untouched).
7. Every step below that changes the VPS starts with **STOP: ask Ardian**.

Folders on the VPS:

| Path | What | Owner |
|---|---|---|
| `/opt/nearvest/node` | Node 24.22.0 (linux-x64), only for NEARvest | root |
| `/opt/nearvest/caddy/caddy` | Caddy 2.11.9 (single program) | root |
| `/opt/nearvest/releases/nearvest-<commit>` | server code + production node_modules + deploy files | root |
| `/opt/nearvest/app` | link to the release in use (switching it = update / rollback) | root |
| `/etc/nearvest/server.env` | secrets, copied from the Mac's `server/.env` | root, 0600 |
| `/var/lib/nearvest` | the database (`nearvest.sqlite`) | nearvest, 0700 |
| `/var/backups/nearvest` | daily backups (14 kept) | nearvest, 0700 |
| `/var/lib/nearvest-caddy` | Caddy's certificates | nearvest-caddy, 0700 |

Files in this repo: `deploy/nearvest.service`, `deploy/nearvest-caddy.service`, `deploy/Caddyfile`,
`deploy/nearvest-backup.service` + `.timer`, `deploy/production.env` (non-secret overrides; systemd
reads it after the secrets, so it wins), `deploy/stage.sh` (builds a release on the Mac),
`server/scripts/backup-db.ts`.

## Step 1 (done 2026-11-08): deploy files, tested on the Mac

Backup tests (`server/test/backup.test.ts`), a staged release started with Node 24.22.0 in fake-chain
mode (`/health` ok), the backup service command run from the staged release.

## Deployed 2026-11-08

Steps 2-9 done on 2026-11-08 (each with Ardian's OK; Entropy stayed PID 1904180 throughout). Server: `https://150-109-24-35.sslip.io` (release `nearvest-1a2fa33`, `/opt/nearvest/app`), web: `https://nearvest-six.vercel.app` (Vercel, root `web/`, `VITE_API_URL=https://150-109-24-35.sslip.io`). Backups daily at 03:30 in `/var/backups/nearvest`. Step 10 (playing on the live site) is Ardian's.

**Entropy reference PID (for the read-only check in rule 6): 4077255** since 2026-11-10 11:49 WIB (Ardian restarted Entropy himself to fix the bot, not because of NEARvest); before that 3665978 (2026-11-09) and 1904180.

Latest release: `nearvest-fd0112c` (2026-11-11 22:05 WIB: "Move to Memorials" (`POST /api/memorial/move`, `memorial.movable` in the plot view) plus the web of the same evening (rain that reaches the screen's edges, fishing corner, shorter laptop plot bar, watering drone from the hat / orbit, no hotspot hover box); **no database change** (no new table or column); `/etc/nearvest/server.env` unchanged (`ARENA_ONLINE=on` stays); rollback: `nearvest-eca6005` (runs on the same database, checked on a copy; no restore needed; backup before the release: `nearvest-2026-11-11T22-04-46.sqlite`). Node 24.22.0 for staging re-downloaded and checked against nodejs.org SHASUMS256. Entropy stayed PID 4077255.

Previous release: `nearvest-eca6005` (2026-11-11 19:02 WIB: Arena online duel (v3 part 2) with the `ARENA_ONLINE` switch, judge gardens linked by a friendship in Farmers of Tandur, "?" pick bubbles + "Last turn:"; adds 9 nullable / DEFAULT columns to `arena_matches` only, nothing removed); `ARENA_ONLINE=on` was added as the last line of `/etc/nearvest/server.env` (copy of the file before: `/etc/nearvest/server.env.before-arena-online`, root-only); rollback: `nearvest-b7edf49` (works on the upgraded database: it ignores the new columns, no restore needed; backup before the release: `nearvest-2026-11-11T19-00-01.sqlite`).

**Turn the online duel off** (no code change, no database change): `ssh ubuntu@150.109.24.35 'sudo sed -i "s/^ARENA_ONLINE=on$/ARENA_ONLINE=off/" /etc/nearvest/server.env && sudo grep -n ^ARENA_ONLINE /etc/nearvest/server.env && sudo systemctl restart nearvest'`, then check `curl -s https://150-109-24-35.sslip.io/api/config` shows `"arenaOnline":false` (and the log line `[arena] online duel: off`). The Duel button then fights only the other garden's TaniBot (Arena v2). Turn it on again the same way with `off` -> `on`. Never print the whole file (it holds secrets).

Before that: `nearvest-b7edf49` (2026-11-11 17:08 WIB: Add friend + Online dot, labels with stepped corners, visit wipe + pixel sparkle sound; adds the tables `friends`, `friend_adds` (3 indexes) and the column `players.active_at` DEFAULT 0, nothing removed); its rollback was `nearvest-edfb355` (works on the upgraded database: it ignores the new tables and column, no restore needed; backup before that release: `nearvest-2026-11-11T17-05-29.sqlite`). Older: `nearvest-e8312ea` (2026-11-11 11:12 WIB: Arena v1; ignores `arena_matches`; backup before `nearvest-edfb355`: `nearvest-2026-11-11T15-22-49.sqlite`), `nearvest-da0cbea` (2026-11-11 morning: before the Arena; ignores `arena_duels` / `arena_matches`), `nearvest-63c8c17` (2026-11-10: Market / Shop dots, columns `players.fruit_at` / `market_seen_at`), `nearvest-08d00e3`, `nearvest-69becf1`.

## Step 2: read-only check right before deploying (no change)

```sh
ssh ubuntu@150.109.24.35 'ss -tlnH "( sport = :80 or sport = :443 or sport = :8787 )"; free -m; df -h /;
  ps -o pid,etime,cmd -C python3 | grep main.py; systemctl is-active pm2-ubuntu'
```
Expected: no line for ports 80/443/8787, about 1 GB available, Entropy's `main.py` running (write down
its PID). Ardian confirms ports 80/443 are open in the Tencent security group.

## Step 3: users and folders - STOP: ask Ardian

```sh
ssh ubuntu@150.109.24.35 'sudo useradd --system --no-create-home --shell /usr/sbin/nologin nearvest &&
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin nearvest-caddy &&
  sudo install -d -m 0755 -o root -g root /opt/nearvest /opt/nearvest/releases /opt/nearvest/caddy &&
  sudo install -d -m 0700 -o root -g root /etc/nearvest &&
  sudo install -d -m 0700 -o nearvest -g nearvest /var/lib/nearvest /var/backups/nearvest &&
  sudo install -d -m 0700 -o nearvest-caddy -g nearvest-caddy /var/lib/nearvest-caddy'
```
Changes nothing that exists; adds two system users (no login) and empty folders.

## Step 4: NEARvest's own Node and Caddy - STOP: ask Ardian

On the Mac (download and verify; the SHA256 / SHA512 must match the official lists):
- `node-v24.22.0-linux-x64.tar.xz`, SHA256 `cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008`
  (from https://nodejs.org/dist/v24.22.0/SHASUMS256.txt).
- `caddy_2.11.9_linux_amd64.tar.gz`, checked against `caddy_2.11.9_checksums.txt` of the GitHub release.

Copy and unpack into `/opt/nearvest/node` and `/opt/nearvest/caddy` (root-owned):
```sh
ssh ubuntu@150.109.24.35 'sudo install -d -m 0755 /opt/nearvest/node && sudo tar -xJf - -C /opt/nearvest/node --strip-components=1 --no-same-owner' < node-v24.22.0-linux-x64.tar.xz
ssh ubuntu@150.109.24.35 'sudo tar -xzf - -C /opt/nearvest/caddy --no-same-owner caddy' < caddy_2.11.9_linux_amd64.tar.gz
ssh ubuntu@150.109.24.35 '/opt/nearvest/node/bin/node -v; /opt/nearvest/caddy/caddy version; /usr/bin/node -v'
```
Expected: v24.22.0, v2.11.9, and the global Node still v24.22.0 (unchanged). No PATH change, no
link in /usr/bin.

## Step 5: stop the Mac server, copy the release, secrets and database - STOP: ask Ardian

1. On the Mac: stop the NEARvest server (`npm run dev` window: Ctrl+C) and make sure nothing listens on
   8787 (`lsof -iTCP:8787 -sTCP:LISTEN` shows nothing). From now on only the VPS signs with
   `game.nearvest.testnet` (two servers with the same key would clash).
2. Final clean copy of the Mac database (consistent single file):
   `cd server && node scripts/backup-db.ts --dir ../backups/db-before-vps` (git-ignored folder).
3. Stage and copy the release (nothing secret in it):
   ```sh
   sh deploy/stage.sh ~/nearvest-releases ~/node-v24.22.0-darwin-arm64/bin   # prints the folder
   tar -C ~/nearvest-releases/nearvest-<commit> -czf - . | ssh ubuntu@150.109.24.35 'sudo install -d -m 0755 /opt/nearvest/releases/nearvest-<commit> && sudo tar -xzf - -C /opt/nearvest/releases/nearvest-<commit> --no-same-owner'
   ssh ubuntu@150.109.24.35 'sudo ln -sfn /opt/nearvest/releases/nearvest-<commit> /opt/nearvest/app && ls /opt/nearvest/app/server/src/main.ts'
   ```
4. Secrets, streamed straight into a root-only file (never shown, no temporary copy):
   `ssh ubuntu@150.109.24.35 'sudo install -m 0600 -o root -g root /dev/stdin /etc/nearvest/server.env' < server/.env`
   Check only the variable NAMES arrived: `ssh ubuntu@150.109.24.35 'sudo cut -d= -f1 /etc/nearvest/server.env | grep -v "^#" | sort | tr "\n" " "'`.
5. Database, streamed the same way (the backup file from 2.):
   `ssh ubuntu@150.109.24.35 'sudo install -m 0600 -o nearvest -g nearvest /dev/stdin /var/lib/nearvest/nearvest.sqlite' < backups/db-before-vps/nearvest-<time>.sqlite`

## Step 6: start the game server - STOP: ask Ardian

```sh
ssh ubuntu@150.109.24.35 'sudo install -m 0644 /opt/nearvest/app/deploy/nearvest.service /etc/systemd/system/ &&
  sudo systemd-analyze verify /etc/systemd/system/nearvest.service &&
  sudo systemctl daemon-reload && sudo systemctl enable --now nearvest &&
  sleep 3; systemctl is-active nearvest; curl -s 127.0.0.1:8787/health; journalctl -u nearvest -n 20 --no-pager'
```
`daemon-reload` only reads unit files; it restarts nothing. Expected: `active`, `{"ok":true}`, the
log line "NEARvest server on http://127.0.0.1:8787 (chain: near, dev login: false)" and the chain
worker picking up pending jobs. Check Entropy (same PID). Check memory: `systemctl status nearvest`
(Memory under 300 MB).

## Step 7: HTTPS with Caddy - STOP: ask Ardian

```sh
ssh ubuntu@150.109.24.35 '/opt/nearvest/caddy/caddy validate --config /opt/nearvest/app/deploy/Caddyfile --adapter caddyfile &&
  sudo install -m 0644 /opt/nearvest/app/deploy/nearvest-caddy.service /etc/systemd/system/ &&
  sudo systemctl daemon-reload && sudo systemctl enable --now nearvest-caddy &&
  sleep 10; journalctl -u nearvest-caddy -n 30 --no-pager'
curl -s https://150-109-24-35.sslip.io/health     # from the Mac: {"ok":true}
```
If the certificate fails: ports 80/443 are not open in the Tencent security group yet.

## Step 8: daily backup - STOP: ask Ardian

```sh
ssh ubuntu@150.109.24.35 'sudo install -m 0644 /opt/nearvest/app/deploy/nearvest-backup.service /opt/nearvest/app/deploy/nearvest-backup.timer /etc/systemd/system/ &&
  sudo systemctl daemon-reload && sudo systemctl enable --now nearvest-backup.timer &&
  sudo systemctl start nearvest-backup.service && journalctl -u nearvest-backup -n 5 --no-pager &&
  systemctl list-timers nearvest-backup.timer --no-pager'
```
Expected: "backup ok: /var/backups/nearvest/nearvest-<time>.sqlite (... gardens)" and the next run at
03:30. MASTER_KEY stays in Ardian's private backup, never next to these files.

## Step 9: web on Vercel and Google login (Ardian + Mac; VPS only for WEB_ORIGINS)

1. Vercel project root `web/`, environment variable `VITE_API_URL=https://150-109-24-35.sslip.io`.
2. Put the Vercel address in `deploy/production.env` (`WEB_ORIGINS=https://<vercel-address>`), commit,
   stage a new release (step 5.3), switch `/opt/nearvest/app` to it and `sudo systemctl restart nearvest`
   - **STOP: ask Ardian** (restarts only NEARvest).
3. Google Cloud Console: add the Vercel address to "Authorized JavaScript origins"; on the OAuth consent
   screen use `https://<vercel-address>/privacy` and `/terms`.

## Step 10: final checks (read-only)

- Google login, wallet login, Try as Judge, one harvest + sale + Shop purchase on the Vercel site; the
  transactions land on testnet (toast with nearblocks link).
- `free -m` (still about 0.9 GB available), `systemctl status nearvest nearvest-caddy` (memory), Entropy's
  `main.py` still the same PID, `systemctl is-active pm2-ubuntu`.

## Updating later

Stage a new release on the Mac (step 5.3), point `/opt/nearvest/app` at it, `sudo systemctl restart nearvest`.
**Rollback**: point the link back at the previous release folder and restart. To remove NEARvest
completely: `sudo systemctl disable --now nearvest nearvest-caddy nearvest-backup.timer` (Entropy unaffected).
