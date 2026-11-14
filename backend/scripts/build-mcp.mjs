// Bundles the finance MCP (backend/src/mcp/index.ts and everything it imports) into one ESM file,
// backend/dist/mcp/finance-mcp.mjs, so it can be installed outside ~/Documents (see ../scripts/install-mcp.sh). It lives in backend/ so it can import esbuild.
// node:sqlite is built into Node, so there is no native module to ship alongside it.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backend = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(backend, "src/mcp/index.ts")],
  outfile: resolve(backend, "dist/mcp/finance-mcp.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
});
