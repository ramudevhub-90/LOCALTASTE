// Live Qloo source: runs harness workflows in-process via
// createDirectQlooWorkflowExecutorFromEnvironment, which reads QLOO_API_KEY
// (plus QLOO_BASE_URL / QLOO_TRUSTED_BASE_URL for the hackathon gateway).
// The key only ever lives in the Lambda environment (Amplify secret).

import { createDirectQlooWorkflowExecutorFromEnvironment } from "@qloo/qloo-harness";
import { type GeoPlace, addressHas, geocode } from "../geo.ts";
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
  properties?: { short_description?: string; description?: string; address?: string; image?: { url?: string }; price_level?: number; business_rating?: number };
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

export const DOMAIN_TARGET: Partial<Record<Domain, string>> = { dining: "place", music: "artist", film_tv: "tv_show", brand: "brand" };

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
// Tags keep the Qloo tag kind, e.g. "audience" from urn:tag:audience:qloo.
export function toSignals(items: QlooItem[], domain: Domain, evidence: Evidence, idPrefix: string = domain): TasteSignal[] {
  return items.map((item) => ({
    id: `${idPrefix}:${slug(item.name!)}`,
    name: item.name!,
    domain,
    affinity: Math.round((item.affinity ?? 0) * 100) / 100,
    ...(typeof item.popularity === "number" ? { popularity: Math.round(item.popularity * 100) / 100 } : {}),
    tags: item.type?.startsWith("urn:tag:") ? [item.type.split(":")[2]] : [],
    ...(item.properties?.short_description ? { note: item.properties.short_description } : {}),
    ...((item.entity_id ?? item.id) ? { qlooId: item.entity_id ?? item.id } : {}),
    ...(item.properties?.image?.url ? { image: item.properties.image.url } : {}),
    ...(item.properties?.address ? { address: item.properties.address } : {}),
    evidence,
  }));
}

// Qloo resolves cities as an audience (`signal_location`) but not
// neighbourhoods; a neighbourhood works as a geographic filter written as
// "Area, City". So: city-level audience taste for media and brands, and the
// neighbourhood's own venues (plus who likes them) for the local flavour.
export function splitLocation(location: string): { city: string; area: string } {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  const city = parts.at(-1) ?? location.trim();
  return { city, area: parts.length >= 2 ? parts.slice(-2).join(", ") : city };
}

// Qloo audience/ambience tags that describe a crowd; cuisines and venue genres
// describe food. Media genres and keywords (from fans' other tastes) are noise here.
const VIBE_TAG = /:(audience|ambience|good_for|style|influencer_appeal|cost_description):/;
const FOOD_TAG = /:(genre|cuisine|category):place|:cuisine:/;

// Hotels, malls and big chains say little about a neighbourhood's own taste.
const NOT_LOCAL = /hotel|oberoi|\btaj\b|marriott|hyatt|hilton|sheraton|conrad|orchid|mall|burger king|mcdonald|kfc|domino|pizza hut|subway|starbucks|stadium|airport/i;
export const isLocalVenue = (name: string) => !NOT_LOCAL.test(name);

// The café's place: our own geocode when available (live), else the text split.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function resolvePlace(location: string): Promise<{ hood: string; city: string; filter: string; place?: GeoPlace }> {
  const place = await geocode(location).catch((err) => (console.warn("geocode failed", err), undefined));
  const split = splitLocation(location);
  const city = place?.city ?? split.city;
  // Keep the owner's spelling when it is the same place ("Indiranagar" vs "Indira Nagar").
  const typed = location.split(",").map((p) => p.trim()).find((p) => place?.district && squash(p) === squash(place.district));
  const hood = typed ?? place?.district ?? split.area.split(",")[0].trim();
  return { hood, city, filter: [hood, city, place?.region].filter(Boolean).join(", "), place };
}

// Qloo's own location filter can land in the wrong city, so keep only venues
// whose address names the city (or the café's postcode); if too few survive,
// take the city's favourites that sit in the neighbourhood instead.
async function localVenues(hood: string, city: string, filter: string, place?: GeoPlace) {
  const inCity = (v: QlooItem) => addressHas(v.properties?.address, city) || addressHas(v.properties?.address, place?.postcode);
  const inHood = (v: QlooItem) => addressHas(v.properties?.address, hood) || addressHas(v.properties?.address, place?.postcode);
  const input = { target_type: "place", signal_location: city, filter_location: filter, limit: 15, explain: false };
  let venues = resultItems(await qlooExec("recommend", input)).filter((v) => isLocalVenue(v.name!) && inCity(v));
  if (venues.length >= 4) return { venues, input };
  const wide = { target_type: "place", signal_location: city, filter_location: [city, place?.region].filter(Boolean).join(", "), limit: 20, explain: false };
  const near = resultItems(await qlooExec("recommend", wide)).filter((v) => isLocalVenue(v.name!) && inHood(v));
  const seen = new Set(venues.map((v) => v.entity_id));
  venues = [...venues, ...near.filter((v) => !seen.has(v.entity_id))];
  return { venues, input: venues.length > 0 && near.length > 0 ? wide : input };
}

export const liveSource: QlooSource = {
  mode: "live",
  async areaTaste(location: string): Promise<AreaTaste> {
    const { hood, city, filter, place } = await resolvePlace(location);
    const signals: TasteSignal[] = [];

    const media = await Promise.all(
      (["music", "film_tv", "brand"] as const).map(async (domain) => {
        const input = { target_type: DOMAIN_TARGET[domain]!, signal_location: city, limit: 8, explain: false };
        return { domain, input, items: resultItems(await qlooExec("recommend", input)) };
      }),
    );
    for (const { domain, input, items } of media) signals.push(...toSignals(items, domain, { operation: "recommend", input, source: "live" }));

    const { venues, input: placeInput } = await localVenues(hood, city, filter, place);
    const picked = venues.slice(0, 8);
    signals.push(...toSignals(picked, "dining", { operation: "recommend", input: placeInput, source: "live" }, "venue").map((s) => ({ ...s, tags: ["venue"] })));

    const ids = picked.map((v) => v.entity_id).filter((id): id is string => !!id);
    if (ids.length) {
      const input = { entities: ids, entity_type: "place", limit: 20 };
      const tags = resultItems(await qlooExec("entity_tags", input));
      const evidence = { operation: "entity_tags" as const, input: { ...input, entities: picked.map((v) => v.name) }, source: "live" as const };
      signals.push(...toSignals(tags.filter((t) => FOOD_TAG.test(t.type ?? "")), "dining", evidence, "food"));
      signals.push(...toSignals(tags.filter((t) => VIBE_TAG.test(t.type ?? "")), "vibe", evidence));
    }

    if (!signals.length) throw new QlooError("QLOO_EMPTY", `Qloo had no taste data for "${location}". Try a neighbourhood and city, e.g. "Williamsburg, Brooklyn".`);
    return {
      query: location,
      label: `${hood}, ${city}`,
      city,
      source: "live",
      signals,
      placeFilter: filter,
      ...(place ? { geo: { lat: place.lat, lon: place.lon, country: place.country, postcode: place.postcode } } : {}),
    };
  },
};
