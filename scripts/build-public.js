"use strict";

// Copy only the browser runtime. Source archives, SQL, tests and internal notes
// stay in Git for recovery and maintenance, outside Vercel's static directory.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "public-build");
const files = [
  "auth-flow.js", "team-access.js", "team-access.css",
  "index.html", "styles.css", "warehouse.css", "app.js", "sw.js",
  "local-workspace.js", "money.js", "cash-ledger.js", "cash-book.js",
  "workspace-reset-core.js", "workspace-maintenance.js",
  "warehouse-core.js", "warehouse-ui.js", "warehouse-cloud.js",
  "supabase-config.js", "supabase-js.umd.js", "manifest.webmanifest",
  "assets/solar-background.png", "assets/sparta-logo.jpeg",
  "assets/pwa/apple-touch-icon.png", "assets/pwa/icon-192.png", "assets/pwa/icon-512.png",
];
for (const file of files) {
  const source = path.join(root, file);
  if (!fs.statSync(source).isFile()) throw new Error(`Missing runtime file: ${file}`);
}
fs.rmSync(output, { recursive: true, force: true });
for (const file of files) {
  const destination = path.join(output, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination);
}
console.log(`Prepared ${files.length} public runtime files in public-build`);
