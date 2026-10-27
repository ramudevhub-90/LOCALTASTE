// Extra Qloo analyses around the agent's suggestions: where the owner's café
// stands among the neighbourhood's favourites (rank), who the area's crowd is
// (audience_demographics), where else the same taste lives (where_popular), and
// how a competitor's audience differs (compare_audiences). Live Qloo only.

import { addressHas, reverseGeocode } from "./geo.ts";
import { type AreaTaste, type Evidence, type QlooItem, type TasteSignal, qlooExec, resultItems } from "./qloo/index.ts";

export interface VenueRef {
  id: string;
  name: string;
  address?: string;
  description?: string;
  image?: string;
}

export interface Standing {
  venue: VenueRef;
  position: number;
  of: number;
  // Local favourites ranked alongside it, best first.
  ranked: { name: string; affinity: number; isCafe: boolean }[];
  evidence: Evidence;
}

// Qloo demographic skew: positive = over-represented vs the general audience.
export interface Crowd {
  age: Record<string, number>;
  gender: Record<string, number>;
  basedOn: string[];
  evidence: Evidence;
}

export interface BranchArea {
  name: string;
  lat: number;
  lon: number;
  score: number;
  // Which of the area's favourites are popular there.
  venues: string[];
}

export interface CompetitorReport {
  competitor: VenueRef;
  standing?: Standing;
  crowd?: Crowd;
  shared: { name: string; score: number }[];
  evidence: Evidence[];
}

type Envelope = Awaited<ReturnType<typeof qlooExec>> & { resolution?: { issues?: { candidates?: (QlooItem & { id: string })[] }[] } };

const venueIds = (area: AreaTaste) => area.signals.filter((s) => s.id.startsWith("venue:") && s.qlooId).map((s) => ({ id: s.qlooId!, name: s.name }));

// Finds a named café on Qloo, preferring the candidate in the café's area.
export async function findVenue(name: string, area: AreaTaste): Promise<VenueRef | undefined> {
  const hood = area.label.split(",")[0].trim();
  // Already one of the area's favourites? Then no lookup is needed.
  const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const known = area.signals.find((s) => s.id.startsWith("venue:") && s.qlooId && squash(s.name) === squash(name));
  if (known) return { id: known.qlooId!, name: known.name, address: known.address, description: known.note, image: known.image };
  return (await lookUp(`${name}, ${hood}, ${area.city}`, area, hood)) ?? (await lookUp(name, area, hood));
}

async function lookUp(query: string, area: AreaTaste, hood: string): Promise<VenueRef | undefined> {
  const res = (await qlooExec("describe", { entity: query, type: "place" }).catch(() => undefined)) as Envelope | undefined;
  if (!res) return undefined;
  const direct = resultItems(res)[0];
  const candidates = res.resolution?.issues?.flatMap((i) => i.candidates ?? []) ?? [];
  const pick =
    candidates.find((c) => addressHas(c.properties?.address ?? (c as { address?: string }).address, hood)) ??
    candidates.find((c) => addressHas(c.properties?.address ?? (c as { address?: string }).address, area.city));
  const item = pick ?? direct;
  const id = item?.entity_id ?? (item as { id?: string } | undefined)?.id;
  if (!item?.name || !id) return undefined;
  const address = item.properties?.address ?? (item as { address?: string }).address;
  if (address && !addressHas(address, area.city)) return undefined;
  return {
    id,
    name: item.name,
    address,
    description: item.properties?.short_description ?? (item as { description?: string }).description,
    image: item.properties?.image?.url,
  };
}

// Ranks the café among the area's favourite venues for the city's audience.
export async function standing(venue: VenueRef, area: AreaTaste): Promise<Standing | undefined> {
  const locals = venueIds(area).filter((v) => v.id !== venue.id).slice(0, 7);
  if (!locals.length) return undefined;
  // City-level affinity saturates near 1 for every popular venue, so rank by
  // fit with the city's favourite artists and shows instead.
  const taste = area.signals.filter((s) => (s.domain === "music" || s.domain === "film_tv") && s.qlooId).slice(0, 4);
  const input = { options: [venue.id, ...locals.map((v) => v.id)], option_type: "place", signals: taste.map((s) => s.qlooId!), signal_location: area.city };
  const items = resultItems(await qlooExec("rank", input));
  const ranked = items
    .map((i) => ({ name: i.name!, affinity: Math.round((i.affinity ?? 0) * 10000) / 10000, isCafe: i.entity_id === venue.id }))
    .sort((a, b) => b.affinity - a.affinity);
  const position = ranked.findIndex((r) => r.isCafe) + 1;
  if (!position) return undefined;
  return {
    venue,
    position,
    of: ranked.length,
    ranked,
    evidence: { operation: "rank", input: { ...input, options: [venue.name, ...locals.map((v) => v.name)], signals: taste.map((s) => s.name) }, source: "live" },
  };
}

// Averages Qloo's demographic skew over a few venues' audiences.
export async function crowd(venues: { id: string; name: string }[]): Promise<Crowd | undefined> {
  const picked = venues.slice(0, 3);
  if (!picked.length) return undefined;
  const results = await Promise.all(picked.map((v) => qlooExec("audience_demographics", { entity: v.id, entity_type: "place" }).catch(() => undefined)));
  const rows = results.flatMap((r) => (r ? ((r.results as { query?: { age?: Record<string, number>; gender?: Record<string, number> } }[] | undefined) ?? []) : []));
  const usable = rows.map((r) => r.query).filter((q): q is { age?: Record<string, number>; gender?: Record<string, number> } => !!q?.age);
  if (!usable.length) return undefined;
  const avg = (key: "age" | "gender") => {
    const out: Record<string, number> = {};
    for (const q of usable) for (const [k, v] of Object.entries(q[key] ?? {})) out[k] = (out[k] ?? 0) + v / usable.length;
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  };
  return {
    age: avg("age"),
    gender: avg("gender"),
    basedOn: picked.map((v) => v.name),
    evidence: { operation: "audience_demographics", input: { entities: picked.map((v) => v.name), entity_type: "place" }, source: "live" },
  };
}

export const areaCrowd = (area: AreaTaste) => crowd(venueIds(area));

// Where else in the city the area's favourite venues are popular: Qloo
// heatmaps for each venue, merged into ~3 km cells and named by geocoding.
export async function branchAreas(area: AreaTaste, extra?: VenueRef): Promise<{ areas: BranchArea[]; evidence: Evidence }> {
  const venues = [...(extra ? [{ id: extra.id, name: extra.name }] : []), ...venueIds(area)].slice(0, 3);
  const cells = new Map<string, { lat: number; lon: number; score: number; venues: Set<string> }>();
  const CELL = 0.03;
  await Promise.all(
    venues.map(async (v) => {
      const res = await qlooExec("where_popular", { entity: v.id, entity_type: "place", within: area.city, limit: 20 }).catch(() => undefined);
      const points = (res?.results as { location?: { latitude: number; longitude: number }; query?: { popularity?: number } }[] | undefined) ?? [];
      const best = new Map<string, number>();
      for (const p of points) {
        if (!p.location) continue;
        const key = `${Math.round(p.location.latitude / CELL)}:${Math.round(p.location.longitude / CELL)}`;
        const cell = cells.get(key) ?? { lat: p.location.latitude, lon: p.location.longitude, score: 0, venues: new Set<string>() };
        cells.set(key, cell);
        best.set(key, Math.max(best.get(key) ?? 0, p.query?.popularity ?? 0));
        cell.venues.add(v.name);
      }
      for (const [key, score] of best) cells.get(key)!.score += score;
    }),
  );
  const home = area.geo;
  const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180));
  const ranked = [...cells.values()].filter((c) => !home || km(c, home) > 2.5).sort((a, b) => b.score - a.score);
  const areas: BranchArea[] = [];
  const homeName = area.label.split(",")[0].trim().toLowerCase();
  for (const c of ranked) {
    if (areas.length >= 5) break;
    const where = await reverseGeocode(c.lat, c.lon).catch(() => undefined);
    const name = where?.district ?? where?.city;
    if (!name || name.toLowerCase() === homeName || areas.some((a) => a.name === name)) continue;
    areas.push({ name, lat: c.lat, lon: c.lon, score: Math.round(c.score * 100) / 100, venues: [...c.venues] });
  }
  return { areas, evidence: { operation: "where_popular", input: { entities: venues.map((v) => v.name), entity_type: "place", within: area.city }, source: "live" } };
}

// A competitor's standing and crowd next to the area's, plus the audience
// traits the two groups share most (compare_audiences).
export async function competitor(name: string, area: AreaTaste, cafe?: VenueRef): Promise<CompetitorReport | undefined> {
  const rival = await findVenue(name, area);
  if (!rival) return undefined;
  const ours = cafe ? [{ id: cafe.id, name: cafe.name }] : venueIds(area).slice(0, 3);
  const compareInput = { group_a: ours.map((v) => v.id), group_b: [rival.id], limit: 10 };
  const [rank, rivalCrowd, cmp] = await Promise.all([
    standing(rival, area).catch(() => undefined),
    crowd([{ id: rival.id, name: rival.name }]).catch(() => undefined),
    qlooExec("compare_audiences", compareInput).catch(() => undefined),
  ]);
  const tags = ((cmp?.results as { tags?: { name: string; subtype?: string; query?: { score?: number } }[] } | undefined)?.tags ?? [])
    .filter((t) => !/genre:place$|health:place/.test(t.subtype ?? ""))
    .map((t) => ({ name: t.name, score: Math.round((t.query?.score ?? 0) * 100) / 100 }));
  return {
    competitor: rival,
    standing: rank,
    crowd: rivalCrowd,
    shared: tags.slice(0, 8),
    evidence: [{ operation: "compare_audiences", input: { group_a: ours.map((v) => v.name), group_b: [rival.name] }, source: "live" }],
  };
}

export type { TasteSignal };
