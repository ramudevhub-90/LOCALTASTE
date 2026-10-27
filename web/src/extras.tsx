// Panels around the agent's suggestions: the owner's café vs the neighbourhood,
// the area's crowd, follow-up questions, growth tools and plan actions.

import { useState } from "react";
import type { AskReply, BranchResult, CompetitorResult, Crowd, Insights, RunResult, Standing, Suggestion, TasteSignal } from "./api.ts";
import { runFollowUp } from "./api.ts";
import { calendarFile, download, planText, schedule } from "./plan.ts";

const AGE_LABEL: Record<string, string> = {
  "24_and_younger": "Under 25",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55+",
};

export function InsightsPanel({ insights, area }: { insights: Insights; area: RunResult["area"] }) {
  const hood = area.label.split(",")[0];
  if (!insights.standing && !insights.crowd && !insights.cafeName) return null;
  return (
    <section className="card insights">
      {insights.cafeName && (
        <div>
          <h2>Your café vs {hood}</h2>
          {insights.standing ? (
            <StandingView s={insights.standing} city={area.city} />
          ) : (
            <p className="muted">
              Couldn't find “{insights.cafeName}” on Qloo near {hood}. New or very small places may not be listed yet; the rest of the
              analysis still applies.
            </p>
          )}
        </div>
      )}
      {insights.crowd && (
        <div>
          <h2>Who {hood}'s crowd is</h2>
          <CrowdChart crowd={insights.crowd} compare={insights.cafeCrowd} compareLabel={insights.cafe?.name} />
          <p className="note">
            Aggregate skew of the audiences of {insights.crowd.basedOn.join(", ")} vs Qloo's general audience. Bars to the right are
            over-represented.
          </p>
        </div>
      )}
    </section>
  );
}

function StandingView({ s, city }: { s: Standing; city: string }) {
  const top = s.ranked[0]?.affinity || 1;
  return (
    <>
      <p className="big">
        #{s.position} <span>of {s.of}</span>
      </p>
      <p className="muted">
        Among the neighbourhood's favourite venues, ranked by fit with {city}'s favourite artists and shows (Qloo rank).
      </p>
      <ol className="ranked">
        {s.ranked.map((r) => (
          <li key={r.name} className={r.isCafe ? "you" : ""}>
            <span className="fill" style={{ width: `${Math.max(8, (r.affinity / top) * 100)}%` }} />
            <span className="name">{r.isCafe ? `${r.name} (you)` : r.name}</span>
            <span className="num">{(r.affinity * 100).toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

export function CrowdChart({ crowd, compare, compareLabel }: { crowd: Crowd; compare?: Crowd; compareLabel?: string }) {
  const max = Math.max(0.2, ...Object.values(crowd.age).map(Math.abs), ...Object.values(compare?.age ?? {}).map(Math.abs));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const female = crowd.gender.female ?? 0;
  return (
    <div className="crowd">
      {compare && (
        <p className="legend">
          <span className="key area" /> Area <span className="key cafe" /> {compareLabel ?? "Your café"}
        </p>
      )}
      {Object.keys(AGE_LABEL).map((k) => (
        <div key={k} className="crowd-row">
          <span className="label">{AGE_LABEL[k]}</span>
          <span className="track">
            <Skew v={crowd.age[k] ?? 0} max={max} cls="area" />
            {compare && <Skew v={compare.age[k] ?? 0} max={max} cls="cafe" />}
          </span>
          <span className="num">{(crowd.age[k] ?? 0) > 0 ? "+" : ""}{pct(crowd.age[k] ?? 0)}</span>
        </div>
      ))}
      <p className="muted">
        Gender skew: {Math.abs(female) < 0.03 ? "balanced" : `${pct(Math.abs(female))} more ${female > 0 ? "women" : "men"} than average`}
      </p>
    </div>
  );
}

function Skew({ v, max, cls }: { v: number; max: number; cls: string }) {
  const w = (Math.abs(v) / max) * 50;
  return <span className={`skew ${cls}`} style={{ left: v >= 0 ? "50%" : `${50 - w}%`, width: `${w}%` }} />;
}

export function PlanActions({ result }: { result: RunResult }) {
  const [copied, setCopied] = useState(false);
  const events = schedule(result);
  return (
    <div className="actions">
      <button
        type="button"
        className="ghost"
        onClick={() => download(`localtaste-${result.area.label.split(",")[0].toLowerCase().replace(/\W+/g, "-")}.ics`, calendarFile(result), "text/calendar")}
        disabled={!events.length}
      >
        Add {events.length} events to calendar
      </button>
      <button
        type="button"
        className="ghost"
        onClick={async () => {
          await navigator.clipboard.writeText(planText(result));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy plan"}
      </button>
      <button type="button" className="ghost" onClick={() => window.print()}>
        Print
      </button>
    </div>
  );
}

const QUESTIONS = ["Why not pizza?", "Ideas under ₹150 a plate", "What works for weekday mornings?", "A dessert that fits this crowd"];

export function AskAgent({ result, onSignals }: { result: RunResult; onSignals: (s: TasteSignal[]) => void }) {
  const [q, setQ] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [replies, setReplies] = useState<AskReply[]>([]);
  const city = result.area.city.toLowerCase();
  const chips = QUESTIONS.map((x) => (/bengaluru|bangalore|mumbai|delhi|chennai|hyderabad|pune|kolkata/.test(city) ? x : x.replace("₹150", "$10")));

  async function ask(question: string) {
    if (!question.trim()) return;
    setError("");
    setStep("Starting…");
    try {
      const reply = await runFollowUp<AskReply>(result.jobId, "ask", question, setStep);
      onSignals(reply.extra);
      setReplies((r) => [reply, ...r]);
      setQ("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStep("");
    }
  }

  return (
    <section className="card ask">
      <h2>Ask the agent</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input placeholder="e.g. Why not pizza?" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} />
        <button disabled={!!step}>{step || "Ask"}</button>
      </form>
      <div className="chips">
        {chips.map((c) => (
          <button key={c} type="button" className="chip" disabled={!!step} onClick={() => void ask(c)}>
            {c}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {replies.map((r, i) => (
        <div key={i} className="reply">
          <p className="q">{r.question}</p>
          <p>{r.answer}</p>
          {r.why && <p className="why">{r.why}</p>}
          {r.suggestions.length > 0 && (
            <ul className="mini">
              {r.suggestions.map((s: Suggestion, j: number) => (
                <li key={j}>
                  <strong>{s.title}</strong> — {s.pitch}
                  {s.why && <span className="why-inline"> {s.why}</span>}
                </li>
              ))}
            </ul>
          )}
          {r.trace.length > 0 && <p className="note">Qloo calls: {r.trace.map((t) => t.outcome).join(" · ")}</p>}
        </div>
      ))}
    </section>
  );
}

export function GrowTools({ result }: { result: RunResult }) {
  const hood = result.area.label.split(",")[0];
  const [branch, setBranch] = useState<BranchResult | null>(null);
  const [rival, setRival] = useState<CompetitorResult | null>(null);
  const [name, setName] = useState("");
  const [step, setStep] = useState<{ which: string; text: string } | null>(null);
  const [error, setError] = useState("");

  async function go<T>(which: string, kind: "branch" | "competitor", input: string, set: (v: T) => void) {
    setError("");
    setStep({ which, text: "Starting…" });
    try {
      set(await runFollowUp<T>(result.jobId, kind, input, (text) => setStep({ which, text })));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStep(null);
    }
  }

  return (
    <section className="card grow">
      <div>
        <h2>Where should your next branch go?</h2>
        <p className="muted">Finds the parts of {result.area.city} where {hood}'s favourite venues are also popular (Qloo heatmaps).</p>
        <button type="button" disabled={!!step} onClick={() => void go<BranchResult>("branch", "branch", "", setBranch)}>
          {step?.which === "branch" ? step.text : "Find matching areas"}
        </button>
        {branch && (
          <ol className="branches">
            {branch.areas.length === 0 && <li>No clear matches outside {hood} yet.</li>}
            {branch.areas.map((a) => (
              <li key={a.name}>
                <strong>{a.name}</strong>
                <span className="muted"> · favourites popular there: {a.venues.join(", ")}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <h2>Check a competitor</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void go<CompetitorResult>("rival", "competitor", name.trim(), setRival);
          }}
        >
          <input placeholder={`A café or restaurant in ${hood}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <button disabled={!!step}>{step?.which === "rival" ? step.text : "Check"}</button>
        </form>
        {rival && (
          <div className="rival">
            <p>
              <strong>{rival.competitor.name}</strong>
              {rival.competitor.description && <span className="muted"> — {rival.competitor.description}</span>}
            </p>
            {rival.standing && (
              <p>
                Ranks <strong>#{rival.standing.position} of {rival.standing.of}</strong> among {hood}'s favourites for fit with {result.area.city}'s taste.
              </p>
            )}
            {rival.shared.length > 0 && (
              <p>
                Traits its audience shares with {result.insights?.cafe ? "yours" : `${hood}'s favourites`}:{" "}
                {rival.shared.map((t) => t.name).join(", ")}.
              </p>
            )}
            {rival.crowd && result.insights?.crowd && (
              <CrowdChart crowd={result.insights.crowd} compare={rival.crowd} compareLabel={rival.competitor.name} />
            )}
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
