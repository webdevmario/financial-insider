import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Expense } from "../../types";

/**
 * On-device storage shared by the page and the service worker.
 *
 * - cache:  last good response for each GET path, so views render offline
 * - outbox: expense changes made on this device, replayed to the server in order
 */

export interface CachedResponse {
  path: string;
  data: unknown;
  savedAt: string;
}

export type OutboxOp =
  | { seq?: number; rev: number; kind: "create"; id: string; data: Expense }
  | { seq?: number; rev: number; kind: "update"; id: string; data: Partial<Expense> & { updatedAt: string } }
  | { seq?: number; rev: number; kind: "delete"; id: string };

interface OfflineDB extends DBSchema {
  cache: { key: string; value: CachedResponse };
  outbox: { key: number; value: OutboxOp; indexes: { byId: string } };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

export function offlineDb(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>("financial-insider", 1, {
      upgrade(db) {
        db.createObjectStore("cache", { keyPath: "path" });
        const outbox = db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
        outbox.createIndex("byId", "id");
      },
    });
  }
  return dbPromise;
}
