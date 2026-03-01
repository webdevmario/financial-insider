# Financial Insider

A self-hosted personal finance tracker. Tracks net worth, assets, monthly bills, and budget expenses across devices via Tailscale.

## Tech Stack

- **Frontend:** React 19 · TypeScript · Vite · Tailwind CSS
- **Backend:** Node.js · Express · Drizzle ORM
- **Database:** SQLite (via better-sqlite3)
- **Networking:** Tailscale (private mesh VPN)
- **Hosting:** Mac Mini with launchd auto-start

## Quick Start

### Prerequisites

- Node.js 20+ (via nvm)
- pnpm (`brew install pnpm`)

### Development

```bash
# Terminal 1 — Backend
cd backend
pnpm install
pnpm db:push          # First time only: creates database tables
pnpm dev              # API on http://localhost:3001

# Terminal 2 — Frontend
cd frontend
pnpm install
pnpm dev              # Dev server on http://localhost:5173 (proxies /api → :3001)
```

### Production

```bash
cd frontend
pnpm build            # Outputs to backend/public/

cd ../backend
pnpm dev              # Serves API + frontend on http://localhost:3001
```

### Seed Existing Data

If migrating from the old single-file app:

1. Open old app → Settings → Export (JSON backup)
2. Save as `data/export.json`
3. Run `cd backend && pnpm seed`

## Project Structure

```
financial-insider/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.ts       # Drizzle table definitions
│   │   │   ├── index.ts        # DB connection
│   │   │   └── seed.ts         # Import from old app
│   │   ├── routes/
│   │   │   ├── accounts.ts     # Asset CRUD
│   │   │   ├── expenses.ts     # Budget expense CRUD
│   │   │   ├── subscriptions.ts # Bill CRUD
│   │   │   └── settings.ts     # Settings, dashboard, import/export
│   │   └── index.ts            # Express entry point
│   ├── public/                  # Frontend build output (gitignored)
│   ├── drizzle.config.ts
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/         # React views and forms
│   │   ├── hooks/useApi.ts     # Data fetching hook
│   │   ├── lib/api.ts          # API client
│   │   ├── lib/formatters.ts   # Currency/date formatting
│   │   ├── types/index.ts      # Shared TypeScript types
│   │   └── App.tsx             # Root component with navigation
│   ├── vite.config.ts          # Proxies /api to backend in dev
│   └── package.json
├── data/
│   └── finance.db              # SQLite database (gitignored)
├── docs/
│   └── OPERATIONS.md           # How to manage hosting, backups, etc.
└── README.md
```

## Documentation

See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** for:

- How the production hosting works (launchd)
- Starting, stopping, and restarting the server
- How to switch between development and production
- Database backups
- Tailscale management
- Troubleshooting
