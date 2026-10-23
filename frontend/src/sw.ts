/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";
import { flushOutbox, OUTBOX_SYNC_TAG } from "./lib/offline/outbox";

declare const self: ServiceWorkerGlobalScope;

/** Background Sync isn't in TypeScript's lib yet */
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

// New versions take over right away; the open page keeps working and picks up
// the new assets on its next load
self.skipWaiting();
clientsClaim();

// Precache the built app shell (JS, CSS, fonts, icons, index.html)
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Any page navigation opens the cached app; /api always goes to the network
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }));

// Android Chrome: replay queued expenses when connectivity returns, even with
// the app closed. Throwing tells the browser to retry later with backoff.
self.addEventListener("sync", (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag !== OUTBOX_SYNC_TAG) return;
  syncEvent.waitUntil(
    flushOutbox().then((result) => {
      if (result.remaining > 0) throw new Error(`${result.remaining} changes still queued`);
    })
  );
});
