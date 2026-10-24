// Client-side mirrors of the server types. The browser never talks to Qloo.

export type Domain = "dining" | "music" | "film_tv" | "brand";

export interface TasteSignal {
  id: string;
  name: string;
  domain: Domain;
  affinity: number;
  lift?: number;
  tags: string[];
  evidence: { operation: string; input: Record<string, unknown>; source: "sample" | "live" };
}

export interface AreaTaste {
  query: string;
  label: string;
  city: string;
  source: "sample" | "live";
  signals: TasteSignal[];
}

export interface Suggestion {
  kind: "menu" | "playlist" | "theme_night";
  title: string;
  pitch: string;
  evidence: string[];
}

export interface AnalyzeResult {
  area: AreaTaste;
  suggestions: Suggestion[];
  writer: "template" | "claude";
}

export interface AreaComparison {
  a: AreaTaste;
  b: AreaTaste;
  onlyA: TasteSignal[];
  onlyB: TasteSignal[];
  shared: { name: string; domain: Domain; a: number; b: number }[];
}

export const DOMAIN_LABEL: Record<Domain, string> = {
  dining: "Food & drink",
  music: "Music",
  film_tv: "Film & TV",
  brand: "Brands",
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const analyze = (location: string, menu: string[]) => post<AnalyzeResult>("/api/analyze", { location, menu });
export const compare = (a: string, b: string) => post<AreaComparison>("/api/compare", { a, b });
export const getAreas = () => fetch("/api/areas").then((r) => r.json() as Promise<{ areas: string[] }>);
