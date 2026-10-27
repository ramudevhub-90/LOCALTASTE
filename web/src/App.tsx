import { useState } from "react";
import type { AreaComparison, AreaTaste, Domain, RunResult, Suggestion, TasteSignal } from "./api.ts";
import { DEMO_AREAS, DOMAIN_LABEL, runAnalysis } from "./api.ts";
import { AskAgent, GrowTools, InsightsPanel, PlanActions } from "./extras.tsx";
import { spotifySearch } from "./plan.ts";

const DEMO_MENU = "Cappuccino\nPour-over coffee\nMasala chai\nCroissant\nAvocado toast\nBrownie";
const KIND_LABEL: Record<Suggestion["kind"], string> = { menu: "Menu idea", playlist: "Playlist", theme_night: "Theme night" };

export function App() {
  const areas = DEMO_AREAS;
  const [location, setLocation] = useState("12th Main, Indiranagar, Bengaluru");
  const [menu, setMenu] = useState(DEMO_MENU);
  const [cafe, setCafe] = useState("Glens Bakehouse");
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState("");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setStep("Starting…");
    setError("");
    try {
      setResult(await runAnalysis({ location, menu: menu.split("\n").map((m) => m.trim()).filter(Boolean), cafe: cafe.trim() || undefined }, setStep));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStep("");
    }
  }

  return (
    <>
      <header className="band">
        <div className="band-inner">
          <div className="brand">
            <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M16 2c-6 0-11 4.6-11 10.6C5 21 16 30 16 30s11-9 11-17.4C27 6.6 22 2 16 2z" fill="var(--saffron)" />
              <path d="M11 11h10v3.5a5 5 0 0 1-10 0z" fill="var(--band)" />
              <path d="M21 12h1.2a1.8 1.8 0 0 1 0 3.6H21" fill="none" stroke="var(--band)" strokeWidth="1.4" />
            </svg>
            Localtaste
          </div>
          <p className="tag">Neighbourhood taste research for independent cafés, powered by Qloo.</p>
        </div>
      </header>

      <div className="page">
        <form className="card onboard" onSubmit={run}>
          <h1>What does your neighbourhood love?</h1>
          <label>
            Café address or neighbourhood
            <input value={location} onChange={(e) => setLocation(e.target.value)} list="areas" required />
            <datalist id="areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
          </label>
          <label>
            Your café's name <span className="hint">(optional: see how it stands against the neighbourhood)</span>
            <input value={cafe} onChange={(e) => setCafe(e.target.value)} placeholder="e.g. Glens Bakehouse" maxLength={120} />
          </label>
          <label>
            Current menu <span className="hint">(one item per line)</span>
            <textarea value={menu} onChange={(e) => setMenu(e.target.value)} rows={6} />
          </label>
          <button disabled={!!step}>{step || "Get taste advice"}</button>
          {error && <p className="error">{error}</p>}
        </form>

        {result && <Results result={result} />}
        {result && result.area.source === "live" && (
          <AskAgent
            result={result}
            onSignals={(extra) => setResult((r) => (r ? { ...r, area: { ...r.area, signals: [...r.area.signals, ...extra.filter((x) => !r.area.signals.some((s) => s.id === x.id))] } } : r))}
          />
        )}
        {result && result.area.source === "live" && <GrowTools result={result} />}
        {result && <Compare home={result.area} menu={menu} areas={areas} />}

        <footer className="foot">
          Results describe aggregate neighbourhood affinities from Qloo, not any individual's preferences.
        </footer>
      </div>
    </>
  );
}

// "us.amazon.nova-pro-v1:0" → "Amazon Nova Pro"
function modelLabel(id = "") {
  const known: Record<string, string> = { "nova-pro": "Amazon Nova Pro", "nova-2-lite": "Amazon Nova 2 Lite", "nova-lite": "Amazon Nova Lite" };
  return Object.entries(known).find(([k]) => id.includes(k))?.[1] ?? id.replace(/^us\./, "");
}

function Results({ result }: { result: RunResult }) {
  const byId = new Map(result.area.signals.map((s) => [s.id, s]));
  return (
    <>
      <section className="card">
        <div className="row">
          <h2>Taste map · {result.area.label}</h2>
          {result.area.source === "sample" ? <span className="pill warn">Sample data</span> : <span className="pill live">Live Qloo</span>}
        </div>
        <Favourites area={result.area} />
        <TasteMap area={result.area} />
      </section>
      {result.insights && <InsightsPanel insights={result.insights} area={result.area} />}
      <section className="card plan">
        <div className="row">
          <h2>Suggestions</h2>
          <span className="pill">{result.writer === "bedrock" ? `Written by ${modelLabel(result.model)}` : "Template writer"}</span>
          <PlanActions result={result} />
        </div>
        {result.summary && <p className="summary">{result.summary}</p>}
        <div className="grid">
          {result.suggestions.map((s, i) => (
            <SuggestionCard key={i} s={s} signals={s.evidence.map((id) => byId.get(id)).filter((x): x is TasteSignal => !!x)} />
          ))}
        </div>
        {result.trace && result.trace.length > 0 && (
          <details className="trace">
            <summary>How the agent worked ({result.trace.length} steps)</summary>
            <ol>
              {result.trace.map((t, i) => (
                <li key={i}>
                  <code>{t.tool}</code> {Object.keys(t.input).length > 0 && <code>{JSON.stringify(t.input)}</code>} → {t.outcome}
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>
    </>
  );
}

// The neighbourhood's favourite venues, with Qloo's photo and description.
function Favourites({ area }: { area: AreaTaste }) {
  const venues = area.signals.filter((s) => s.id.startsWith("venue:")).slice(0, 6);
  if (!venues.some((v) => v.image)) return null;
  return (
    <div className="venues">
      {venues.map((v) => (
        <figure key={v.id} className="venue">
          {v.image ? <img src={v.image} alt="" loading="lazy" /> : <div className="ph" />}
          <figcaption>
            <strong>{v.name}</strong>
            {v.note && <span>{v.note}</span>}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function TasteMap({ area }: { area: AreaTaste }) {
  const domains = Object.keys(DOMAIN_LABEL) as Domain[];
  return (
    <div className="map">
      {domains.map((d) => (
        <div key={d} className="col">
          <h3>{DOMAIN_LABEL[d]}</h3>
          {area.signals
            .filter((s) => s.domain === d)
            .sort((a, b) => b.affinity - a.affinity)
            .slice(0, 8)
            .map((s) => (
              <div key={s.id} className="bar" title={`Affinity ${s.affinity.toFixed(2)}${s.popularity !== undefined ? ` · global popularity ${s.popularity.toFixed(2)}` : ""}`}>
                <span className="fill" style={{ width: `${s.affinity * 100}%` }} />
                <span className="name">{s.name}</span>
                {s.lift && s.lift > 1 && <span className="lift">×{s.lift.toFixed(1)}</span>}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function SuggestionCard({ s, signals }: { s: Suggestion; signals: TasteSignal[] }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`sugg ${s.kind}`}>
      <span className="kind">{KIND_LABEL[s.kind]}</span>
      <h3>{s.title}</h3>
      <p>{s.pitch}</p>
      {s.why && <p className="why">{s.why}</p>}
      {s.kind === "playlist" && (
        <p className="links">
          {signals
            .filter((g) => g.domain === "music")
            .map((g) => (
              <a key={g.id} href={spotifySearch(g.name)} target="_blank" rel="noreferrer">
                {g.name} ↗
              </a>
            ))}
        </p>
      )}
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide evidence" : "Why this?"}
      </button>
      {open && (
        <ul className="evidence">
          {signals.map((sig) => (
            <li key={sig.id}>
              <strong>{sig.name}</strong> · affinity {sig.affinity.toFixed(2)}
              {sig.lift ? `, ${sig.lift.toFixed(1)}× city baseline` : ""}
              {sig.popularity !== undefined ? `, global popularity ${sig.popularity.toFixed(2)}` : ""}
              <code>
                qloo exec {sig.evidence.operation} {JSON.stringify(sig.evidence.input)}
              </code>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Compare({ home, menu, areas }: { home: AreaTaste; menu: string; areas: string[] }) {
  const [other, setOther] = useState("");
  const [cmp, setCmp] = useState<AreaComparison | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState("");
  const options = areas.filter((a) => a !== home.label);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStep("Starting…");
    try {
      const items = menu.split("\n").map((m) => m.trim()).filter(Boolean);
      const res = await runAnalysis({ location: home.query, menu: items, compareWith: other || options[0] }, setStep);
      setCmp(res.comparison ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStep("");
    }
  }

  return (
    <section className="card">
      <h2>Compare with another area</h2>
      <form className="row" onSubmit={run}>
        <input placeholder={options[0] ?? "Second branch location"} value={other} onChange={(e) => setOther(e.target.value)} list="areas" />
        <button disabled={!!step}>{step || "Compare"}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {cmp && (
        <div className="cmp">
          <div>
            <h3>Only in {cmp.a.label}</h3>
            <ul>{cmp.onlyA.map((s) => <li key={s.id}>{s.name} <small>{DOMAIN_LABEL[s.domain]}</small></li>)}</ul>
          </div>
          <div>
            <h3>Only in {cmp.b.label}</h3>
            <ul>{cmp.onlyB.map((s) => <li key={s.id}>{s.name} <small>{DOMAIN_LABEL[s.domain]}</small></li>)}</ul>
          </div>
        </div>
      )}
    </section>
  );
}
