// The Localtaste agent: a model on Amazon Bedrock (Amazon Nova 2 Lite by default,
// via the model-neutral Converse API) decides which Qloo workflows to run for
// this café, then submits suggestions that must cite the signals it was shown.
// Any failure (no model access, bad output) falls back to the template writer.

import {
  BedrockRuntimeClient,
  type ContentBlock,
  ConverseCommand,
  type Message,
  type Tool,
  type ToolResultBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { type AgentStep, type AnalyzeResult, type Suggestion, analyze } from "./agent.ts";
import {
  type AreaTaste,
  type TasteCache,
  type TasteSignal,
  domainOf,
  getAreaTaste,
  memoryCache,
  qlooExec,
  qlooMode,
  isLocalVenue,
  resultItems,
  splitLocation,
  toSignals,
} from "./qloo/index.ts";

export const MODEL = process.env.BEDROCK_MODEL_ID ?? "us.amazon.nova-2-lite-v1:0";
const MAX_TURNS = 8;

// Bedrock model access is per account. When it is denied, skip the model for
// a while instead of paying for a failed call on every run.
let deniedUntil = 0;
export const llmAvailable = () => process.env.LLM_PROVIDER === "bedrock" && Date.now() > deniedUntil;

// With BEDROCK_ROLE_ARN set, Bedrock runs in another account (the one with
// model access) through an invoke-only role, as Reminisce does for SES.
// The provider refreshes the role's temporary credentials itself.
const roleArn = process.env.BEDROCK_ROLE_ARN;
let client: BedrockRuntimeClient | undefined;
export const bedrock = () =>
  (client ??= new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1",
    ...(roleArn ? { credentials: fromTemporaryCredentials({ params: { RoleArn: roleArn, RoleSessionName: "localtaste-worker" } }) } : {}),
  }));

function noteAccessError(err: unknown) {
  const name = (err as { name?: string }).name;
  if (name === "AccessDeniedException" || name === "ResourceNotFoundException" || name === "ThrottlingException") deniedUntil = Date.now() + 10 * 60_000;
}

const SYSTEM = `You are Localtaste, a taste advisor for independent cafés and small restaurants.
You turn Qloo's aggregate taste data into concrete, low-cost ideas an owner can try this month.

You are given the area's Qloo signals up front, each with an id:
- dining: the neighbourhood's own favoured venues (tag "venue") and food concepts. You know many of these venues; what they serve hints at local appetite.
- vibe: Qloo audience and ambience tags for the people who favour those venues.
- music, film_tv, brand: what the wider city's audience over-indexes on (Qloo resolves cities, not neighbourhoods, as an audience).

How to work:
1. Pick the 3-4 most promising leads in the signals, e.g. a top artist, a TV show, a favoured venue or a vibe.
2. Dig deeper with qloo_recommend, one lead per call, and say what you are testing in "purpose". Good calls:
   - places near the café that fans of an artist or show also favour (signals: [that artist or show], target_type "place");
   - artists that fans of a favoured local venue like (signals: [venue name], target_type "artist") for the playlist;
   - TV shows or films that fans of a local venue like, for theme nights.
   Pass signals as ids exactly as listed (e.g. "music:anirudh-ravichander"). Use qloo_find_tags first if you want a cuisine or genre as signal_tags. Make at least 2 and at most 5 qloo_recommend calls.
3. Call submit_suggestions once, building ideas on what the deeper calls found as well as the starting signals.

What to suggest:
- 3 menu additions the current menu does not cover, each citing at least one dining signal: specific dishes or drinks a small café kitchen can make.
- 1 in-store playlist of 5-8 named artists.
- 2 theme nights pairing a specific show, film or artist with specific food, each citing that show or artist's signal id.
- Optionally 1 more idea of any kind if the data clearly supports it.

For every suggestion:
- "evidence": 1-4 signal ids taken only from the data you were given or tool results. Never invent ids.
- "pitch": one or two plain sentences on what to do.
- "why": a short note on which evidence makes it fit (the app shows the Qloo facts behind each cited id).

Rules:
- Build every idea on specific venues, artists, shows or food concepts. Vibe tags may support an idea but never carry it alone.
- Menu ideas come from what the favoured local venues are known for. Name a venue in the pitch only if you know what it serves.
- The playlist uses the city's music signals plus any artists your deeper calls found.
- Signals are aggregate affinities. Never describe or imply anything about individuals.
- Affinity is relative to the query; popularity is global. High affinity with lower popularity marks a distinctive local taste.
- Do not suggest what is already on the menu.`;

const toolDefs = [
  {
    name: "qloo_recommend",
    description:
      "Qloo recommend workflow: entities that people with this taste also have high affinity for, within the café's city (places are limited to the café's neighbourhood). Put named things (artists, shows, venues) or their signal ids in signals, concepts (cuisines, moods, genres) in signal_tags.",
    input_schema: {
      type: "object",
      properties: {
        purpose: { type: "string", description: "The idea this call tests, in a few words." },
        target_type: { type: "string", enum: ["place", "artist", "tv_show", "movie", "brand"] },
        signals: { type: "array", items: { type: "string" }, maxItems: 5 },
        signal_tags: { type: "array", items: { type: "string" }, maxItems: 5 },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["purpose", "target_type"],
      additionalProperties: false,
    },
  },
  {
    name: "qloo_find_tags",
    description: "Find Qloo tags (cuisines, genres, moods) matching a phrase, for use as signal_tags.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_suggestions",
    description: "Submit the final suggestions for the owner. Call once, at the end.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Two sentences on what makes this area's taste distinctive." },
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["menu", "playlist", "theme_night"] },
              title: { type: "string" },
              pitch: { type: "string" },
              why: { type: "string" },
              evidence: { type: "array", items: { type: "string" } },
            },
            required: ["kind", "title", "pitch", "why", "evidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "suggestions"],
      additionalProperties: false,
    },
  },
];

const tools: Tool[] = toolDefs.map((t) => ({
  toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.input_schema as never } },
}));

// One signal per line keeps the prompt short and easy for the model to cite.
const line = (s: TasteSignal) =>
  [s.id, s.name, s.domain, `affinity ${s.affinity}`, s.popularity !== undefined ? `popularity ${s.popularity}` : "", s.lift ? `lift ${s.lift}` : "", s.tags.join("/")]
    .filter(Boolean)
    .join(" | ");

const STEP_TEXT: Record<string, (input: Record<string, unknown>) => string> = {
  qloo_recommend: (i) => (i.purpose ? `Checking with Qloo: ${i.purpose}…` : `Asking Qloo for ${String(i.target_type).replace("_", " ")} matches…`),
  qloo_find_tags: (i) => `Looking up Qloo tags for "${i.query}"…`,
  submit_suggestions: () => "Writing suggestions…",
};

const MIN_DEEP_CALLS = 2;

// Models cite signals loosely: the full id, the id without its "domain:"
// prefix, or the name. Accept all three.
function findSignal(pool: Map<string, TasteSignal>, ref: unknown): TasteSignal | undefined {
  const r = String(ref).trim().toLowerCase();
  const hit = pool.get(String(ref).trim());
  if (hit) return hit;
  for (const s of pool.values()) if (s.id.toLowerCase() === r || s.id.split(":").slice(1).join(":").toLowerCase() === r || s.name.toLowerCase() === r) return s;
  return undefined;
}

export async function runAgent(
  location: string,
  menu: string[],
  opts: { cache?: TasteCache; onStep?: (text: string) => Promise<unknown> | void; useLlm?: boolean; model?: string } = {},
): Promise<AnalyzeResult> {
  const cache = opts.cache ?? memoryCache;
  const onStep = opts.onStep ?? (() => {});
  const area = await getAreaTaste(location, cache);
  if (opts.useLlm === false || !llmAvailable()) return analyze(area, menu);
  try {
    return await agentLoop(area, location, menu, onStep, opts.model ?? MODEL);
  } catch (err) {
    noteAccessError(err);
    console.error("bedrock agent failed, using template", err);
    return analyze(area, menu);
  }
}

async function agentLoop(
  area: AreaTaste,
  location: string,
  menu: string[],
  onStep: (text: string) => Promise<unknown> | void,
  model: string,
): Promise<AnalyzeResult> {
  const pool = new Map(area.signals.map((s) => [s.id, s]));
  const extra: TasteSignal[] = [];
  const trace: AgentStep[] = [{ tool: "get_area_taste", input: { location }, outcome: `${area.signals.length} signals (${area.source} data)` }];
  const live = qlooMode() === "live";
  let calls = 0;
  let fruitful = 0;
  let nudged = false;
  let retried = false;
  const asked = new Map<string, string>();

  async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
    if (!live) {
      trace.push({ tool: name, input, outcome: "skipped: sample mode" });
      return "Live Qloo is not configured in this environment; work with the signals you were given.";
    }
    if (name === "qloo_find_tags") {
      const res = await qlooExec("find_tags", { query: input.query, limit: 5 });
      const tags = resultItems(res).map((t) => ({ id: t.id, name: t.name }));
      trace.push({ tool: name, input, outcome: `${tags.length} tags` });
      return JSON.stringify({ status: res.status, tags });
    }
    if (name === "qloo_recommend") {
      if (calls >= 5) return "You have made enough Qloo calls; submit your suggestions now.";
      const key = JSON.stringify([input.target_type, input.signals, input.signal_tags]);
      if (asked.has(key)) return `You already made this call: ${asked.get(key)}. Try a different lead.`;
      const n = ++calls;
      // Models often pass signal ids or the neighbourhood; Qloo needs names and
      // resolves only cities as an audience (neighbourhoods work as a place filter).
      const { city, area: hood } = splitLocation(location);
      // Known signals go in by Qloo id (entities as signals, tags as signal_tags),
      // which Qloo accepts without the name resolution that often stalls.
      const byRef = (x: unknown) => findSignal(pool, x);
      const entities: string[] = [];
      const tags: string[] = [];
      for (const x of Array.isArray(input.signals) ? input.signals : []) {
        const s = byRef(x);
        if (s?.qlooId?.startsWith("urn:tag:")) tags.push(s.qlooId);
        else entities.push(s?.qlooId ?? s?.name ?? String(x));
      }
      for (const x of Array.isArray(input.signal_tags) ? input.signal_tags : []) tags.push(byRef(x)?.qlooId ?? String(x));
      const qInput: Record<string, unknown> = {
        target_type: input.target_type,
        ...(entities.length ? { signals: entities.slice(0, 5) } : {}),
        ...(tags.length ? { signal_tags: tags.slice(0, 5) } : {}),
        signal_location: city,
        ...(input.target_type === "place" ? { filter_location: hood } : {}),
        limit: Math.min(Number(input.limit) || 6, 10),
        explain: false,
      };
      const res = await qlooExec("recommend", qInput);
      const domain = domainOf(String(input.target_type));
      // Drop what the area map already has, so deeper calls add something new.
      const known = new Set([...pool.values()].map((s) => s.name.toLowerCase()));
      const found = toSignals(resultItems(res), domain, { operation: "recommend", input: qInput, source: "live" }, `r${n}`).filter(
        (s) => !known.has(s.name.toLowerCase()) && (domain !== "dining" || isLocalVenue(s.name)),
      );
      found.forEach((s) => pool.has(s.id) || (pool.set(s.id, s), extra.push(s)));
      if (found.length) fruitful++;
      const label = input.purpose ? `${input.purpose}: ` : "";
      const shown = { ...qInput, signals: (Array.isArray(input.signals) ? input.signals : []).map((x) => byRef(x)?.name ?? x) };
      asked.set(key, found.length ? found.map((s) => s.name).join(", ") : "no new results");
      trace.push({ tool: name, input: shown, outcome: `${label}${found.length ? found.map((s) => s.name).slice(0, 4).join(", ") : `no new results (${res.status})`}` });
      const issue = res.status === "needs_input" ? { note: res.summary ?? "Qloo could not resolve those inputs; try names exactly as given in the signals." } : {};
      return JSON.stringify({ status: res.status, ...issue, signals: found.map((s) => ({ id: s.id, name: s.name, affinity: s.affinity, popularity: s.popularity })) });
    }
    return `Unknown tool ${name}.`;
  }

  const messages: Message[] = [
    {
      role: "user",
      content: [
        {
          text: [
            `Café location: ${location}`,
            `Current menu: ${menu.length ? menu.join("; ") : "(not given)"}`,
            `Qloo data: ${area.source}${live ? "" : " (sample; qloo_recommend is unavailable, so submit directly)"}`,
            `Area: ${area.label} (city: ${area.city})`,
            "",
            "Signals (id | name | domain | scores | tags):",
            ...area.signals.map(line),
          ].join("\n"),
        },
      ],
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await bedrock().send(
      new ConverseCommand({
        modelId: model,
        system: [{ text: SYSTEM }],
        messages,
        toolConfig: { tools },
        inferenceConfig: { maxTokens: 4096, temperature: 0.4 },
      }),
    );
    const content: ContentBlock[] = response.output?.message?.content ?? [];
    if (response.stopReason === "max_tokens" || response.stopReason === "content_filtered" || response.stopReason === "guardrail_intervened")
      throw new Error(`stopped: ${response.stopReason}`);
    messages.push({ role: "assistant", content });

    const uses = content.flatMap((b) => (b.toolUse ? [b.toolUse] : []));
    if (!uses.length) throw new Error("agent ended without submitting suggestions");

    const results: ContentBlock[] = [];
    for (const use of uses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
      if (use.name === "submit_suggestions") {
        // Push back once if it skipped the deeper Qloo work.
        if (live && fruitful < MIN_DEEP_CALLS && !nudged) {
          nudged = true;
          trace.push({ tool: "submit_suggestions", input: {}, outcome: "sent back: dig deeper with Qloo first" });
          results.push({
            toolResult: {
              toolUseId: use.toolUseId,
              content: [{ text: `Not yet: make at least ${MIN_DEEP_CALLS} qloo_recommend calls that return results, then submit again with ideas built on them.` }],
              status: "error",
            },
          });
          continue;
        }
        // On the retry, accept what is valid and fill gaps from the template.
        const done = finish(input as unknown as Submitted, retried);
        if (done.ok) return done.result;
        if (retried) throw new Error(done.reason);
        retried = true;
        console.warn("submit rejected", done.reason, JSON.stringify(input).slice(0, 2000));
        trace.push({ tool: "submit_suggestions", input: {}, outcome: `sent back: ${done.reason}` });
        results.push({ toolResult: { toolUseId: use.toolUseId, content: [{ text: `Rejected: ${done.reason}. Call submit_suggestions again with a JSON array of suggestions whose "evidence" lists signal ids exactly as given.` }], status: "error" } });
        continue;
      }
      await onStep(STEP_TEXT[use.name!]?.(input) ?? "Thinking…");
      let toolResult: ToolResultBlock;
      try {
        toolResult = { toolUseId: use.toolUseId, content: [{ text: await runTool(use.name!, input) }] };
      } catch (err) {
        trace.push({ tool: use.name!, input, outcome: `error: ${(err as Error).message}` });
        toolResult = { toolUseId: use.toolUseId, content: [{ text: (err as Error).message }], status: "error" };
      }
      results.push({ toolResult });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("agent ran out of turns");

  type Submitted = { summary: string; suggestions: Suggestion[] | string };

  // Each kind must rest on the right kind of evidence.
  function fits(kind: string, sig: TasteSignal) {
    if (kind === "menu") return sig.domain === "dining";
    if (kind === "playlist") return sig.domain === "music";
    return sig.domain === "film_tv" || sig.domain === "music";
  }

  // One true sentence per piece of evidence, from where the signal came from.
  function groundedWhy(sigs: TasteSignal[]): string {
    const { city } = splitLocation(location);
    const hood = area.label.split(",")[0].trim();
    const byQlooId = new Map([...pool.values()].filter((s) => s.qlooId).map((s) => [s.qlooId!, s.name]));
    const facts: string[] = [];
    const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
    const venues = sigs.filter((g) => g.id.startsWith("venue:")).map((g) => g.name);
    if (venues.length) facts.push(`${list(venues)} ${venues.length > 1 ? "are" : "is"} among ${hood}'s most favoured venues on Qloo`);
    const food = sigs.filter((g) => g.id.startsWith("food:")).map((g) => g.name);
    if (food.length) facts.push(`Qloo tags ${hood}'s favoured venues as ${list(food)}`);
    const media = sigs.filter((g) => /^(music|film_tv|brand):/.test(g.id)).map((g) => g.name);
    if (media.length) facts.push(`${city} audiences over-index on ${list(media)}`);
    const calls = new Map<string, TasteSignal[]>();
    for (const g of sigs.filter((g) => /^r\d+:/.test(g.id))) calls.set(g.id.split(":")[0], [...(calls.get(g.id.split(":")[0]) ?? []), g]);
    for (const found of calls.values()) {
      const input = found[0].evidence.input as { signals?: string[]; signal_tags?: string[]; target_type?: string };
      const from = [...(input.signals ?? []), ...(input.signal_tags ?? [])].map((x) => byQlooId.get(x) ?? x);
      const where = input.target_type === "place" ? ` in ${hood}` : "";
      facts.push(from.length ? `fans of ${list(from)} in ${city} also favour ${list(found.map((g) => g.name))}${where}` : `${city} audiences favour ${list(found.map((g) => g.name))}${where}`);
    }
    const vibes = sigs.filter((g) => g.id.startsWith("vibe:")).map((g) => `"${g.name}"`);
    if (vibes.length) facts.push(`Qloo describes fans of the area's venues as ${list(vibes)}`);
    const text = facts.slice(0, 3).join("; ");
    return text ? `${text[0].toUpperCase()}${text.slice(1)}.` : "";
  }
  function finish(out: Submitted, final = false): { ok: true; result: AnalyzeResult } | { ok: false; reason: string } {
    // Validate here: Converse does not enforce the tool schema. Models sometimes
    // send the array as a JSON string, or cite signal names instead of ids.
    const kinds = new Set(["menu", "playlist", "theme_night"]);
    let list: unknown = out?.suggestions;
    if (typeof list === "string") {
      try {
        list = JSON.parse(list);
      } catch {
        return { ok: false, reason: "suggestions was not valid JSON" };
      }
    }
    const toId = (x: unknown) => findSignal(pool, x)?.id;
    const suggestions: Suggestion[] = (Array.isArray(list) ? (list as Suggestion[]) : [])
      .filter((s) => kinds.has(s?.kind) && typeof s.title === "string" && typeof s.pitch === "string")
      .map((s) => {
        const cited = Array.isArray(s.evidence) ? s.evidence : typeof s.evidence === "string" ? [s.evidence] : [];
        const evidence = [...new Set(cited.map(toId).filter((id): id is string => !!id))];
        // "why" is written from the cited Qloo results, not the model's prose,
        // so it never claims a link the data does not show.
        return { kind: s.kind, title: s.title, pitch: s.pitch, why: groundedWhy(evidence.map((id) => pool.get(id)!)), evidence };
      })
      .filter((s) => s.evidence.some((id) => fits(s.kind, pool.get(id)!)));
    const count = (k: string) => suggestions.filter((s) => s.kind === k).length;
    if (final && suggestions.length >= 3) {
      const need: Record<string, number> = { menu: 2, playlist: 1, theme_night: 1 };
      for (const t of analyze(area, menu).suggestions) {
        if (count(t.kind) >= need[t.kind]) continue;
        suggestions.push({ ...t, why: groundedWhy(t.evidence.map((id) => pool.get(id)!).filter(Boolean)) });
        trace.push({ tool: "template", input: { kind: t.kind }, outcome: `filled missing ${t.kind.replace("_", " ")}` });
      }
    }
    const short = [
      count("menu") < 2 && "at least 2 menu ideas citing a dining signal (a venue, a food concept or a place your calls found)",
      count("playlist") < 1 && "1 playlist citing music signals",
      count("theme_night") < 1 && "at least 1 theme night citing the film_tv or music signal it is built on",
    ].filter(Boolean);
    if (short.length) return { ok: false, reason: `need ${short.join("; ")}` };
    trace.push({ tool: "submit_suggestions", input: {}, outcome: `${suggestions.length} suggestions` });
    return { ok: true, result: { area: { ...area, signals: [...area.signals, ...extra] }, suggestions, writer: "bedrock", model, summary: typeof out.summary === "string" ? out.summary : undefined, trace } };
  }
}
