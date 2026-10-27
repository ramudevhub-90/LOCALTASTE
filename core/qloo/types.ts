// Shapes the rest of the app depends on. Both the sample and live Qloo
// sources must return these, so swapping sources never touches the agent or UI.

// "vibe" holds Qloo audience/ambience tags for the people who favour the
// area's venues (live data only).
export type Domain = "dining" | "music" | "film_tv" | "brand" | "vibe";

export const DOMAINS: readonly Domain[] = ["dining", "music", "film_tv", "brand", "vibe"];

// The Qloo workflow call that produced a signal: shown in the UI as "why this?".
export type QlooOperation =
  | "recommend"
  | "rank"
  | "describe"
  | "where_popular"
  | "compare_audiences"
  | "entity_tags"
  | "audience_demographics"
  | "trends"
  | "find_tags";

export interface Evidence {
  operation: QlooOperation;
  input: Record<string, unknown>;
  source: "sample" | "live";
}

// One aggregate neighbourhood affinity (never a claim about an individual).
export interface TasteSignal {
  id: string;
  name: string;
  domain: Domain;
  // Qloo affinity score for the area, 0–1.
  affinity: number;
  // How much higher than the city baseline, e.g. 1.8 = 80% above. Optional.
  lift?: number;
  // Qloo global popularity, 0–1 (live data only).
  popularity?: number;
  tags: string[];
  // Short Qloo description, when present.
  note?: string;
  // Qloo entity UUID or tag URN (live data), so follow-up calls skip name resolution.
  qlooId?: string;
  // Venue details from Qloo (live places).
  image?: string;
  address?: string;
  evidence: Evidence;
}

export interface AreaTaste {
  query: string;
  label: string;
  city: string;
  source: "sample" | "live";
  signals: TasteSignal[];
  // Qloo filter_location for places in this neighbourhood (live).
  placeFilter?: string;
  // "city" when the neighbourhood had too few venues on Qloo and the venue
  // signals are the city's favourites instead.
  venueScope?: "neighbourhood" | "city";
  // Geocoded centre of the café's area (live).
  geo?: { lat: number; lon: number; country?: string; postcode?: string };
}

export interface AreaComparison {
  a: AreaTaste;
  b: AreaTaste;
  // Signals clearly stronger in one area than the other.
  onlyA: TasteSignal[];
  onlyB: TasteSignal[];
  shared: { name: string; domain: Domain; a: number; b: number }[];
}

export interface QlooSource {
  readonly mode: "sample" | "live";
  areaTaste(location: string): Promise<AreaTaste>;
}

export class QlooError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
