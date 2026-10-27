// The Localtaste agent: a model on Amazon Bedrock (Amazon Nova Pro by default,
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
  resultItems,
  splitLocation,
  toSignals,
} from "./qloo/index.ts";

export const MODEL = process.env.BEDROCK_MODEL_ID ?? "us.amazon.nova-pro-v1:0";
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
You turn Qloo's aggregate neighbourhood taste data into concrete, low-cost ideas an owner can try this month.

How to work:
- Start with get_area_taste for the café's location. It returns signals with ids:
  - dining: the neighbourhood's own favoured venues (tag "venue") and food concepts; you know many of these venues, so use what they serve as a hint to local appetite;
  - vibe: Qloo audience and ambience tags for the people who favour those venues;
  - music, film_tv, brand: what the wider city's audience over-indexes on (Qloo resolves cities, not neighbourhoods, as an audience).
- When live Qloo is available, use qloo_recommend to dig further where it would sharpen an idea, e.g. places near the café that fans of a top artist or show also favour (pass the artist or show in "signals", target_type "place"), or tags found with qloo_find_tags. Two or three extra calls is usually plenty.
- Be specific: name real dishes, drinks, artists and shows, and say in the pitch which signal makes it fit this area.
- Finish by calling submit_suggestions exactly once.

What to suggest:
- 3 menu additions the area over-indexes on that the current menu does not cover. Make them specific dishes or drinks that suit a small café kitchen.
- 1 in-store playlist built from the area's music signals.
- 2 theme nights that pair a film/TV or music signal with food.
- Optionally 1 more idea of any kind if the data clearly supports it.

Rules:
- Every suggestion cites 1-4 signal ids in "evidence", taken only from tool results. Never invent ids.
- Signals are aggregate neighbourhood affinities. Never describe or imply anything about individuals.
- Affinity is relative to the query, popularity is global; a high-affinity, lower-popularity signal is a distinctive local taste.
- Keep pitches to one or two plain sentences and say why it fits this area.`;

const toolDefs = [
  {
    name: "get_area_taste",
    description:
      "Qloo taste signals for a neighbourhood: food & drink concepts and favoured venues, artists, TV shows and brands the area over-indexes on. Call this first.",
    input_schema: {
      type: "object",
      properties: { location: { type: "string", description: "Neighbourhood and city, e.g. 'Indiranagar, Bengaluru'." } },
      required: ["location"],
      additionalProperties: false,
    },
  },
  {
    name: "qloo_recommend",
    description:
      "Qloo recommend workflow: entities with high affinity for a combined taste profile. Put named things (artists, shows, venues) in signals, concepts (cuisines, moods, genres) in signal_tags, the audience area in signal_location. Live Qloo only.",
    input_schema: {
      type: "object",
      properties: {
        target_type: { type: "string", enum: ["place", "artist", "tv_show", "movie", "brand"] },
        signals: { type: "array", items: { type: "string" }, maxItems: 5 },
        signal_tags: { type: "array", items: { type: "string" }, maxItems: 5 },
        signal_location: { type: "string" },
        filter_location: { type: "string", description: "Constrain results to this area (useful for places)." },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["target_type"],
      additionalProperties: false,
    },
  },
  {
    name: "qloo_find_tags",
    description: "Find Qloo tags (cuisines, genres, moods) matching a phrase, for use as signal_tags. Live Qloo only.",
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
              evidence: { type: "array", items: { type: "string" } },
            },
            required: ["kind", "title", "pitch", "evidence"],
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

const compact = (s: TasteSignal) => ({
  id: s.id,
  name: s.name,
  domain: s.domain,
  affinity: s.affinity,
  ...(s.popularity !== undefined ? { popularity: s.popularity } : {}),
  ...(s.lift !== undefined ? { lift: s.lift } : {}),
  ...(s.tags.length ? { tags: s.tags } : {}),
});

const STEP_TEXT: Record<string, (input: Record<string, unknown>) => string> = {
  get_area_taste: (i) => `Mapping taste around ${i.location}…`,
  qloo_recommend: (i) => `Asking Qloo for ${String(i.target_type).replace("_", " ")} matches…`,
  qloo_find_tags: (i) => `Looking up Qloo tags for "${i.query}"…`,
  submit_suggestions: () => "Writing suggestions…",
};

export async function runAgent(
  location: string,
  menu: string[],
  opts: { cache?: TasteCache; onStep?: (text: string) => Promise<unknown> | void; useLlm?: boolean } = {},
): Promise<AnalyzeResult> {
  const cache = opts.cache ?? memoryCache;
  const onStep = opts.onStep ?? (() => {});
  const area = await getAreaTaste(location, cache);
  if (opts.useLlm === false || !llmAvailable()) return analyze(area, menu);
  try {
    return await agentLoop(area, location, menu, cache, onStep);
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
  cache: TasteCache,
  onStep: (text: string) => Promise<unknown> | void,
): Promise<AnalyzeResult> {
  const pool = new Map(area.signals.map((s) => [s.id, s]));
  const extra: TasteSignal[] = [];
  const trace: AgentStep[] = [];
  let calls = 0;

  async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
    if (name === "get_area_taste") {
      const loc = String(input.location ?? location);
      const t = loc.trim().toLowerCase() === location.trim().toLowerCase() ? area : await getAreaTaste(loc, cache);
      t.signals.forEach((s) => pool.has(s.id) || (pool.set(s.id, s), extra.push(s)));
      trace.push({ tool: name, input: { location: loc }, outcome: `${t.signals.length} signals (${t.source} data)` });
      return JSON.stringify({ label: t.label, source: t.source, signals: t.signals.map(compact) });
    }
    if (qlooMode() !== "live") {
      trace.push({ tool: name, input, outcome: "skipped: sample mode" });
      return "Live Qloo is not configured in this environment; work with get_area_taste signals only.";
    }
    if (name === "qloo_find_tags") {
      const res = await qlooExec("find_tags", { query: input.query, limit: 5 });
      const tags = resultItems(res).map((t) => ({ id: t.id, name: t.name }));
      trace.push({ tool: name, input, outcome: `${tags.length} tags` });
      return JSON.stringify({ status: res.status, tags });
    }
    if (name === "qloo_recommend") {
      const n = ++calls;
      // Models often pass signal ids or the neighbourhood; Qloo needs names and
      // resolves only cities as an audience (neighbourhoods work as a place filter).
      const { city, area: hood } = splitLocation(location);
      const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => pool.get(String(x))?.name ?? String(x)) : undefined);
      const signals = names(input.signals);
      const qInput: Record<string, unknown> = {
        target_type: input.target_type,
        ...(signals?.length ? { signals } : {}),
        ...(Array.isArray(input.signal_tags) && input.signal_tags.length ? { signal_tags: input.signal_tags } : {}),
        signal_location: city,
        ...(input.target_type === "place" ? { filter_location: hood } : {}),
        limit: Math.min(Number(input.limit) || 6, 10),
        explain: false,
      };
      const res = await qlooExec("recommend", qInput);
      const domain = domainOf(String(input.target_type));
      const found = toSignals(resultItems(res), domain, { operation: "recommend", input: qInput, source: "live" }, `r${n}`);
      found.forEach((s) => pool.has(s.id) || (pool.set(s.id, s), extra.push(s)));
      trace.push({ tool: name, input: qInput, outcome: found.length ? `${found.length} results` : `no results (${res.status})` });
      return JSON.stringify({ status: res.status, ...(res.summary ? { summary: res.summary } : {}), signals: found.map(compact) });
    }
    return `Unknown tool ${name}.`;
  }

  const messages: Message[] = [
    {
      role: "user",
      content: [{ text: `Café location: ${location}\nCurrent menu: ${menu.length ? menu.join("; ") : "(not given)"}\nQloo data mode: ${qlooMode()}` }],
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await bedrock().send(
      new ConverseCommand({
        modelId: MODEL,
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
    const submit = uses.find((u) => u.name === "submit_suggestions");
    if (submit) return finish(submit.input as unknown as Submitted);
    if (!uses.length) throw new Error("agent ended without submitting suggestions");

    const results: ContentBlock[] = [];
    for (const use of uses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
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

  type Submitted = { summary: string; suggestions: Suggestion[] };
  function finish(out: Submitted): AnalyzeResult {
    // Validate here: Converse does not enforce the tool schema.
    const kinds = new Set(["menu", "playlist", "theme_night"]);
    const suggestions = (Array.isArray(out?.suggestions) ? out.suggestions : [])
      .filter((s) => kinds.has(s?.kind) && typeof s.title === "string" && typeof s.pitch === "string")
      .map((s) => ({ kind: s.kind, title: s.title, pitch: s.pitch, evidence: [...new Set(Array.isArray(s.evidence) ? s.evidence : [])].filter((id) => pool.has(id)) }))
      .filter((s) => s.evidence.length > 0);
    if (suggestions.length < 3) throw new Error(`only ${suggestions.length} suggestions cited valid evidence`);
    trace.push({ tool: "submit_suggestions", input: {}, outcome: `${suggestions.length} suggestions` });
    return { area: { ...area, signals: [...area.signals, ...extra] }, suggestions, writer: "bedrock", model: MODEL, summary: typeof out.summary === "string" ? out.summary : undefined, trace };
  }
}
