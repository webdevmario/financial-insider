# Operations Guide

Everything you need to manage Financial Insider on your Mac Mini.

---

## How It All Fits Together

```
┌─────────────────────────────────────────────────────────┐
│                      Mac Mini                            │
│                                                          │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │   Express    │───▶│   SQLite DB   │    │  Tailscale │  │
│  │  (port 3001) │    │  data/finance │    │   (VPN)    │  │
│  │             │    │     .db       │    │            │  │
│  │  serves API  │    └──────────────┘    └─────┬──────┘  │
│  │  + frontend  │                              │         │
│  └──────┬───────┘                              │         │
│         │                                      │         │
└─────────┼──────────────────────────────────────┼─────────┘
          │                                      │
          ▼                                      ▼
   http://100.x.x.x:3001              Private Tailscale network
   (only accessible via Tailscale)     (your devices only)
```

There are three pieces running:

1. **Express server** — serves the app and API on port 3001
2. **SQLite database** — a single file at `data/finance.db` that stores everything
3. **Tailscale** — creates a private network so your devices can reach the Mac Mini

The Express server is managed by **launchd** (macOS's built-in service manager) so it starts automatically on boot.

---

## Development vs. Production

This is the most important distinction to understand.

### Production (what runs all the time)

- The **launchd service** runs the Express backend, which serves both the API and the pre-built frontend from `backend/public/`
- This is what you and your wife use day-to-day at `http://100.x.x.x:3001`
- The frontend is static files built by Vite — no Vite server running

### Development (when you're working on code)

- You stop the production service
- You run the backend manually (`pnpm dev` in backend/)
- You run Vite's dev server (`pnpm dev` in frontend/) which gives you hot reload
- Vite proxies `/api` calls to the backend automatically
- You work at `http://localhost:5173`

### Switching Between Them

**To start developing:**

```bash
# Stop the production service
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist

# Start backend in dev mode
cd ~/Documents/development/projects/financial-insider/backend
pnpm dev

# In another terminal, start frontend dev server
cd ~/Documents/development/projects/financial-insider/frontend
pnpm dev

# Work at http://localhost:5173
```

**To go back to production:**

```bash
# Stop your dev servers (Ctrl+C in both terminals)

# Rebuild the frontend (if you made changes)
cd ~/Documents/development/projects/financial-insider/frontend
pnpm build

# Kill anything on port 3001 just in case
lsof -ti:3001 | xargs kill -9 2>/dev/null

# Restart the production service
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist

# Verify it's running
cat /tmp/financial-insider.log
```

**Key rule:** Always rebuild the frontend (`pnpm build`) before restarting production if you changed any frontend code. The production server serves the built files from `backend/public/`, not the source files.

---

## launchd (Service Management)

launchd is macOS's system for running background services. The config file (called a "plist") lives at:

```
~/Library/LaunchAgents/com.financial-insider.plist
```

### What the plist does

- **RunAtLoad: true** — starts the server when you log in (or when the plist is loaded)
- **KeepAlive: true** — restarts the server automatically if it crashes
- **ProgramArguments** — the actual command: loads nvm, cd's to the backend, runs the server
- **StandardOutPath / StandardErrorPath** — logs go to `/tmp/financial-insider.log` and `/tmp/financial-insider-error.log`

### Common Commands

```bash
# Stop the service
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist

# Start the service
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist

# Check if it's running
launchctl list | grep financial

# If it shows a PID (number), it's running. If status is non-zero, something's wrong.

# View logs
cat /tmp/financial-insider.log
cat /tmp/financial-insider-error.log

# Full restart (stop + clear logs + start)
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
> /tmp/financial-insider.log
> /tmp/financial-insider-error.log
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist
```

### If you need to edit the plist

The plist is at `~/Library/LaunchAgents/com.financial-insider.plist`. If you move the project folder, update the nvm path, or change the port, edit it:

```bash
nano ~/Library/LaunchAgents/com.financial-insider.plist
```

After editing, do a full restart (bootout then bootstrap).

### If launchd won't start the service

Common causes:

1. **Port in use** — something else is on 3001. Run `lsof -ti:3001 | xargs kill -9`
2. **nvm path wrong** — check `echo $NVM_DIR` and make sure the plist matches
3. **Node version changed** — the service runs nvm's *default* Node. The SQLite driver is a native module built for one Node version, so after changing the default (`nvm alias default …`) reinstall it, then restart:
   ```bash
   pnpm rebuild better-sqlite3   # from the repo root
   ```
   The error log (`pnpm prod:errors`) shows `NODE_MODULE_VERSION` mismatches when this is the problem.
4. **Plist syntax error** — validate with `plutil ~/Library/LaunchAgents/com.financial-insider.plist`

---

## Tailscale

### How it works

Tailscale creates a private VPN between your devices. Every device gets a `100.x.x.x` IP that only your other Tailscale devices can reach. No ports are exposed to the public internet.

### Your Mac Mini's IP

```bash
tailscale ip
```

This IP is stable — it won't change unless you remove and re-add the device.

### Adding devices

1. Install Tailscale on the device (App Store for iOS, brew for Mac)
2. Sign in with the same account
3. The device can now reach `http://100.x.x.x:3001`

### Adding your wife

Two options:

- **Same account:** She signs into Tailscale with your shared credentials. Simplest.
- **Separate user:** Go to https://login.tailscale.com/admin → Users → Invite. She gets her own login. More proper but same result.

### Tailscale admin

Manage devices, see who's connected: https://login.tailscale.com/admin

### If the app isn't reachable from a device

1. Make sure Tailscale is active on both the Mac Mini and the device (check the menu bar icon / phone app)
2. Try pinging the Mac Mini: `ping 100.x.x.x`
3. Check the server is running: `curl http://100.x.x.x:3001/api/dashboard/summary`
4. If the server isn't responding, check launchd (see section above)

---

## Offline Mode (Phone App)

The app installs on a phone's home screen and keeps working when the Mac Mini can't be reached (bad cell signal, Tailscale disconnected, Mac asleep).

### What works offline

- **Opens normally:** the app itself is cached on the phone by a service worker
- **Every screen shows its last-loaded data:** a banner says it's offline and when it last connected
- **Expenses can be added, edited, and deleted:** changes are saved on the phone, marked "not synced", and sent to the Mac in order once it answers
- **Needs a connection:** accounts, bills, settings, budget targets, notes, reimbursements, import/export

### How syncing works

- The app pings `/api/health` (4s timeout) to decide if the connection is good enough. The phone's own "online" status isn't trusted: one bar of signal still counts as online.
- It tries to sync when the app opens, comes back to the foreground, or regains network, and every 20s while changes are waiting.
- **Android (Chrome):** Background Sync also sends queued changes when the network comes back, even if the app is closed.
- **iPhone:** iOS has no Background Sync, so changes go out the next time the app is open with a connection.
- If two people edit the same expense, the more recent edit wins (by `updated_at`). Re-sending an expense never creates a duplicate.

### HTTPS is required

Service workers only run on HTTPS (or localhost), so the plain `http://100.x.x.x:3001` address has **no offline mode**. Tailscale Serve provides HTTPS with a real certificate, still visible only to your tailnet. `/` on this Mac is already used by another app (port 5530), so Financial Insider gets port 8443:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:3001
tailscale serve status
```

The app is then at **https://shady-mac-mini.taila545c3.ts.net:8443**. This setting persists across reboots. To remove it: `tailscale serve --https=8443 off`.

### Installing on the phones

Use the HTTPS address above on each phone, not the old `100.x` one. Offline storage is tied to the address.

- **Pixel (Chrome):** open the address, tap **Install app** in the top bar (or ⋮ → *Install app*). In the Tailscale app, turn on **Always-on VPN** (Android Settings → Network → VPN → Tailscale ⚙️) so syncing doesn't depend on opening Tailscale.
- **iPhone (Safari):** open the address → Share → **Add to Home Screen**. Use the home-screen icon, not a Safari tab: Safari can clear a website's saved data after 7 days without a visit, but installed apps are exempt.

The phone needs to load the app once on a good connection, and visit each screen once, before those screens work offline.

### Updates

After `pnpm prod:deploy`, phones download the new version in the background and switch to it the next time the app is opened.

---

## Database

### Where it lives

```
~/Documents/development/projects/financial-insider/data/finance.db
```

This single file IS your entire database. It contains all accounts, bills, expenses, and settings.

### Backups

**From the app:** Settings → Export gives you a JSON backup you can re-import later.

**File-level backup** (more thorough):

```bash
pnpm db:backup    # → data/backups/finance-YYYYMMDD.db
```

This uses SQLite's `.backup` command rather than `cp`. The database runs in WAL mode, so recent writes can live in `finance.db-wal` until they're checkpointed — a plain `cp` of `finance.db` can silently miss them. `.backup` produces a consistent snapshot even while the server is running.

Consider a weekly cron job:

```bash
crontab -e
# Add this line:
0 3 * * 0 cd ~/Documents/development/projects/financial-insider && /usr/bin/sqlite3 data/finance.db ".backup data/backups/finance-$(date +\%Y\%m\%d).db"
```

(Create `data/backups/` first: `mkdir -p data/backups`)

### Restoring from backup

**From JSON:** Settings → Import in the app.

**From .db file:**

```bash
# Stop the server first
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist

# Replace the database (remove stale WAL files so they aren't replayed onto the restored copy)
rm -f data/finance.db-wal data/finance.db-shm
cp data/backups/finance-20260301.db data/finance.db

# Restart
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist
```

### Schema changes

If you modify `backend/src/db/schema.ts` (add columns, tables, etc.):

```bash
cd backend
pnpm db:push
```

Drizzle will apply the changes to your existing database without losing data (for additive changes like new columns).

---

## Updating the App

After making code changes:

```bash
# If any package.json changed: install from the repo root. The root workspace
# owns node_modules for both packages, and it downloads native modules
# (better-sqlite3) built for the current Node version.
pnpm install

# If you changed frontend code
cd frontend
pnpm build

# If you changed the schema
cd backend
pnpm db:push

# Restart production
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist

# Verify
cat /tmp/financial-insider.log
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Start production | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist` |
| Stop production | `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist` |
| Check if running | `launchctl list \| grep financial` |
| View logs | `cat /tmp/financial-insider.log` |
| View errors | `cat /tmp/financial-insider-error.log` |
| Kill port 3001 | `lsof -ti:3001 \| xargs kill -9` |
| Get Tailscale IP | `tailscale ip` |
| Backup database | `pnpm db:backup` |
| Rebuild frontend | `cd frontend && pnpm build` |
| Push schema changes | `cd backend && pnpm db:push` |
| Start dev (backend) | `cd backend && pnpm dev` |
| Start dev (frontend) | `cd frontend && pnpm dev` |
