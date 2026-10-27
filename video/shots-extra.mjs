// Extra gallery images for Devpost: the address type-ahead, "Why this?" evidence,
// the agent's trace, a US neighbourhood, and the how-it-works diagram.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "docs", "screenshots");
const APP = process.env.APP ?? "https://localtaste.revenuerush.in/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
const save = async (name, selector) => {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
};

// Address type-ahead
await page.goto(APP);
const box = page.getByRole("combobox").first();
await box.click();
await box.fill("");
await box.pressSequentially("chikkaban", { delay: 60 });
await page.locator(".addr-list li button").nth(2).waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await page.locator("form.onboard").screenshot({ path: path.join(OUT, "09-any-address.png") });
console.log("saved 09-any-address");

// Indiranagar run: Why this? evidence + agent trace
await box.fill("");
await box.pressSequentially("Indiranagar", { delay: 40 });
await page.locator(".addr-list li button", { hasText: "Indiranagar, Bengaluru" }).first().click();
await page.getByRole("button", { name: "Get taste advice" }).click();
await page.waitForSelector(".sugg", { timeout: 180000 });
await page.waitForTimeout(1500);
await page.locator(".grid .sugg").nth(3).locator(".link").click();
await save("10-why-this", ".grid .sugg >> nth=3");
const writer = await page.locator(".card.plan .pill").first().textContent();
console.log("writer:", writer);
if (await page.locator(".trace summary").count()) {
  await page.locator(".trace summary").click();
  await save("11-agent-trace", ".trace");
}

// A US neighbourhood
await page.evaluate(() => window.scrollTo(0, 0));
await box.fill("");
await box.pressSequentially("Williamsburg", { delay: 40 });
await page.locator(".addr-list li button", { hasText: "Williamsburg, Brooklyn" }).first().click();
await page.getByPlaceholder("e.g. Glens Bakehouse").fill("");
await page.getByRole("button", { name: "Get taste advice" }).click();
await page.waitForFunction(() => document.querySelector(".card h2")?.textContent?.includes("Williamsburg"), null, { timeout: 180000 });
await page.waitForSelector(".sugg", { timeout: 180000 });
await page.waitForTimeout(1500);
await save("12-brooklyn", ".card:has(.map)");

// How it works diagram (explainer scene 2)
const still = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await still.goto(`file://${path.join(HERE, "explainer.html")}?scene=2`);
await still.evaluate(() => document.fonts.ready);
await still.waitForTimeout(1500);
await still.screenshot({ path: path.join(OUT, "13-how-it-works.png") });
console.log("saved 13-how-it-works");
await browser.close();
