import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "./agent.ts";
import { QlooError, SAMPLE_AREAS, compareAreas, getAreaTaste, qlooMode } from "./qloo/index.ts";

const app = express();
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, qloo: qlooMode, claude: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.get("/api/areas", (_req, res) => {
  res.json({ areas: SAMPLE_AREAS });
});

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

app.post("/api/analyze", async (req, res, next) => {
  try {
    const location = text(req.body?.location);
    if (!location) return res.status(400).json({ error: "Enter your café's address or neighbourhood." });
    const menu = (Array.isArray(req.body?.menu) ? req.body.menu : [])
      .map((m: unknown) => text(m, 80))
      .filter(Boolean)
      .slice(0, 60);
    const area = await getAreaTaste(location);
    res.json(analyze(area, menu));
  } catch (err) {
    next(err);
  }
});

app.post("/api/compare", async (req, res, next) => {
  try {
    const a = text(req.body?.a);
    const b = text(req.body?.b);
    if (!a || !b) return res.status(400).json({ error: "Enter two locations to compare." });
    res.json(await compareAreas(a, b));
  } catch (err) {
    next(err);
  }
});

const dist = fileURLToPath(new URL("../web/dist", import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile("index.html", { root: dist }));
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof QlooError) {
    const status = err.code === "QLOO_RATE_LIMIT" ? 429 : 502;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Localtaste on http://localhost:${port} (qloo: ${qlooMode})`));
