# Financial Insider

Self-hosted household finance tracker. Runs on the Mac mini (port 3001, launchd) and is reached over Tailscale. How it runs, deploys and backs up: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Layout

- `backend/`: Express, Drizzle ORM, better-sqlite3. Database is `data/finance.db` (never committed).
  - `src/db/schema.ts` defines the tables. `src/db/index.ts` creates newer tables and columns at server start (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE`), so a restart applies them.
  - `src/routes/`: one router per tab, mounted in `src/index.ts`.
  - `src/lib/`: pure compute shared by the app and the MCP (`holdings/`, `cars/`, `statements/`, `bills.ts`).
  - `src/mcp/`: the read-only Claude MCP server (`server.ts` tools, `queries.ts` queries over `node:sqlite` read-only).
- `frontend/`: React 19, TypeScript, Vite, Tailwind, installable PWA. Views in `src/components/<tab>/`, API client in `src/lib/api.ts`, types in `src/types/`.
- pnpm workspace: install from the repo root.

## Conventions

- **Public repo.** No amounts, balances, holdings, payees, banks or account names in code, commits, PRs or this file. Private plans live in `~/.claude/planning/financial-insider/`.
- Deploy after a merge: `pnpm prod:deploy` from the main checkout on `main` (build, install the MCP, restart). New MCP tools show up only in Claude sessions started after that.
- Balances on the Assets page are updated by hand on the 1st. Investments snapshots are separate and don't change them.
- UI copy: plain, short, no em dashes.

## Gotchas

- Test against a copy, never the real DB: `sqlite3 data/finance.db ".backup '<scratch>.db'"`, then run the backend with `DB_PATH=<scratch>.db PORT=310x STATEMENTS_WATCH=0`.
- `pnpm install` and builds touch `frontend/tsconfig.tsbuildinfo` (and sometimes `backend/pnpm-lock.yaml`). Revert them before committing.
- Backend `tsc` prints TS2742/TS4023 declaration warnings on every router. They're harmless; look for other errors.
- The PWA service worker caches old builds. After a deploy, reload once; in a test browser, unregister the worker.
- A worktree has no `node_modules` until `pnpm install --frozen-lockfile`.

## Open work (as of 2026-11-27)

1. **Investments tab, first use on 2026-12-01.** Merged and deployed in PR #58. Nothing is saved yet. Next: a snapshot per investment account and keep / watch / remove on each security. The plan and checklist are private: `~/.claude/planning/financial-insider/README.md`, section "Next session: Dec 1, 2026".
2. **Savings bucket math on 2026-12-01.** Private, no code: same README section. May need a fresh savings CSV import, since imported savings data is out of date.
3. **Branch and worktree cleanup.** Unmerged: `claude/alias-suggestion`, `claude/transaction-date` (both 2026-11-15), `claude/financial-insider-review-ce4615` (2026-09-28). Seven worktrees under `.claude/worktrees/`. Run `~/Documents/claude/bin/status financial-insider` and ask Mario before deleting anything.
4. **Card rewards fix waiting on Mario** (REVIEW D in `~/Documents/claude/under-review/REVIEW.md`): the cards page overstates one card's rewards.
5. **UI refresh against `~/Documents/claude/projects/design-md/DESIGN.md`.** Phase 1 (colour tokens, contrast, focus rings, input borders) is on branch `claude/design-md-financial-insider-f2aabe`. Next phases: (2) type scale: replace the ad hoc `text-[11px]`-style sizes with a few named sizes, weights 400 and 600 only; (3) components: 48px targets on IconButton, Segmented and the bottom nav, outline icons instead of emoji, button types, icons on alerts; (4) per tab: brand colour only on things you can click (StatCard bars, `text-accent` headings, progress bars), copy and hierarchy.

## Decided against

- Live prices or broker connections for investments. Snapshots are typed in on the 1st.
- Trading or moving money from any tool. The MCP is read-only.

## Keeping these notes

Update `## Open work` in the same PR as the work. Dates as YYYY-MM-DD. The cross-project board is `~/Documents/claude/BOARD.md`.
