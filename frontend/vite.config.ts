import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Installable PWA with a custom service worker (src/sw.ts) that precaches
    // the app shell and replays the offline outbox via Background Sync
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false, // registered manually in main.tsx
      injectManifest: {
        rollupFormat: "iife", // classic worker script for the widest browser support
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      manifest: {
        name: "Financial Insider",
        short_name: "Finances",
        description: "Net worth, bills, and budget tracking",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0f1117",
        theme_color: "#0f1117",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // In dev, forward /api calls to the Express backend
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Output directly into backend/public so Express can serve it
    outDir: "../backend/public",
    emptyOutDir: true,
  },
});
