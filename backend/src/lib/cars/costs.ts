/**
 * Loads the app database's rows for the car math in compute.ts. The read-only MCP has its own
 * loader (mcp/queries.ts) over node:sqlite; both feed the same pure functions.
 */
import { db } from "../../db/index.js";
import { accounts, carDocuments, goals, transactions, vehicleLinks, vehicleRules, vehicles } from "../../db/schema.js";
import { today } from "../date.js";
import { carsOverview as computeOverview, type CarData } from "./compute.js";

export * from "./compute.js";

export function loadCarData(): CarData {
  return {
    cars: db.select().from(vehicles).all(),
    links: db.select().from(vehicleLinks).all(),
    rules: db.select().from(vehicleRules).all(),
    docs: db.select().from(carDocuments).all(),
    txns: db.select({
      id: transactions.id, date: transactions.date, month: transactions.month, amount: transactions.amount,
      merchant: transactions.merchant, category: transactions.category, kind: transactions.kind, payeeId: transactions.payeeId,
    }).from(transactions).all(),
    assets: db.select({
      id: accounts.id, type: accounts.type, balance: accounts.balance, lastUpdated: accounts.lastUpdated,
      institution: accounts.institution, owner: accounts.owner,
    }).from(accounts).all(),
    goals: db.select({
      name: goals.name, targetAmount: goals.targetAmount, savedAmount: goals.savedAmount, deadline: goals.deadline,
      priority: goals.priority, completedAt: goals.completedAt,
    }).from(goals).all(),
    today: today(),
  };
}

/** Everything for the Cars page */
export function carsOverview() {
  return computeOverview(loadCarData());
}
