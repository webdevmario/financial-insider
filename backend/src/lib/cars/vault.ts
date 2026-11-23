/**
 * Car documents live in the vault (Papers, the household document app on this Mac). FI reads them
 * through its API with its own app token, which can read the cars area (and finances, insurance,
 * house) and link documents as "financial-insider". FI's car_documents keeps only what the car math
 * needs, so costs still compute when the vault is down; files and text are fetched on demand.
 *
 * Env, from FI's gitignored .env: VAULT_URL (default http://127.0.0.1:3030), VAULT_TOKEN (pnpm vault:token
 * financial-insider, in the vault repo), VAULT_WEB_URL (the vault's address on the tailnet, for "Add document").
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { carDocuments, type CarDocument } from "../../db/schema.js";

/** Read when used, since the server loads ../.env after the modules are imported */
const base = () => (process.env.VAULT_URL || "http://127.0.0.1:3030").replace(/\/$/, "") + "/api";
const APP = "financial-insider";

export type VaultDoc = {
  id: string;
  area: string;
  title: string | null;
  docType: string | null;
  vendor: string | null;
  date: string | null;
  total: number | null;
  heading: string | null;
  textDate?: string | null;
  createdAt: string;
  text?: string | null;
  links: { id: string; app: string; entityType: string; entityId: string; role: string | null }[];
};

export class VaultError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export function vaultConfigured(): boolean {
  return !!process.env.VAULT_TOKEN;
}

/** Where "Add document" sends the phone: the vault's Scan page, filing into Cars */
export function vaultScanUrl(returnTo?: string): string | null {
  const web = process.env.VAULT_WEB_URL?.replace(/\/$/, "");
  if (!web) return null;
  return `${web}/scan?area=cars${returnTo ? `&return=${encodeURIComponent(returnTo)}` : ""}`;
}

export async function vaultFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!vaultConfigured()) throw new VaultError("The vault isn't set up for FI (VAULT_TOKEN is missing)", 503);
  let res: Response;
  try {
    res = await fetch(base() + path, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${process.env.VAULT_TOKEN}` },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    throw new VaultError("The vault isn't reachable", 503);
  }
  return res;
}

async function vaultJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vaultFetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new VaultError(body?.error || `vault answered ${res.status}`, res.status === 404 ? 404 : 502);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function getVaultDoc(id: string): Promise<VaultDoc> {
  return (await vaultJson<{ document: VaultDoc }>(`/documents/${encodeURIComponent(id)}`)).document;
}

async function listCarArea(): Promise<VaultDoc[]> {
  const out: VaultDoc[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await vaultJson<{ documents: VaultDoc[]; total: number }>(`/documents?area=cars&limit=500&offset=${offset}`);
    out.push(...page.documents);
    if (out.length >= page.total || !page.documents.length) return out;
  }
}

/** A name to show for a vault document: its title, else sender and type, else its first line */
export function displayName(d: Pick<VaultDoc, "title" | "vendor" | "docType" | "heading" | "createdAt">): string {
  const name = d.title || [d.vendor, d.docType].filter(Boolean).join(" ") || d.heading || `Scan of ${d.createdAt.slice(0, 10)}`;
  return `${name}.pdf`;
}

let lastSync = 0;

/**
 * Takes the place of the folder watcher: every document in the vault's Cars area that FI hasn't seen
 * becomes a "new" car document for the /car-docs skill to read, and a "new" one that was deleted from
 * the vault goes away. Read documents are never touched here. Runs at most every 10 seconds, and does
 * nothing (no error) when the vault is down or not set up.
 */
export async function syncFromVault(force = false): Promise<{ added: number; removed: number } | null> {
  if (!vaultConfigured() || (!force && Date.now() - lastSync < 10_000)) return null;
  lastSync = Date.now();
  let docs: VaultDoc[];
  try {
    docs = await listCarArea();
  } catch {
    return null;
  }
  const known = new Map(db.select({ id: carDocuments.id, status: carDocuments.status }).from(carDocuments).all().map((r) => [r.id, r.status]));
  const inVault = new Set(docs.map((d) => d.id));
  const fresh = docs.filter((d) => !known.has(d.id));
  const gone = [...known].filter(([id, status]) => status === "new" && !inVault.has(id)).map(([id]) => id);
  db.transaction((tx) => {
    for (const d of fresh) {
      tx.insert(carDocuments).values({
        id: d.id, fileName: displayName(d), status: "new", docType: null, date: d.date, vendor: d.vendor, total: d.total,
        addedAt: d.createdAt,
      }).run();
    }
    if (gone.length) tx.delete(carDocuments).where(inArray(carDocuments.id, gone)).run();
  });
  return { added: fresh.length, removed: gone.length };
}

/**
 * Keeps the vault's links for a document in step with FI: one to its car and one to the bank charge
 * that paid it (as a receipt). Best effort: the vault being down never blocks an edit in FI.
 */
export async function syncVaultLinks(doc: Pick<CarDocument, "id" | "vehicleId" | "transactionId">): Promise<void> {
  if (!vaultConfigured()) return;
  try {
    const current = (await getVaultDoc(doc.id)).links.filter((l) => l.app === APP);
    const want = [
      doc.vehicleId ? { entityType: "vehicle", entityId: doc.vehicleId, role: null } : null,
      doc.transactionId ? { entityType: "transaction", entityId: doc.transactionId, role: "receipt" } : null,
    ].filter((w): w is { entityType: string; entityId: string; role: string | null } => !!w);
    for (const l of current) {
      if (!want.some((w) => w.entityType === l.entityType && w.entityId === l.entityId)) {
        await vaultJson(`/links/${encodeURIComponent(l.id)}`, { method: "DELETE" });
      }
    }
    for (const w of want) {
      if (current.some((l) => l.entityType === w.entityType && l.entityId === w.entityId)) continue;
      await vaultJson(`/documents/${encodeURIComponent(doc.id)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: w.entityType, entityId: w.entityId, ...(w.role ? { role: w.role } : {}) }),
      });
    }
  } catch (err) {
    console.error(`${new Date().toISOString()} vault links for ${doc.id} not updated: ${err instanceof Error ? err.message : err}`);
  }
}

/** For callers that changed several documents at once */
export function syncVaultLinksFor(ids: string[]): void {
  if (!ids.length) return;
  const rows = db.select().from(carDocuments).where(inArray(carDocuments.id, ids)).all();
  for (const r of rows) void syncVaultLinks(r);
}

export function findCarDoc(id: string): CarDocument | undefined {
  return db.select().from(carDocuments).where(eq(carDocuments.id, id)).get();
}
