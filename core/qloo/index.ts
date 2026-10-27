// The single entry point for all Qloo data. Everything else imports from here.

import { liveSource } from "./live.ts";
import { sampleSource } from "./sample.ts";
import type { AreaComparison, AreaTaste, QlooSource, TasteSignal } from "./types.ts";

export * from "./types.ts";
export { SAMPLE_AREAS } from "./sample.ts";
export { DOMAIN_TARGET, domainOf, isLocalVenue, qlooExec, resolvePlace, resultItems, splitLocation, toSignals, type QlooItem, type QlooResult } from "./live.ts";

// Where Qloo responses are cached to protect the event quota. Lambda passes a
// DynamoDB-backed cache; the default is per-process memory.
export interface TasteCache {
  get(key: string): Promise<AreaTaste | undefined>;
  set(key: string, value: AreaTaste, ttlSeconds: number): Promise<void>;
}

const memory = new Map<string, { until: number; value: AreaTaste }>();
export const memoryCache: TasteCache = {
  async get(key) {
    const hit = memory.get(key);
    return hit && hit.until > Date.now() ? hit.value : undefined;
  },
  async set(key, value, ttlSeconds) {
    memory.set(key, { until: Date.now() + ttlSeconds * 1000, value });
  },
};

const TTL_SECONDS = 7 * 24 * 60 * 60;

// An unset Amplify secret stays as a "<value will be resolved…>" placeholder.
export const hasSecret = (value: string | undefined) => !!value && value !== "unset" && !value.startsWith("<");

function source(): QlooSource {
  return process.env.QLOO_MODE === "live" && hasSecret(process.env.QLOO_API_KEY) ? liveSource : sampleSource;
}

export const qlooMode = () => source().mode;

export async function getAreaTaste(location: string, cache: TasteCache = memoryCache): Promise<AreaTaste> {
  const src = source();
  const key = `area:v4:${src.mode}:${location.trim().toLowerCase()}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  const value = await src.areaTaste(location);
  await cache.set(key, value, TTL_SECONDS);
  return value;
}

export async function compareAreas(a: string, b: string, cache: TasteCache = memoryCache): Promise<AreaComparison> {
  const [ta, tb] = await Promise.all([getAreaTaste(a, cache), getAreaTaste(b, cache)]);
  const byName = (s: TasteSignal[]) => new Map(s.map((x) => [x.name, x]));
  const ma = byName(ta.signals);
  const mb = byName(tb.signals);
  const shared = ta.signals
    .filter((s) => mb.has(s.name))
    .map((s) => ({ name: s.name, domain: s.domain, a: s.affinity, b: mb.get(s.name)!.affinity }));
  const top = (s: TasteSignal[]) => [...s].sort((x, y) => (y.lift ?? 1) * y.affinity - (x.lift ?? 1) * x.affinity).slice(0, 6);
  return {
    a: ta,
    b: tb,
    onlyA: top(ta.signals.filter((s) => !mb.has(s.name))),
    onlyB: top(tb.signals.filter((s) => !ma.has(s.name))),
    shared,
  };
}
