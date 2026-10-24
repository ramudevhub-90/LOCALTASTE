// The single entry point for all Qloo data. Everything else imports from here.

import { liveSource } from "./live.ts";
import { sampleSource } from "./sample.ts";
import type { AreaComparison, AreaTaste, QlooSource, TasteSignal } from "./types.ts";

export * from "./types.ts";
export { SAMPLE_AREAS } from "./sample.ts";

const source: QlooSource = process.env.QLOO_MODE === "live" && process.env.QLOO_API_KEY ? liveSource : sampleSource;

export const qlooMode = source.mode;

const cache = new Map<string, { at: number; value: AreaTaste }>();
const TTL_MS = 6 * 60 * 60 * 1000;

export async function getAreaTaste(location: string): Promise<AreaTaste> {
  const key = location.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await source.areaTaste(location);
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function compareAreas(a: string, b: string): Promise<AreaComparison> {
  const [ta, tb] = await Promise.all([getAreaTaste(a), getAreaTaste(b)]);
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
