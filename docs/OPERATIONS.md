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
3. **Node version changed** — if you switched Node versions via nvm, the service may need a restart
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
cp data/finance.db data/finance-backup-$(date +%Y%m%d).db
```

Consider a weekly cron job:

```bash
crontab -e
# Add this line:
0 3 * * 0 cp ~/Documents/development/projects/financial-insider/data/finance.db ~/Documents/development/projects/financial-insider/data/backups/finance-$(date +\%Y\%m\%d).db
```

(Create `data/backups/` first: `mkdir -p data/backups`)

### Restoring from backup

**From JSON:** Settings → Import in the app.

**From .db file:**

```bash
# Stop the server first
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.financial-insider.plist

# Replace the database
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
# If you changed frontend code
cd frontend
pnpm build

# If you changed backend code or schema
cd backend
pnpm db:push          # Only if schema changed

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
| Backup database | `cp data/finance.db data/finance-backup-$(date +%Y%m%d).db` |
| Rebuild frontend | `cd frontend && pnpm build` |
| Push schema changes | `cd backend && pnpm db:push` |
| Start dev (backend) | `cd backend && pnpm dev` |
| Start dev (frontend) | `cd frontend && pnpm dev` |
