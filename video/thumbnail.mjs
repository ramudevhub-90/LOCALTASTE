// Renders the YouTube thumbnail (1280x720) to out/localtaste-thumbnail.png.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(HERE, "out"), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`file://${path.join(HERE, "thumbnail.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(HERE, "out", "localtaste-thumbnail.png") });
await browser.close();
console.log("saved out/localtaste-thumbnail.png");
