#!/usr/bin/env node
// Download Oyster journey history with a dedicated browser profile, then publish it.
//   node pipeline/tfl/collect.mjs --login   opens a window to sign in by hand once
//   node pipeline/tfl/collect.mjs           runs unattended; exits 2 if a sign-in is needed
//   Add --no-publish to stop after saving, or --base=URL to publish elsewhere.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "../raw/tfl");
const ENTRY = "https://oyster.tfl.gov.uk/oyster/entry.do";
const args = process.argv.slice(2);
const login = args.includes("--login");

mkdirSync(RAW, { recursive: true });
const context = await chromium.launchPersistentContext(join(RAW, "chrome-profile"), {
  channel: "chrome",
  headless: !login,
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());
let exitCode = 0;

const historyLink = () => page.locator('a[href*="journeyHistory"]').first();

try {
  await page.goto(ENTRY, { waitUntil: "domcontentloaded", timeout: 60000 });
  const signIn = page.getByRole("link", { name: "Sign in", exact: true }).or(page.getByRole("button", { name: "Sign in", exact: true })).first();
  if (await signIn.isVisible({ timeout: 8000 }).catch(() => false)) {
    // The cookie banner's overlay covers the page, and neither step needs a cookie choice.
    await signIn.dispatchEvent("click");
    await page.waitForLoadState("domcontentloaded");
  }
  // The TfL account session re-enters Oyster without a password while it is still valid.
  const reached = await historyLink().waitFor({ timeout: login ? 300000 : 20000 }).then(() => true).catch(() => false);
  if (!reached) {
    console.error(`Sign-in needed (stopped at ${new URL(page.url()).host}). Run: node pipeline/tfl/collect.mjs --login`);
    exitCode = 2;
  } else {
    await historyLink().dispatchEvent("click");
    await page.waitForSelector('select[name="dateRange"]', { timeout: 30000 });
    const source = readFileSync(join(HERE, "oyster_extract.js"), "utf8").replace("export async function", "async function");
    const { from, to, rows } = await page.evaluate(`(async () => { ${source}; return extractRows(); })()`);
    const file = join(RAW, `journeys_${to.split("/").reverse().join("-")}.txt`);
    writeFileSync(file, `${rows}\n`);
    console.log(`Saved ${rows ? rows.split("\n").length : 0} rows for ${from} to ${to}`);
    if (rows && !args.includes("--no-publish")) {
      const base = args.find((a) => a.startsWith("--base="));
      execFileSync(process.execPath, [join(HERE, "publish.mjs"), file, ...(base ? [base] : [])], { stdio: "inherit" });
    }
  }
} finally {
  await context.close();
}
process.exit(exitCode);
