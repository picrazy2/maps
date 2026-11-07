#!/usr/bin/env node
// Upload journeys and refresh the public summary. Without a file it only recomputes the summary.
//   node pipeline/tfl/publish.mjs [rows.txt] [--base=http://localhost:8788]
// Reads TFL_ADMIN_TOKEN from the environment, else .dev.vars for localhost or
// pipeline/raw/tfl/admin-token for production.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNetwork, parseRows, summarize } from "../../public/tfl/routing.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("--base="))?.slice(7) ?? "https://maps.akguo.com";
const file = args.find((a) => !a.startsWith("--"));

let token = process.env.TFL_ADMIN_TOKEN;
const vars = join(ROOT, ".dev.vars"), prodToken = join(ROOT, "pipeline/raw/tfl/admin-token");
if (!token && base.includes("localhost") && existsSync(vars)) token = readFileSync(vars, "utf8").match(/^TFL_ADMIN_TOKEN=(.+)$/m)?.[1];
if (!token && existsSync(prodToken)) token = readFileSync(prodToken, "utf8").trim();
if (!token) throw new Error("TFL_ADMIN_TOKEN is not set");

async function call(path, init = {}) {
  const res = await fetch(`${base}/tfl/api/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

if (file) {
  const rows = parseRows(readFileSync(file, "utf8"));
  const { total, added } = await call("journeys", { method: "POST", body: JSON.stringify(rows) });
  console.log(`Uploaded ${rows.length} journeys: ${added} new, ${total} stored`);
}
const net = buildNetwork(JSON.parse(readFileSync(join(ROOT, "public/tfl/data/network.json"), "utf8")));
const { journeys, overrides } = await call("journeys");
const summary = summarize(net, journeys, overrides);
await call("summary", { method: "PUT", body: JSON.stringify(summary) });
const unmatched = summary.totals.unmatched ? `, ${summary.totals.unmatched} unmatched legs` : "";
console.log(`Summary: ${summary.totals.journeys} rail journeys, ${summary.totals.km} km${unmatched}`);
