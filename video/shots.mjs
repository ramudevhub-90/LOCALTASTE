// README / Devpost screenshots from the live app: runs one analysis plus each
// follow-up, then captures each section. Writes ../docs/screenshots/*.png.
//   node shots.mjs                  light theme, desktop + phone
//   APP=http://localhost:5173 node shots.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "docs", "screenshots");
const APP = process.env.APP ?? "https://localtaste.revenuerush.in/";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
const shot = async (name, selector) => {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
};
const idle = (selector) => page.waitForFunction((s) => !/…|Starting|Queued/.test(document.querySelector(s)?.textContent ?? ""), selector, { timeout: 180_000 });

await page.goto(APP);
await shot("01-form", "form.onboard");
await page.getByRole("button", { name: "Get taste advice" }).click();
await page.waitForSelector(".sugg", { timeout: 180_000 });
await page.waitForTimeout(1500);
await shot("02-taste-map", ".card:has(.map)");
await shot("03-your-cafe-and-crowd", ".insights");
await shot("04-suggestions", ".card.plan");

await page.locator(".sugg .link").first().click();
await shot("05-why-this", ".sugg");

await page.getByRole("button", { name: "Why not pizza?" }).click();
await idle(".ask form button");
await page.waitForSelector(".reply", { timeout: 120_000 });
await shot("06-ask-the-agent", ".ask");

await page.getByRole("button", { name: "Find matching areas" }).click();
await page.waitForSelector(".branches", { timeout: 180_000 });
await page.getByPlaceholder(/A café or restaurant in/).fill("Third Wave Coffee");
await page.getByRole("button", { name: "Check" }).click();
await page.waitForSelector(".rival", { timeout: 180_000 });
await shot("07-branch-and-competitor", ".grow");

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "dark", isMobile: true });
await phone.goto(APP);
await phone.screenshot({ path: path.join(OUT, "08-phone-dark.png") });
console.log("saved 08-phone-dark");

await browser.close();
