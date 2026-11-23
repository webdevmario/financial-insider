/**
 * Loads the app database's rows for the holdings math in compute.ts. The read-only MCP has its own
 * loader (mcp/queries.ts) over node:sqlite; both feed the same pure functions.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { accounts, holdings, securities, settings } from "../../db/schema.js";
import { TARGETS_KEY, holdingsOverview, parseTargets, type InvestmentTargets } from "./compute.js";

export * from "./compute.js";

export function loadTargets(): InvestmentTargets {
  const row = db.select().from(settings).where(eq(settings.key, TARGETS_KEY)).get();
  let raw: unknown = null;
  try {
    raw = row ? JSON.parse(row.value) : null;
  } catch {
    raw = null;
  }
  return parseTargets(raw);
}

export function overview(asOf?: string) {
  return holdingsOverview({
    securities: db.select().from(securities).all(),
    holdings: db.select().from(holdings).all(),
    accounts: db.select({
      id: accounts.id, type: accounts.type, owner: accounts.owner, institution: accounts.institution,
      balance: accounts.balance, lastUpdated: accounts.lastUpdated,
    }).from(accounts).all(),
    targets: loadTargets(),
    asOf,
  });
}
