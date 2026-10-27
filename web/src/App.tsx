import { useState } from "react";
import type { AreaComparison, AreaTaste, Domain, RunResult, Suggestion, TasteSignal } from "./api.ts";
import { DEMO_AREAS, DOMAIN_LABEL, runAnalysis } from "./api.ts";

const DEMO_MENU = "Cappuccino\nPour-over coffee\nMasala chai\nCroissant\nAvocado toast\nBrownie";
const KIND_LABEL: Record<Suggestion["kind"], string> = { menu: "Menu idea", playlist: "Playlist", theme_night: "Theme night" };

export function App() {
  const areas = DEMO_AREAS;
  const [location, setLocation] = useState("12th Main, Indiranagar, Bengaluru");
  const [menu, setMenu] = useState(DEMO_MENU);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState("");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setStep("Starting…");
    setError("");
    try {
      setResult(await runAnalysis({ location, menu: menu.split("\n").map((m) => m.trim()).filter(Boolean) }, setStep));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStep("");
    }
  }

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo">☕</span> Localtaste
        </div>
        <p className="tag">Neighbourhood taste research for independent cafés, powered by Qloo.</p>
      </header>

      <form className="card onboard" onSubmit={run}>
        <h1>What does your neighbourhood love?</h1>
        <label>
          Café address or neighbourhood
          <input value={location} onChange={(e) => setLocation(e.target.value)} list="areas" required />
          <datalist id="areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
        </label>
        <label>
          Current menu <span className="hint">(one item per line)</span>
          <textarea value={menu} onChange={(e) => setMenu(e.target.value)} rows={6} />
        </label>
        <button disabled={!!step}>{step || "Get taste advice"}</button>
        {error && <p className="error">{error}</p>}
      </form>

      {result && <Results result={result} />}
      {result && <Compare home={result.area} menu={menu} areas={areas} />}

      <footer className="foot">
        Results describe aggregate neighbourhood affinities from Qloo, not any individual's preferences.
      </footer>
    </div>
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
          {result.area.source === "sample" ? <span className="pill warn">Sample data</span> : <span className="pill">Live Qloo</span>}
        </div>
        <TasteMap area={result.area} />
      </section>
      <section className="card">
        <div className="row">
          <h2>Suggestions</h2>
          <span className="pill">{result.writer === "bedrock" ? `Written by ${modelLabel(result.model)}` : "Template writer"}</span>
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
            <h3>Stronger in {cmp.a.label}</h3>
            <ul>{cmp.onlyA.map((s) => <li key={s.id}>{s.name} <small>{DOMAIN_LABEL[s.domain]}</small></li>)}</ul>
          </div>
          <div>
            <h3>Stronger in {cmp.b.label}</h3>
            <ul>{cmp.onlyB.map((s) => <li key={s.id}>{s.name} <small>{DOMAIN_LABEL[s.domain]}</small></li>)}</ul>
          </div>
        </div>
      )}
    </section>
  );
}
