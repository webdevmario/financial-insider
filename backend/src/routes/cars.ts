import { Router } from "express";
import { existsSync } from "fs";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  transactions, vehicleDocuments, vehicleLinks, vehicleRules, vehicles,
  type Vehicle, type VehicleDocument,
} from "../db/schema.js";
import { today } from "../lib/date.js";
import { CAR_CATEGORIES, COST_TYPES, DOC_TYPES, carsOverview, costEntries, docCostType, loadCarData, summarizeVehicle } from "../lib/cars/costs.js";
import { carDocsDir, contentType, documentPath, fileAwayDocument, folderPath, saveCarDocUpload, scanCarDocs } from "../lib/cars/folder.js";
import { cleanDocument, restoreOriginal, type CleanOptions } from "../lib/cars/cleanup.js";
import { accounts } from "../db/schema.js";

const router = Router();

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Field parsing ─────────────────────────────────────────────────

type Patch = Record<string, unknown>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

/** A real calendar date: 2025-02-30 doesn't survive the round trip */
function isDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function date(v: unknown, field: string): string | null {
  const s = str(v);
  if (s && !isDate(s)) throw new Error(`${field} must be a real date, YYYY-MM-DD`);
  return s;
}

/** Copy only the fields present in the body, parsed by type */
function pick(body: Patch, fields: Record<string, "str" | "num" | "int" | "date">): Patch {
  const out: Patch = {};
  for (const [key, type] of Object.entries(fields)) {
    if (!(key in body)) continue;
    const v = body[key];
    out[key] = type === "str" ? str(v) : type === "num" ? num(v) : type === "int" ? int(v) : date(v, key);
  }
  return out;
}

const VEHICLE_FIELDS = {
  name: "str", make: "str", model: "str", vin: "str", plate: "str", driver: "str", accountId: "str",
  purchasedFrom: "str", notes: "str", year: "int", purchaseMileage: "int", saleMileage: "int", loanMonths: "int",
  purchasePrice: "num", tradeInValue: "num", loanAmount: "num", loanRate: "num", interestPaid: "num",
  salePrice: "num", valueEstimate: "num", purchaseDate: "date", soldDate: "date", valueDate: "date",
} as const;

const DOC_FIELDS = {
  vehicleId: "str", docType: "str", vendor: "str", summary: "str", notes: "str", transactionId: "str",
  odometer: "int", total: "num", date: "date",
} as const;

const fail = (res: import("express").Response, err: unknown, status = 400) =>
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });

function findVehicle(id: string) {
  return db.select().from(vehicles).where(eq(vehicles.id, id)).get();
}

function findDoc(id: string) {
  return db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, id)).get();
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function docOut(d: VehicleDocument) {
  return {
    ...d,
    paidOutside: !!d.paidOutside,
    items: parseJson(d.items) ?? [],
    details: parseJson(d.details),
    cleanup: parseJson(d.cleanup),
    path: documentPath(d),
    originalFile: d.originalPath ? folderPath(d.originalPath) : null,
  };
}

// ── Overview ──────────────────────────────────────────────────────

// GET /api/cars: every car with its costs, the gaps to fill and the household context
router.get("/", (_req, res) => {
  res.json(carsOverview());
});

// GET /api/cars/meta: the lists the app and skill pick from
router.get("/meta", (_req, res) => {
  res.json({
    costTypes: COST_TYPES,
    docTypes: DOC_TYPES,
    folder: carDocsDir(),
    vehicleAssets: db.select().from(accounts).all().filter((a) => /vehicle|car|auto/i.test(a.type)),
  });
});

// ── Vehicles ──────────────────────────────────────────────────────

// POST /api/cars
router.post("/", (req, res) => {
  let fields: Patch;
  try {
    fields = pick(req.body, VEHICLE_FIELDS);
  } catch (err) {
    return fail(res, err);
  }
  if (!fields.name) return fail(res, "Name is required");
  const row = { ...fields, id: newId(), name: fields.name as string, createdAt: today() } as Vehicle;
  db.insert(vehicles).values(row).run();
  res.json(findVehicle(row.id));
});

// GET /api/cars/:id: one car with its costs, readings, documents and every charge behind the totals
router.get("/vehicles/:id", (req, res) => {
  const v = findVehicle(req.params.id);
  if (!v) return res.status(404).json({ error: "Not found" });
  const data = loadCarData();
  const { entries } = costEntries(data);
  res.json({
    summary: summarizeVehicle(v, entries, data),
    entries: entries.filter((e) => e.vehicleId === v.id),
    documents: data.docs.filter((d) => d.vehicleId === v.id).sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(docOut),
  });
});

// PATCH /api/cars/vehicles/:id
router.patch("/vehicles/:id", (req, res) => {
  if (!findVehicle(req.params.id)) return res.status(404).json({ error: "Not found" });
  let fields: Patch;
  try {
    fields = pick(req.body, VEHICLE_FIELDS);
  } catch (err) {
    return fail(res, err);
  }
  if ("name" in fields && !fields.name) return fail(res, "Name is required");
  if (Object.keys(fields).length) db.update(vehicles).set(fields).where(eq(vehicles.id, req.params.id)).run();
  res.json(findVehicle(req.params.id));
});

// DELETE /api/cars/vehicles/:id: its documents stay, unassigned; its charge links go
router.delete("/vehicles/:id", (req, res) => {
  const id = req.params.id;
  if (!findVehicle(id)) return res.status(404).json({ error: "Not found" });
  db.transaction((tx) => {
    tx.delete(vehicleLinks).where(eq(vehicleLinks.vehicleId, id)).run();
    tx.update(vehicleDocuments).set({ vehicleId: null }).where(eq(vehicleDocuments.vehicleId, id)).run();
    tx.delete(vehicles).where(eq(vehicles.id, id)).run();
  });
  res.json({ success: true });
});

// ── Documents ─────────────────────────────────────────────────────

// GET /api/cars/documents?status=new&vehicleId=
router.get("/documents", (req, res) => {
  const conds = [];
  if (typeof req.query.status === "string") conds.push(eq(vehicleDocuments.status, req.query.status));
  if (typeof req.query.vehicleId === "string") conds.push(eq(vehicleDocuments.vehicleId, req.query.vehicleId));
  const rows = db.select().from(vehicleDocuments).where(conds.length ? and(...conds) : undefined).all();
  rows.sort((a, b) => (b.date || b.addedAt).localeCompare(a.date || a.addedAt));
  res.json(rows.map(docOut));
});

// POST /api/cars/documents/scan: look for new files now instead of waiting for the watcher
router.post("/documents/scan", (_req, res) => {
  try {
    res.json(scanCarDocs());
  } catch (err) {
    fail(res, err, 500);
  }
});

// POST /api/cars/documents/upload { name, content } (base64)
router.post("/documents/upload", (req, res) => {
  const { name, content } = req.body || {};
  if (!content) return fail(res, "No file");
  try {
    const { doc, duplicate } = saveCarDocUpload(String(name || "document"), String(content));
    res.json({ document: doc ? docOut(doc) : null, duplicate });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/cars/documents/:id
router.get("/documents/:id", (req, res) => {
  const d = findDoc(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  res.json(docOut(d));
});

// GET /api/cars/documents/:id/file: the original, to view in the browser
router.get("/documents/:id/file", (req, res) => {
  const d = findDoc(req.params.id);
  const path = d && documentPath(d);
  if (!d || !path || !existsSync(path)) return res.status(404).json({ error: "File not found" });
  res.type(contentType(d.fileName));
  res.set("Content-Disposition", `inline; filename="${d.fileName.replace(/"/g, "")}"`);
  res.sendFile(path);
});

// GET /api/cars/documents/:id/original: the file as it came in, before cleanup
router.get("/documents/:id/original", (req, res) => {
  const d = findDoc(req.params.id);
  const path = d?.originalPath ? folderPath(d.originalPath) : null;
  if (!d || !path || !existsSync(path)) return res.status(404).json({ error: "No original kept for this document" });
  const name = (parseJson(d.cleanup) as { originalName?: string } | null)?.originalName || d.fileName;
  res.type(contentType(path));
  res.set("Content-Disposition", `inline; filename="${name.replace(/"/g, "")}"`);
  res.sendFile(path);
});

/**
 * POST /api/cars/documents/:id/clean { pages?, mode?, rotate?, crop?, force? }: clean the scan up again
 * from its original, or for the first time. pages "1;2-5" splits one file into several documents (pages
 * left out are dropped); rotate "3:90" turns page 3 a further 90 degrees clockwise; mode gray | bw | color;
 * crop false keeps the whole photo. Returns the document(s) and what was done per page, with its text.
 */
router.post("/documents/:id/clean", async (req, res) => {
  if (!findDoc(req.params.id)) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  const options: CleanOptions = {
    pages: b.pages == null ? undefined : String(b.pages),
    mode: b.mode ?? undefined,
    rotate: b.rotate == null ? undefined : String(b.rotate),
    crop: b.crop == null ? undefined : !!b.crop,
    force: !!b.force,
  };
  try {
    const r = await cleanDocument(req.params.id, options);
    res.json({ result: r.result, documents: r.documents.map(docOut), pages: r.pages });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/cars/documents/:id/restore: put the original back in place of the cleaned file
router.post("/documents/:id/restore", (req, res) => {
  try {
    res.json(docOut(restoreOriginal(req.params.id)));
  } catch (err) {
    fail(res, err);
  }
});

/**
 * PATCH /api/cars/documents/:id: what a document says, from the /car-docs skill or the app.
 * Body: any of vehicleId, docType, date, vendor, odometer, total, summary, items, details, notes,
 * transactionId (the bank charge that paid it), paidOutside, status (new | done | skipped),
 * share (this car's part of the charge, default 1), costType (to override the one the type implies),
 * parentId (make it a supporting document of another, null to make it its own again).
 * A transactionId with a car links that charge to the car; the document is filed away once done.
 * A supporting document takes its main document's car, never holds a charge, and doesn't count on its
 * own; a charge it held moves to the main document when that has none.
 */
router.patch("/documents/:id", (req, res) => {
  const doc = findDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  const body = req.body || {};
  let fields: Patch;
  try {
    fields = pick(body, DOC_FIELDS);
  } catch (err) {
    return fail(res, err);
  }
  if ("docType" in fields && fields.docType && !DOC_TYPES.includes(fields.docType as never)) {
    return fail(res, `docType must be one of ${DOC_TYPES.join(", ")}`);
  }
  if (body.status != null) {
    if (!["new", "done", "skipped"].includes(body.status)) return fail(res, "status must be new, done or skipped");
    fields.status = body.status;
  }
  if ("paidOutside" in body) fields.paidOutside = body.paidOutside ? 1 : 0;
  if ("items" in body) fields.items = body.items == null ? null : JSON.stringify(body.items);
  if ("details" in body) fields.details = body.details == null ? null : JSON.stringify(body.details);

  // Supporting document of another: always attached to the main one, never to another supporter
  let main: VehicleDocument | undefined;
  if ("parentId" in body) {
    const pid = str(body.parentId);
    if (pid) {
      main = findDoc(pid);
      if (main?.parentId) main = findDoc(main.parentId);
      if (!main) return fail(res, "No such document to attach it to");
      if (main.id === doc.id) return fail(res, "That document already supports this one");
      Object.assign(fields, { parentId: main.id, vehicleId: main.vehicleId, transactionId: null, paidOutside: 0 });
      if (body.status == null && doc.status === "new") fields.status = "done";
    } else {
      fields.parentId = null;
    }
  } else if (doc.parentId && (fields.transactionId || ("vehicleId" in fields && fields.vehicleId !== doc.vehicleId))) {
    return fail(res, "This is a supporting document: its car and charge come from its main document");
  }
  if (fields.vehicleId && !findVehicle(fields.vehicleId as string)) return fail(res, "No such car");
  if (fields.transactionId) {
    const t = db.select().from(transactions).where(eq(transactions.id, fields.transactionId as string)).get();
    if (!t) return fail(res, "No such transaction");
    fields.paidOutside = 0;
  }
  if (body.costType != null && !COST_TYPES.includes(body.costType)) return fail(res, `costType must be one of ${COST_TYPES.join(", ")}`);
  const share = body.share == null ? 1 : num(body.share);
  if (share == null || share <= 0 || share > 1) return fail(res, "share must be more than 0 and at most 1");

  const next = { ...doc, ...fields } as VehicleDocument;
  // The charge a newly attached supporter held, to hand to its main document
  const handoff = main && doc.transactionId && doc.vehicleId && !main.transactionId && !main.paidOutside && main.vehicleId
    ? db.select().from(vehicleLinks)
      .where(and(eq(vehicleLinks.transactionId, doc.transactionId), eq(vehicleLinks.vehicleId, doc.vehicleId))).get()
    : undefined;
  db.transaction((tx) => {
    // The charge this document used to point at no longer belongs to the car through it
    if (doc.transactionId && doc.vehicleId && (doc.transactionId !== next.transactionId || doc.vehicleId !== next.vehicleId)) {
      tx.delete(vehicleLinks).where(and(eq(vehicleLinks.transactionId, doc.transactionId), eq(vehicleLinks.vehicleId, doc.vehicleId))).run();
    }
    tx.update(vehicleDocuments).set({ ...fields, updatedAt: new Date().toISOString() }).where(eq(vehicleDocuments.id, doc.id)).run();
    const costType = body.costType || docCostType(next.docType);
    if (next.transactionId && next.vehicleId && costType) {
      const existing = tx.select().from(vehicleLinks)
        .where(and(eq(vehicleLinks.transactionId, next.transactionId), eq(vehicleLinks.vehicleId, next.vehicleId))).get();
      if (existing) {
        tx.update(vehicleLinks).set({ costType, share }).where(eq(vehicleLinks.id, existing.id)).run();
      } else {
        tx.insert(vehicleLinks).values({
          id: newId(), transactionId: next.transactionId, vehicleId: next.vehicleId, share, costType, createdAt: today(),
        }).run();
      }
    }
    if (main) {
      // Its own supporters move with it, so there's only ever one level
      tx.update(vehicleDocuments).set({ parentId: main.id, vehicleId: main.vehicleId })
        .where(eq(vehicleDocuments.parentId, doc.id)).run();
      if (handoff) {
        tx.update(vehicleDocuments).set({ transactionId: doc.transactionId, paidOutside: 0, updatedAt: new Date().toISOString() })
          .where(eq(vehicleDocuments.id, main.id)).run();
        const exists = tx.select().from(vehicleLinks)
          .where(and(eq(vehicleLinks.transactionId, doc.transactionId!), eq(vehicleLinks.vehicleId, main.vehicleId!))).get();
        if (!exists) {
          tx.insert(vehicleLinks).values({
            id: newId(), transactionId: doc.transactionId!, vehicleId: main.vehicleId!, share: handoff.share,
            costType: docCostType(main.docType) || handoff.costType, createdAt: today(),
          }).run();
        }
      }
    } else if (!next.parentId && "vehicleId" in fields && fields.vehicleId !== doc.vehicleId) {
      // Supporting documents follow their main document to another car
      tx.update(vehicleDocuments).set({ vehicleId: next.vehicleId }).where(eq(vehicleDocuments.parentId, doc.id)).run();
    }
  });
  if (next.status === "done") fileAwayDocument(doc.id);
  res.json(docOut(findDoc(doc.id)!));
});

/**
 * GET /api/cars/documents/:id/matches?total=&date=&vendor=: bank charges that could have paid it.
 * Shops usually charge on pickup, a few days after the invoice date, so the window leans forward.
 */
router.get("/documents/:id/matches", (req, res) => {
  const doc = findDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  const total = num(req.query.total) ?? doc.total;
  const when = (typeof req.query.date === "string" && isDate(req.query.date) ? req.query.date : null) ?? doc.date;
  const vendor = (typeof req.query.vendor === "string" ? req.query.vendor : null) ?? doc.vendor;
  if (!when) return fail(res, "The document needs a date (or pass ?date=)");
  const shift = (days: number) => new Date(Date.parse(when + "T12:00:00") + days * 86_400_000).toISOString().slice(0, 10);
  const rows = db.select().from(transactions)
    .where(and(gte(transactions.date, shift(-10)), lte(transactions.date, shift(14)), inArray(transactions.kind, ["spend", "fee"])))
    .all();
  const docsByTxn = new Map(
    db.select().from(vehicleDocuments).all().filter((d) => d.transactionId && d.id !== doc.id).map((d) => [d.transactionId!, d.id])
  );
  const words = (s: string | null) => new Set((s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const vendorWords = words(vendor);
  const candidates = rows.map((t) => {
    const amount = -t.amount;
    const diff = total != null ? Math.abs(amount - total) : null;
    const days = Math.round((Date.parse(t.date) - Date.parse(when)) / 86_400_000);
    const merchantWords = words(`${t.merchant} ${t.description}`);
    const nameMatch = [...vendorWords].some((w) => merchantWords.has(w));
    let score = 0;
    if (diff != null) score += diff < 0.01 ? 60 : diff <= Math.max(1, total! * 0.02) ? 35 : 0;
    if (nameMatch) score += 30;
    score += Math.max(0, 10 - Math.abs(days));
    return {
      transactionId: t.id, date: t.date, merchant: t.merchant, description: t.description, amount: Math.round(amount * 100) / 100,
      category: t.category, accountId: t.accountId, days, exactAmount: diff != null && diff < 0.01, nameMatch,
      otherDocumentId: docsByTxn.get(t.id) ?? null, score,
    };
  })
    .filter((c) => c.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  res.json({ date: when, total, vendor, candidates });
});

// DELETE /api/cars/documents/:id: forget the record (and its charge link); the file stays in the folder
router.delete("/documents/:id", (req, res) => {
  const doc = findDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  db.transaction((tx) => {
    if (doc.transactionId && doc.vehicleId) {
      tx.delete(vehicleLinks).where(and(eq(vehicleLinks.transactionId, doc.transactionId), eq(vehicleLinks.vehicleId, doc.vehicleId))).run();
    }
    tx.update(vehicleDocuments).set({ status: "skipped", vehicleId: null, transactionId: null, parentId: null }).where(eq(vehicleDocuments.id, doc.id)).run();
    // Its supporting documents stand on their own again
    tx.update(vehicleDocuments).set({ parentId: null }).where(eq(vehicleDocuments.parentId, doc.id)).run();
  });
  res.json({ success: true });
});

// ── Charges assigned to cars ──────────────────────────────────────

// POST /api/cars/links { transactionIds, vehicleId, costType, share? }
router.post("/links", (req, res) => {
  const { transactionIds, vehicleId, costType } = req.body || {};
  const share = req.body?.share == null ? 1 : num(req.body.share);
  if (!Array.isArray(transactionIds) || !transactionIds.length) return fail(res, "transactionIds is required");
  if (!findVehicle(vehicleId)) return fail(res, "No such car");
  if (!COST_TYPES.includes(costType)) return fail(res, `costType must be one of ${COST_TYPES.join(", ")}`);
  if (share == null || share <= 0 || share > 1) return fail(res, "share must be more than 0 and at most 1");
  const known = new Set(db.select({ id: transactions.id }).from(transactions).where(inArray(transactions.id, transactionIds)).all().map((t) => t.id));
  let linked = 0;
  db.transaction((tx) => {
    for (const id of transactionIds) {
      if (!known.has(id)) continue;
      const existing = tx.select().from(vehicleLinks).where(and(eq(vehicleLinks.transactionId, id), eq(vehicleLinks.vehicleId, vehicleId))).get();
      if (existing) tx.update(vehicleLinks).set({ costType, share }).where(eq(vehicleLinks.id, existing.id)).run();
      else tx.insert(vehicleLinks).values({ id: newId(), transactionId: id, vehicleId, share, costType, createdAt: today() }).run();
      linked++;
    }
  });
  res.json({ linked, unknown: transactionIds.length - linked });
});

// GET /api/cars/charges?merchant=&payeeId=: car-category charges not assigned to any car, one by one
router.get("/charges", (req, res) => {
  const { covered } = costEntries(loadCarData());
  const payeeId = typeof req.query.payeeId === "string" ? req.query.payeeId : null;
  const merchant = typeof req.query.merchant === "string" ? req.query.merchant : null;
  const rows = db.select().from(transactions)
    .where(and(inArray(transactions.category, CAR_CATEGORIES), inArray(transactions.kind, ["spend", "refund", "fee"])))
    .all()
    .filter((t) => !covered.has(t.id) && (payeeId ? t.payeeId === payeeId : merchant ? t.merchant === merchant : true))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({ id: t.id, date: t.date, merchant: t.merchant, description: t.description, amount: -t.amount, category: t.category, accountId: t.accountId }));
  res.json(rows);
});

// DELETE /api/cars/links/:id
router.delete("/links/:id", (req, res) => {
  db.delete(vehicleLinks).where(eq(vehicleLinks.id, req.params.id)).run();
  res.json({ success: true });
});

// ── Shared-cost rules ─────────────────────────────────────────────

const RULE_MATCH = ["payee", "category", "merchant"];

function ruleFields(body: Patch): Patch {
  const out: Patch = {};
  if ("matchType" in body) {
    if (!RULE_MATCH.includes(String(body.matchType))) throw new Error(`matchType must be one of ${RULE_MATCH.join(", ")}`);
    out.matchType = body.matchType;
  }
  if ("matchValue" in body) {
    const v = str(body.matchValue);
    if (!v) throw new Error("matchValue is required");
    out.matchValue = v;
  }
  if ("costType" in body) {
    if (!COST_TYPES.includes(body.costType as never)) throw new Error(`costType must be one of ${COST_TYPES.join(", ")}`);
    out.costType = body.costType;
  }
  if ("shares" in body) {
    const s = body.shares;
    if (s == null || (typeof s === "object" && !Object.keys(s as object).length)) out.shares = null;
    else if (typeof s !== "object") throw new Error("shares must be { vehicleId: weight }");
    else {
      for (const [id, w] of Object.entries(s as Record<string, unknown>)) {
        if (!findVehicle(id)) throw new Error(`No car ${id}`);
        if (typeof w !== "number" || w < 0) throw new Error("Each share must be a number of 0 or more");
      }
      out.shares = JSON.stringify(s);
    }
  }
  if ("dateFrom" in body) out.dateFrom = date(body.dateFrom, "dateFrom");
  if ("dateTo" in body) out.dateTo = date(body.dateTo, "dateTo");
  if ("notes" in body) out.notes = str(body.notes);
  return out;
}

function ruleOut(r: typeof vehicleRules.$inferSelect) {
  return { ...r, shares: parseJson(r.shares) };
}

// GET /api/cars/rules
router.get("/rules", (_req, res) => {
  res.json(db.select().from(vehicleRules).all().map(ruleOut));
});

// POST /api/cars/rules { matchType, matchValue, costType, shares?, dateFrom?, dateTo?, notes? }
router.post("/rules", (req, res) => {
  let fields: Patch;
  try {
    fields = ruleFields(req.body || {});
  } catch (err) {
    return fail(res, err);
  }
  if (!fields.matchType || !fields.matchValue || !fields.costType) return fail(res, "matchType, matchValue and costType are required");
  const row = { ...fields, id: newId(), createdAt: today() } as typeof vehicleRules.$inferInsert;
  db.insert(vehicleRules).values(row).run();
  res.json(ruleOut(db.select().from(vehicleRules).where(eq(vehicleRules.id, row.id)).get()!));
});

// PATCH /api/cars/rules/:id
router.patch("/rules/:id", (req, res) => {
  const existing = db.select().from(vehicleRules).where(eq(vehicleRules.id, req.params.id)).get();
  if (!existing) return res.status(404).json({ error: "Not found" });
  let fields: Patch;
  try {
    fields = ruleFields(req.body || {});
  } catch (err) {
    return fail(res, err);
  }
  if (Object.keys(fields).length) db.update(vehicleRules).set(fields).where(eq(vehicleRules.id, existing.id)).run();
  res.json(ruleOut(db.select().from(vehicleRules).where(eq(vehicleRules.id, existing.id)).get()!));
});

// DELETE /api/cars/rules/:id
router.delete("/rules/:id", (req, res) => {
  db.delete(vehicleRules).where(eq(vehicleRules.id, req.params.id)).run();
  res.json({ success: true });
});

export default router;
