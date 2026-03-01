import express from "express";
import cors from "cors";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";

import accountsRouter from "./routes/accounts.js";
import expensesRouter from "./routes/expenses.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import settingsRouter from "./routes/settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ensure data directory exists
const dataDir = resolve(__dirname, "../../data");
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors()); // In production behind Tailscale, this is fine
app.use(express.json({ limit: "10mb" })); // Large enough for data imports

// API routes
app.use("/api/accounts", accountsRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api", settingsRouter); // settings, dashboard, data routes

// Serve frontend in production
const publicDir = resolve(__dirname, "../public");
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback: serve index.html for any non-API route
  app.get("*", (_req, res) => {
    res.sendFile(resolve(publicDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`\n  🚀 Financial Insider API running on http://localhost:${PORT}`);
  console.log(`  📁 Database: ${resolve(dataDir, "finance.db")}`);
  if (existsSync(publicDir)) {
    console.log(`  🌐 Frontend: serving from ${publicDir}`);
  } else {
    console.log(`  ⚠️  No frontend build found. Run: cd frontend && pnpm build`);
  }
  console.log();
});
