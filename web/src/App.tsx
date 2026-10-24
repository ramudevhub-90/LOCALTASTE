import { useEffect, useState } from "react";
import type { AnalyzeResult, AreaComparison, AreaTaste, Domain, Suggestion, TasteSignal } from "./api.ts";
import { DOMAIN_LABEL, analyze, compare, getAreas } from "./api.ts";

const DEMO_MENU = "Cappuccino\nPour-over coffee\nMasala chai\nCroissant\nAvocado toast\nBrownie";
const KIND_LABEL: Record<Suggestion["kind"], string> = { menu: "Menu idea", playlist: "Playlist", theme_night: "Theme night" };

export function App() {
  const [areas, setAreas] = useState<string[]>([]);
  const [location, setLocation] = useState("12th Main, Indiranagar, Bengaluru");
  const [menu, setMenu] = useState(DEMO_MENU);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAreas().then((r) => setAreas(r.areas)).catch(() => {});
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(await analyze(location, menu.split("\n").map((m) => m.trim()).filter(Boolean)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
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
        <button disabled={busy}>{busy ? "Reading the neighbourhood…" : "Get taste advice"}</button>
        {error && <p className="error">{error}</p>}
      </form>

      {result && <Results result={result} />}
      {result && <Compare home={result.area} areas={areas} />}

      <footer className="foot">
        Results describe aggregate neighbourhood affinities from Qloo, not any individual's preferences.
      </footer>
    </div>
  );
}

function Results({ result }: { result: AnalyzeResult }) {
  const byId = new Map(result.area.signals.map((s) => [s.id, s]));
  return (
    <>
      <section className="card">
        <div className="row">
          <h2>Taste map · {result.area.label}</h2>
          {result.area.source === "sample" && <span className="pill warn">Sample data</span>}
        </div>
        <TasteMap area={result.area} />
      </section>
      <section className="card">
        <h2>Suggestions</h2>
        <div className="grid">
          {result.suggestions.map((s, i) => (
            <SuggestionCard key={i} s={s} signals={s.evidence.map((id) => byId.get(id)).filter((x): x is TasteSignal => !!x)} />
          ))}
        </div>
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
            .map((s) => (
              <div key={s.id} className="bar" title={`Affinity ${s.affinity.toFixed(2)}`}>
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
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide evidence" : "Why this?"}
      </button>
      {open && (
        <ul className="evidence">
          {signals.map((sig) => (
            <li key={sig.id}>
              <strong>{sig.name}</strong> · affinity {sig.affinity.toFixed(2)}
              {sig.lift ? `, ${sig.lift.toFixed(1)}× city baseline` : ""}
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

function Compare({ home, areas }: { home: AreaTaste; areas: string[] }) {
  const [other, setOther] = useState("");
  const [cmp, setCmp] = useState<AreaComparison | null>(null);
  const [error, setError] = useState("");
  const options = areas.filter((a) => a !== home.label);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setCmp(await compare(home.query, other || options[0]));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card">
      <h2>Compare with another area</h2>
      <form className="row" onSubmit={run}>
        <input placeholder={options[0] ?? "Second branch location"} value={other} onChange={(e) => setOther(e.target.value)} list="areas" />
        <button>Compare</button>
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
