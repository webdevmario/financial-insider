import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  carCosts,
  findTransactions,
  investmentHoldings,
  listBills,
  merchantHistory,
  netWorth,
  overview,
  QueryError,
  runSql,
  spendingSummary,
  WEEKDAYS,
  type Db,
} from "./queries.js";

/**
 * The finance MCP: Financial Insider's data as read-only tools for Claude.
 * The connection is opened read-only, so nothing here can change the data;
 * imports, edits and deletes stay in the app.
 */

export interface McpDeps {
  db: Db;
  /** YYYY-MM-DD, for "days since"; defaults to the local date */
  today?: () => string;
  log?: (entry: Record<string, unknown>) => void;
}

export const serverInstructions = `Financial Insider is the household's private finance tracker: imported bank and card transactions
(Chase, Amex, Apple Card, Ally), bills, and hand-entered account balances. Every tool is read-only.

Amounts: negative = money out, positive = money in. "spent" fields are already flipped to positive dollars.
Kinds: spend, refund, fee, transfer (between own accounts, and card payments), income, interest. Spending
totals use spend + refund + fee, so refunds net out and transfers never double count.
Merchant names are cleaned up (payees), so one place has one name; query matches the merchant or the bank's
raw description. Restaurants are category "Dining". Call overview first to see categories, accounts and the
date range covered. Card data has a date but no time, and can't tell a dinner out from takeout.

For "where have we eaten / when did we last go": merchant_history with categories ["Dining"].
For "time to go back": add minVisits and sort "longest_ago". For "too soon": sort "recent".
For what the cars cost, their service history and mileage, or whether an upgrade makes sense: car_costs.
For investments (what each account holds, the mix against the targets, play money against its cap, and what's
marked keep, watch or remove): holdings.
For ad hoc questions the other tools can't answer, run_sql (read-only SELECT; schema in its description).

This is private financial data: don't send it to web searches or other services unless the user asks.`;

const SCHEMA_HINT = `Tables: transactions(id, account_id, date YYYY-MM-DD, month YYYY-MM, amount, description, merchant,
category, kind, member, payee_id), statement_accounts(id, institution, name, kind), payees(id, name, category, kind,
bill_id), subscriptions(name, category, frequency, amount, split_by, next_charge, status, state), accounts(type,
balance, owner, institution, home_value, mortgage_balance, last_updated), goals(name, target_amount, saved_amount,
deadline), credit_cards(name, issuer, annual_fee, reward_rates JSON), import_batches(file_name, imported_at),
vehicles(id, name, year, make, model, purchase_date, purchase_price, purchase_mileage, loan_amount, loan_rate, loan_months,
sold_date, sale_price, account_id), vehicle_documents(vehicle_id, status, doc_type, date, vendor, odometer, total, summary,
items JSON, transaction_id, paid_outside), vehicle_links(transaction_id, vehicle_id, share, cost_type),
vehicle_rules(match_type, match_value, cost_type, shares JSON, date_from, date_to), securities(id, symbol, name, kind,
asset_class, role, status, expense_ratio, why), holdings(account_id, security_id, as_of, shares, value, cost_basis, role).`;

type Result = CallToolResult;

function ok(data: Record<string, unknown>): Result {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

function fail(code: "invalid" | "internal", message: string): Result {
  const error = { code, message };
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error }) }], structuredContent: { error } };
}

// ── Shared argument shapes ────────────────────────────────────────

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const filters = {
  query: z.string().trim().min(1).max(200).optional().describe("Words in the merchant name or bank description."),
  categories: z.array(z.string().trim().min(1)).max(20).optional().describe('Exact category names, e.g. ["Dining"].'),
  kinds: z
    .array(z.enum(["spend", "refund", "fee", "transfer", "income", "interest"]))
    .optional()
    .describe("Transaction kinds to include."),
  from: date.optional().describe("On or after this date."),
  to: date.optional().describe("On or before this date."),
  weekdays: z.array(z.enum(WEEKDAYS)).optional().describe('Only these days of the week, e.g. ["Fri", "Sat"].'),
  account: z.string().trim().min(1).optional().describe("Statement account id from overview."),
  member: z.string().trim().min(1).optional().describe("Card member who made the purchase (contains)."),
  minSpent: z.number().min(0).optional().describe("Purchases of at least this many dollars."),
  maxSpent: z.number().min(0).optional().describe("Purchases of at most this many dollars."),
};

export function createServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: "financial-insider", title: "Financial Insider", version: "1.0.0" },
    { instructions: serverInstructions },
  );

  function tool<S extends z.ZodObject>(
    name: string,
    config: { title: string; description: string; inputSchema: S },
    handler: (args: z.output<S>) => Record<string, unknown>,
  ) {
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      // The SDK validates args against inputSchema first; the cast is only for registerTool's overloads.
      (async (args: z.output<S>) => {
        const started = Date.now();
        try {
          const result = ok(handler(args));
          deps.log?.({ tool: name, ok: true, ms: Date.now() - started });
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // A bad query from run_sql is the caller's to fix, not a server fault
          const isInvalid = err instanceof QueryError || /SQLITE_ERROR|no such|syntax error/i.test(message);
          deps.log?.({ tool: name, ok: false, ms: Date.now() - started, error: message });
          return fail(isInvalid ? "invalid" : "internal", message);
        }
      }) as never,
    );
  }

  tool(
    "overview",
    {
      title: "Finance data overview",
      description:
        "What's in the data: date range, last import, statement accounts (ids for the account filter), every " +
        "category with its transaction count and total spent, kinds, and card members. Call this first.",
      inputSchema: z.object({}),
    },
    () => overview(deps.db),
  );

  tool(
    "find_transactions",
    {
      title: "Find transactions",
      description:
        "List individual transactions matching the filters, newest first, with totals for everything matched " +
        '(not just the page returned). E.g. "what did we spend at Costco in October?" or "charges over $500 this year".',
      inputSchema: z.object({
        ...filters,
        sort: z.enum(["newest", "oldest", "largest"]).default("newest"),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    },
    (a) => findTransactions(deps.db, a),
  );

  tool(
    "merchant_history",
    {
      title: "Merchant visit history",
      description:
        "One row per merchant: visits (distinct days with a purchase), first and last visit, days since the last " +
        "one, typical gap between visits, total and average spent, and the most recent visit dates. Purchases only " +
        'unless kinds says otherwise. E.g. "when did we last eat at X?", "restaurants we haven\'t been to in a while" ' +
        '(categories ["Dining"], minVisits 3, sort "longest_ago"), "places we went in the last month" (from, sort "recent").',
      inputSchema: z.object({
        ...filters,
        minVisits: z.number().int().min(1).optional().describe("Only merchants visited at least this many times."),
        sort: z
          .enum(["recent", "visits", "spent", "longest_ago"])
          .default("recent")
          .describe('"recent" (latest visit first), "visits", "spent", or "longest_ago" (stalest first).'),
        recentDates: z.number().int().min(0).max(50).default(5).describe("How many recent visit dates to list."),
        limit: z.number().int().min(1).max(500).default(25),
      }),
    },
    (a) => merchantHistory(deps.db, { ...a, today: deps.today?.() }),
  );

  tool(
    "spending_summary",
    {
      title: "Spending summary",
      description:
        "Total spending grouped by category, merchant, month, year, weekday or account, with each group's share. " +
        "Counts spend + refund + fee unless kinds says otherwise. " +
        'E.g. "dining by month this year" (categories ["Dining"], groupBy "month", from "2026-01-01").',
      inputSchema: z.object({
        ...filters,
        groupBy: z.enum(["category", "merchant", "month", "year", "weekday", "account"]),
        limit: z.number().int().min(1).max(500).default(100),
      }),
    },
    (a) => spendingSummary(deps.db, a),
  );

  tool(
    "list_bills",
    {
      title: "List bills",
      description:
        "Recurring bills and subscriptions from the Bills page: amount, frequency, split, next charge, and your " +
        "monthly share, with the active monthly total.",
      inputSchema: z.object({
        state: z.enum(["active", "paused", "cancelled", "all"]).default("active"),
      }),
    },
    (a) => listBills(deps.db, a.state),
  );

  tool(
    "net_worth",
    {
      title: "Net worth",
      description: "Hand-entered asset balances (retirement, savings, home equity, vehicles…) with totals by type.",
      inputSchema: z.object({}),
    },
    () => netWorth(deps.db),
  );

  tool(
    "car_costs",
    {
      title: "Car costs and history",
      description:
        "Every car: cost of ownership (running costs + depreciation + loan interest), per year and per mile, costs by " +
        "type and by year, mileage readings, repairs in the last 12 months vs the 12 before, plus service history from " +
        "the documents, gaps in the data (unassigned car charges, charges with no receipt) and the household context " +
        "for an upgrade (checking and savings, average monthly spending and income, open goals).",
      inputSchema: z.object({}),
    },
    () => carCosts(deps.db, deps.today?.()),
  );

  tool(
    "holdings",
    {
      title: "Investment holdings",
      description:
        "Every investment account's latest snapshot (funds, stocks, crypto, cash with shares, value, cost basis), the " +
        "household mix by asset class against the written targets and bands, core vs play money against the play cap, " +
        "blended fund fees, the securities list with keep / watch / remove status and why, flags worth a look, and the " +
        'household on each past snapshot date. E.g. "what should we add or remove?" or "are we inside our bands?".',
      inputSchema: z.object({
        asOf: date.optional().describe("Use each account's latest snapshot on or before this date."),
      }),
    },
    (a) => investmentHoldings(deps.db, a.asOf),
  );

  tool(
    "run_sql",
    {
      title: "Run a read-only SQL query",
      description:
        "Run one SQLite SELECT against the finance database, for questions the other tools can't answer. " +
        `Read-only; at most maxRows rows come back. ${SCHEMA_HINT}`,
      inputSchema: z.object({
        sql: z.string().trim().min(1).max(10_000),
        maxRows: z.number().int().min(1).max(1000).default(200),
      }),
    },
    (a) => runSql(deps.db, a.sql, a.maxRows),
  );

  return server;
}
