// Deterministic suggestion writer: turns neighbourhood taste signals plus the
// owner's menu into suggestions. Used when the Bedrock model is unavailable, and as the
// fallback if the Bedrock agent (agent-bedrock.ts) fails.

import type { AreaTaste, Domain, TasteSignal } from "./qloo/index.ts";

export type SuggestionKind = "menu" | "playlist" | "theme_night";

export interface Suggestion {
  kind: SuggestionKind;
  title: string;
  pitch: string;
  // Ids of the TasteSignals that justify it ("why this?").
  evidence: string[];
}

// One tool call the agent made, shown in the UI as the agent's working.
export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  outcome: string;
}

export interface AnalyzeResult {
  area: AreaTaste;
  suggestions: Suggestion[];
  writer: "template" | "bedrock";
  // Bedrock model id that wrote the suggestions (writer "bedrock").
  model?: string;
  // Short overview from the agent (Bedrock writer only).
  summary?: string;
  trace?: AgentStep[];
}

const score = (s: TasteSignal) => s.affinity * (s.lift ?? 1);
const ranked = (area: AreaTaste, d: Domain) => area.signals.filter((s) => s.domain === d).sort((a, b) => score(b) - score(a));
const pct = (lift?: number) => (lift && lift > 1 ? `${Math.round((lift - 1) * 100)}% above the city average` : "strong locally");

function onMenu(menu: string[], s: TasteSignal): boolean {
  const words = [s.name, ...s.tags].flatMap((t) => t.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 3);
  return menu.some((item) => words.some((w) => item.toLowerCase().includes(w)));
}

export function analyze(area: AreaTaste, menu: string[]): AnalyzeResult {
  const dining = ranked(area, "dining").filter((s) => !s.tags.includes("venue"));
  const music = ranked(area, "music");
  const film = ranked(area, "film_tv");
  const suggestions: Suggestion[] = [];
  // Live Qloo resolves media taste at city level, so say so honestly.
  const mediaScope = area.source === "live" ? `${area.city} audiences over-index on` : `${area.label} over-indexes on`;

  for (const s of dining.filter((d) => !onMenu(menu, d)).slice(0, 3)) {
    suggestions.push({
      kind: "menu",
      title: `Try a ${s.name.toLowerCase()} special`,
      pitch: `Affinity for ${s.name.toLowerCase()} in ${area.label} runs ${pct(s.lift)}, and nothing on your current menu covers it yet.`,
      evidence: [s.id],
    });
  }

  const picks = music.slice(0, 4);
  if (picks.length) {
    suggestions.push({
      kind: "playlist",
      title: `In-store playlist: ${picks.map((m) => m.name).slice(0, 2).join(" × ")}`,
      pitch: `Build a playlist around ${picks.map((m) => m.name).join(", ")}: the artists ${mediaScope}.`,
      evidence: picks.map((m) => m.id),
    });
  }

  for (const show of film.slice(0, 2)) {
    const food = dining.find((d) => d.tags.some((t) => show.tags.some((st) => st.split(" ")[0] === t.split(" ")[0]))) ?? dining[0];
    if (!food) continue;
    suggestions.push({
      kind: "theme_night",
      title: `${show.name} night with ${food.name.toLowerCase()}`,
      pitch: `${mediaScope} ${show.name} (${pct(show.lift)}). Pair a watch-party evening with a ${food.name.toLowerCase()} special.`,
      evidence: [show.id, food.id],
    });
  }

  return { area, suggestions, writer: "template" };
}
