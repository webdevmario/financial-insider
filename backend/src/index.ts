import express from "express";
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

// Tailscale Serve proxies from loopback; trust its X-Forwarded-For so req.ip is the device's tailnet IP
app.set("trust proxy", "loopback");

// Request log: one line per request. Successful static asset hits are skipped to keep the log small.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const isAsset = !req.path.startsWith("/api/") && /\.\w+$/.test(req.path);
    if (isAsset && res.statusCode < 400) return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms ${req.ip}`);
  });
  next();
});

// Middleware
app.use(express.json({ limit: "10mb" })); // Large enough for data imports

// Health check — the frontend pings this to decide whether the network is good enough to sync
app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ ok: true });
});

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
