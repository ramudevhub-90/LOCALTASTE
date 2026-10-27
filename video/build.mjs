// Builds out/localtaste-demo.mp4 (1920x1080) and out/localtaste-demo.srt from
// the narration in script.mjs, the explainer scenes and the live app.
//   node build.mjs            everything
//   node build.mjs demo       one part: voice | intro | demo | outro | assemble
//   VLANG=hi node build.mjs   Hindi narration (script.hi.mjs), English captions
import { chromium } from "playwright";
import ffmpeg from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LANG = process.env.VLANG === "hi" ? "hi" : "en";
const { DEMO, INTRO, OUTRO, VOICE } = await import(LANG === "hi" ? "./script.hi.mjs" : "./script.mjs");
const SUFFIX = LANG === "en" ? "" : `-${LANG}`;
// On-screen captions are always English, so every version reads for the judges.
const EN = await import("./script.mjs");
const english = (part, line, i) => (part === "demo" ? EN.DEMO.find((l) => l.id === line.id) : EN[part.toUpperCase()][i])?.text ?? line.text;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const TMP = path.join(OUT, "tmp");
const APP = process.env.APP ?? "https://localtaste.revenuerush.in/";
const SIZE = { width: 1920, height: 1080 };
const PAD = 0.8; // seconds of quiet after each line
mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- Voice -------------------------------------------------------------

function duration(file) {
  let out;
  try {
    out = execFileSync(ffmpeg, ["-i", file], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (e) {
    out = String(e.stderr);
  }
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

function polly(voice, text, file) {
  execFileSync("aws", [
    "polly", "synthesize-speech", "--region", "us-east-1", "--profile", process.env.AWS_PROFILE ?? "default",
    "--engine", voice.polly, "--voice-id", voice.name, "--output-format", "mp3", "--sample-rate", "24000",
    ...(voice.lang ? ["--language-code", voice.lang] : []),
    "--text", text, file,
  ], { stdio: "ignore" });
}

function voice(baseKey, text, caption) {
  const key = `${baseKey}${SUFFIX}`;
  const wav = path.join(TMP, `${key}.wav`);
  const stamp = path.join(TMP, `${key}.txt`);
  const id = `${JSON.stringify(VOICE)}|${text}`;
  if (!existsSync(wav) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== id) {
    const mp3 = path.join(TMP, `${key}.mp3`);
    const spoken = text.replace(/’/g, "'");
    try {
      polly(VOICE, spoken, mp3);
    } catch {
      polly(VOICE.fallback, spoken, mp3);
    }
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", mp3, "-ar", "48000", "-ac", "2", wav]);
    writeFileSync(stamp, id);
  }
  return { key, wav, dur: duration(wav), caption, spoken: text };
}

const lines = () => ({
  intro: INTRO.map((l, i) => ({ ...l, ...voice(`intro-${i}`, l.text, english("intro", l, i)) })),
  demo: DEMO.map((l, i) => ({ ...l, ...voice(`demo-${l.id}`, l.text, english("demo", l, i)) })),
  outro: OUTRO.map((l, i) => ({ ...l, ...voice(`outro-${i}`, l.text, english("outro", l, i)) })),
});

// ---- Recording helpers -------------------------------------------------

async function recorder(browser, name) {
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: TMP, size: SIZE }, colorScheme: "light" });
  const page = await context.newPage();
  const born = Date.now();
  return {
    page,
    now: () => (Date.now() - born) / 1000,
    async finish() {
      const video = page.video();
      await context.close();
      const file = path.join(TMP, `${name}${SUFFIX}.webm`);
      renameSync(await video.path(), file);
      return file;
    },
  };
}

// Explainer scenes: each lasts as long as its line plus a pause.
async function recordScenes(browser, name, items) {
  const rec = await recorder(browser, name);
  await rec.page.addInitScript((r) => (window.__REC = r), {
    scenes: items.map((l) => l.scene),
    durs: items.map((l) => l.dur + PAD),
    caps: items.map((l) => l.caption),
  });
  await rec.page.goto(`file://${path.join(HERE, "explainer.html")}`);
  await rec.page.evaluate(() => document.fonts.ready);
  await sleep(800);
  const start = rec.now();
  await rec.page.evaluate(() => window.__START());
  await rec.page.waitForFunction(() => window.__DONE === true, null, { timeout: 600_000 });
  const video = await rec.finish();
  let t = 0;
  const cues = items.map((l) => {
    const cue = { at: t, ...l };
    t += l.dur + PAD;
    return cue;
  });
  return { video, start, length: t, cues };
}

// ---- The live app ------------------------------------------------------

const OVERLAY = `
  (() => {
    document.documentElement.style.zoom = "1.45";
    const s = document.createElement("style");
    s.textContent = \`
      #vcap { position: fixed; left: 0; right: 0; bottom: 0; z-index: 99; padding: 16px 8vw 20px;
        background: linear-gradient(180deg, transparent, rgb(4 14 11 / .9) 32%); color: #f2f7f5;
        font: 500 17px/1.45 "Space Grotesk", system-ui, sans-serif; text-align: center; text-wrap: balance; pointer-events: none; }
      #vtag { position: fixed; top: 12px; right: 16px; z-index: 99; padding: 5px 11px; border-radius: 6px;
        background: rgb(11 42 34 / .85); color: #e0a100; font: 600 10px "IBM Plex Mono", monospace;
        letter-spacing: .08em; text-transform: uppercase; pointer-events: none; }
      html { scroll-behavior: smooth; }
      .page { padding-bottom: 110px; }\`;
    document.head.appendChild(s);
    const c = document.createElement("div"); c.id = "vcap"; document.body.appendChild(c);
    const t = document.createElement("div"); t.id = "vtag"; t.textContent = "Live app · localtaste.revenuerush.in";
    document.body.appendChild(t);
  })();`;

async function scrollTo(page, selector, offset = 70) {
  await page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const zoom = parseFloat(document.documentElement.style.zoom || "1");
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off / zoom, behavior: "smooth" });
    },
    [selector, offset],
  );
  await sleep(900);
}

// Clicks inside the page itself: mouse coordinates can miss under zoom.
const press = (page, selector, text) =>
  page.evaluate(
    ([sel, txt]) => {
      const el = [...document.querySelectorAll(sel)].find((e) => !txt || e.textContent.includes(txt));
      if (!el) throw new Error(`Nothing matches ${sel} ${txt ?? ""}`);
      el.click();
    },
    [selector, text],
  );

const ACTIONS = {
  async home(page) {
    await page.getByText("What does your neighbourhood love?").waitFor();
    await sleep(1200);
  },
  async address(page) {
    const box = page.getByRole("combobox").first();
    await box.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await box.pressSequentially("chikkaban", { delay: 90 });
    await page.locator(".addr-list li button").nth(1).waitFor({ timeout: 15_000 });
    await sleep(2600);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await box.pressSequentially("Indiranagar", { delay: 90 });
    await page.locator(".addr-list li button", { hasText: "Indiranagar, Bengaluru" }).first().waitFor({ timeout: 15_000 });
    await sleep(1400);
    await page.locator(".addr-list li button", { hasText: "Indiranagar, Bengaluru" }).first().click();
  },
  async building(page) {
    await press(page, "form.onboard button");
    await sleep(600);
    await page.locator(".sugg").first().waitFor({ timeout: 180_000 });
  },
  async map(page) {
    await sleep(500);
    await scrollTo(page, ".card:has(.venues)", 40);
    await sleep(2500);
    await scrollTo(page, ".map", 60);
  },
  async cafe(page) {
    await scrollTo(page, ".insights", 40);
  },
  async suggestions(page) {
    await scrollTo(page, ".card.plan", 40);
    await sleep(3500);
    await scrollTo(page, ".grid .sugg:nth-child(4)", 60);
  },
  async why(page) {
    await scrollTo(page, ".grid .sugg:nth-child(4)", 60);
    await page.evaluate(() => document.querySelectorAll(".grid .sugg")[3]?.querySelector(".link")?.click());
  },
  async act(page) {
    await scrollTo(page, ".card.plan", 40);
    await page.evaluate(() => document.querySelector(".actions button")?.focus());
  },
  async ask(page) {
    await scrollTo(page, ".ask", 40);
    await sleep(800);
    await press(page, ".ask .chip", "Why not pizza?");
    await page.locator(".reply").first().waitFor({ timeout: 180_000 });
    await scrollTo(page, ".ask", 40);
  },
  async branch(page) {
    await scrollTo(page, ".grow", 40);
    await press(page, ".grow button", "Find matching areas");
    await page.locator(".branches").waitFor({ timeout: 180_000 });
  },
  async rival(page) {
    const input = page.getByPlaceholder(/A café or restaurant in/);
    await input.pressSequentially("Third Wave Coffee", { delay: 45 });
    await press(page, ".grow form button");
    await page.locator(".rival").waitFor({ timeout: 180_000 });
    await scrollTo(page, ".grow", 40);
  },
};

async function recordDemo(browser, items) {
  log("rehearsing the app flow to warm the cache");
  const warm = await browser.newContext({ viewport: SIZE });
  const wp = await warm.newPage();
  await wp.goto(APP);
  for (const l of items) await ACTIONS[l.id](wp);
  await warm.close();

  log("recording the app");
  const rec = await recorder(browser, "demo");
  const { page } = rec;
  await page.goto(APP);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(OVERLAY);
  await sleep(800);
  const start = rec.now();
  const cues = [];
  for (const l of items) {
    const at = rec.now() - start;
    await page.evaluate((text) => (document.getElementById("vcap").textContent = text), l.caption);
    const t0 = Date.now();
    try {
      await ACTIONS[l.id](page);
    } catch (err) {
      await page.screenshot({ path: path.join(TMP, `fail-${l.id}.png`) });
      console.log("FAILED at", l.id);
      throw err;
    }
    const left = (l.dur + PAD) * 1000 - (Date.now() - t0);
    if (left > 0) await sleep(left);
    cues.push({ at, ...l });
    log(`  ${l.id} at ${at.toFixed(1)}s`);
  }
  const length = rec.now() - start;
  return { video: await rec.finish(), start, length, cues };
}

// ---- Assembly ----------------------------------------------------------

function encode(part, name) {
  const out = path.join(TMP, `${name}${SUFFIX}.mp4`);
  const inputs = ["-ss", part.start.toFixed(3), "-i", part.video];
  const mix = [];
  part.cues.forEach((c, i) => {
    inputs.push("-i", c.wav);
    mix.push(`[${i + 1}:a]adelay=delays=${Math.round(c.at * 1000)}:all=1[a${i}]`);
  });
  const filter = `${mix.join(";")};${part.cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${part.cues.length}:normalize=0[a]`;
  execFileSync(ffmpeg, [
    "-y", "-loglevel", "error", ...inputs,
    "-filter_complex", filter, "-map", "0:v", "-map", "[a]",
    "-t", part.length.toFixed(3), "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out,
  ]);
  return out;
}

const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

function assemble(parts) {
  const files = parts.map((p, i) => encode(p, `part-${i}`));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = path.join(OUT, `localtaste-demo${SUFFIX}.mp4`);
  const ins = files.flatMap((f) => ["-i", f]);
  const cat = files.map((_, i) => `[${i}:v][${i}:a]`).join("") + `concat=n=${files.length}:v=1:a=1[v0][a0]`;
  const fades = `[v0]fade=t=in:st=0:d=0.8,fade=t=out:st=${(total - 1).toFixed(2)}:d=1[v];[a0]loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st=${(total - 1).toFixed(2)}:d=1[a]`;
  execFileSync(ffmpeg, [
    "-y", "-loglevel", "error", ...ins, "-filter_complex", `${cat};${fades}`, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k", out,
  ]);
  let offset = 0;
  const srt = [];
  const spoken = [];
  for (const p of parts) {
    for (const c of p.cues) {
      const span = `${srtTime(offset + c.at)} --> ${srtTime(offset + c.at + c.dur)}`;
      srt.push(`${srt.length + 1}\n${span}\n${c.caption}\n`);
      spoken.push(`${spoken.length + 1}\n${span}\n${c.spoken ?? c.text}\n`);
    }
    offset += p.length;
  }
  writeFileSync(path.join(OUT, `localtaste-demo${SUFFIX}.srt`), srt.join("\n"));
  // Non-English versions also get subtitles in the spoken language.
  if (LANG !== "en") writeFileSync(path.join(OUT, `localtaste-demo${SUFFIX}.${LANG}.srt`), spoken.join("\n"));
  return { out, total };
}

// ---- Main --------------------------------------------------------------

const step = process.argv[2] ?? "all";
const saved = path.join(TMP, `parts${SUFFIX}.json`);
const parts = existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")) : {};
const save = () => writeFileSync(saved, JSON.stringify(parts, null, 2));

log("preparing narration");
const L = lines();
log(`narration: ${[...L.intro, ...L.demo, ...L.outro].reduce((a, l) => a + l.dur, 0).toFixed(0)}s of speech`);
if (step === "voice") process.exit(0);

const browser = ["all", "intro", "demo", "outro"].includes(step) ? await chromium.launch() : null;
if (step === "all" || step === "intro") {
  log("recording intro scenes");
  parts.intro = await recordScenes(browser, "intro", L.intro);
  save();
}
if (step === "all" || step === "demo") {
  parts.demo = await recordDemo(browser, L.demo);
  save();
}
if (step === "all" || step === "outro") {
  log("recording outro scenes");
  parts.outro = await recordScenes(browser, "outro", L.outro);
  save();
}
await browser?.close();

if (step === "all" || step === "assemble") {
  log("assembling");
  const { out, total } = assemble([parts.intro, parts.demo, parts.outro]);
  log(`done: ${out} (${Math.floor(total / 60)}m ${Math.round(total % 60)}s)`);
}
