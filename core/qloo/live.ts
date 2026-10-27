// Live Qloo source: runs harness workflows in-process via
// createDirectQlooWorkflowExecutorFromEnvironment, which reads QLOO_API_KEY
// (plus QLOO_BASE_URL / QLOO_TRUSTED_BASE_URL for the hackathon gateway).
// The key only ever lives in the Lambda environment (Amplify secret).

import { createDirectQlooWorkflowExecutorFromEnvironment } from "@qloo/qloo-harness";
import type { AreaTaste, Domain, Evidence, QlooOperation, QlooSource, TasteSignal } from "./types.ts";
import { QlooError } from "./types.ts";

type Executor = NonNullable<ReturnType<typeof createDirectQlooWorkflowExecutorFromEnvironment>>;
let executor: Executor | undefined;

// The normalized envelope every harness workflow returns (fields we use).
export interface QlooResult {
  status: "ok" | "empty" | "needs_input" | "partial" | "degraded" | "error";
  summary?: string;
  results?: unknown;
  warnings?: string[];
  error?: { code: string; recovery: string };
}

// A Qloo entity or tag as the harness compacts it.
export interface QlooItem {
  entity_id?: string;
  id?: string;
  name?: string;
  type?: string;
  subtype?: string;
  popularity?: number;
  affinity?: number;
  properties?: { short_description?: string; description?: string };
}

export async function qlooExec(operation: QlooOperation, input: Record<string, unknown>): Promise<QlooResult> {
  executor ??= createDirectQlooWorkflowExecutorFromEnvironment();
  if (!executor) throw new QlooError("QLOO_NOT_CONFIGURED", "Qloo is not configured (missing QLOO_API_KEY).");
  try {
    const run = await executor.execute(operation, input as never);
    return run.result as unknown as QlooResult;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "QLOO_FAILED";
    const message = code === "QLOO_RATE_LIMIT" ? "Qloo rate limit reached. Try again shortly." : `Qloo ${operation} failed (${code}).`;
    throw new QlooError(code, message);
  }
}

// Results are usually an array; tolerate `{entities}` / `{tags}` wrappers.
export function resultItems(result: QlooResult): QlooItem[] {
  const r = result.results as unknown;
  const list = Array.isArray(r) ? r : ((r as { entities?: unknown[]; tags?: unknown[] } | undefined)?.entities ?? (r as { tags?: unknown[] } | undefined)?.tags ?? []);
  return (list as QlooItem[]).filter((x) => x && typeof x.name === "string");
}

export const DOMAIN_TARGET: Record<Domain, string> = { dining: "place", music: "artist", film_tv: "tv_show", brand: "brand" };

export function domainOf(targetType: string): Domain {
  const t = targetType.replace("urn:entity:", "");
  if (t === "place") return "dining";
  if (t === "artist" || t === "album") return "music";
  if (t === "tv_show" || t === "movie") return "film_tv";
  return "brand";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Turns harness results into TasteSignals. Qloo affinity is relative to the
// query; popularity is global, so low popularity + high affinity = local quirk.
export function toSignals(items: QlooItem[], domain: Domain, evidence: Evidence, idPrefix: string = domain): TasteSignal[] {
  return items.map((item) => ({
    id: `${idPrefix}:${slug(item.name!)}`,
    name: item.name!,
    domain,
    affinity: Math.round((item.affinity ?? 0) * 100) / 100,
    ...(typeof item.popularity === "number" ? { popularity: Math.round(item.popularity * 100) / 100 } : {}),
    tags: [item.subtype, item.type].filter((t): t is string => !!t).map((t) => t.replace(/^urn:(tag|entity):/, "").replace(/[:_]/g, " ")),
    ...(item.properties?.short_description ? { note: item.properties.short_description } : {}),
    evidence,
  }));
}

// Qloo geocodes `signal_location` itself; a street-level address can miss, so
// fall back to the trailing "Area, City" part.
function locationCandidates(location: string): string[] {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  const out = [location.trim()];
  if (parts.length > 2) out.push(parts.slice(-2).join(", "));
  return out;
}

async function recommendIn(location: string, targetType: string, extra: Record<string, unknown> = {}) {
  for (const loc of locationCandidates(location)) {
    const input = { target_type: targetType, signal_location: loc, limit: 8, explain: false, ...extra };
    const result = await qlooExec("recommend", input);
    const items = resultItems(result);
    if (items.length) return { loc, input, items };
  }
  return undefined;
}

export const liveSource: QlooSource = {
  mode: "live",
  async areaTaste(location: string): Promise<AreaTaste> {
    const signals: TasteSignal[] = [];
    let label = location.trim();

    // Music, film/TV and brands: what the area's audience over-indexes on.
    const media = await Promise.all(
      (["music", "film_tv", "brand"] as const).map(async (domain) => ({ domain, hit: await recommendIn(location, DOMAIN_TARGET[domain]) })),
    );
    for (const { domain, hit } of media) {
      if (!hit) continue;
      label = hit.loc;
      signals.push(...toSignals(hit.items, domain, { operation: "recommend", input: hit.input, source: "live" }));
    }

    // Dining: the venues the area favours, then the concepts (cuisines, styles)
    // that characterize them, which is what a menu can act on.
    const places = await recommendIn(location, "place", { filter_location: locationCandidates(location).at(-1) });
    if (places) {
      label = places.loc;
      const ids = places.items.map((p) => p.entity_id).filter((id): id is string => !!id).slice(0, 6);
      if (ids.length) {
        const input = { entities: ids, entity_type: "place", limit: 12 };
        const tags = resultItems(await qlooExec("entity_tags", input));
        signals.push(...toSignals(tags, "dining", { operation: "entity_tags", input: { ...input, entities: places.items.slice(0, 6).map((p) => p.name) }, source: "live" }));
      }
      signals.push(
        ...toSignals(places.items.slice(0, 5), "dining", { operation: "recommend", input: places.input, source: "live" }, "venue").map((s) => ({ ...s, tags: [...s.tags, "venue"] })),
      );
    }

    if (!signals.length) throw new QlooError("QLOO_EMPTY", `Qloo had no taste data for "${location}". Try a neighbourhood and city, e.g. "Indiranagar, Bengaluru".`);
    const city = label.split(",").at(-1)?.trim() ?? label;
    return { query: location, label, city, source: "live", signals };
  },
};
