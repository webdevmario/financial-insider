import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startSync } from "./lib/offline/status";
// Fonts are bundled (not loaded from Google) so the app renders the same offline
import "@fontsource-variable/dm-sans/opsz.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./index.css";

// The service worker needs a secure origin (HTTPS or localhost) and a production build
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("Service worker registration failed", err);
  });
}

startSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
