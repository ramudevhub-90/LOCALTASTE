// Turning suggestions into something the owner can act on: a 4-week event
// calendar (.ics), a plain-text plan to paste anywhere, and music links.

import type { RunResult, Suggestion } from "./api.ts";

const KIND: Record<Suggestion["kind"], string> = { menu: "Menu idea", playlist: "Playlist", theme_night: "Theme night" };

// Fridays at 7 pm for theme nights, Mondays for menu launches, over 4 weeks.
export function schedule(result: RunResult, from = new Date()) {
  const next = (weekday: number, weeksAhead: number, hour: number) => {
    const d = new Date(from);
    d.setHours(hour, 0, 0, 0);
    d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7 || 7) + weeksAhead * 7);
    return d;
  };
  const events: { title: string; detail: string; start: Date; hours: number }[] = [];
  const nights = result.suggestions.filter((s) => s.kind === "theme_night");
  const menu = result.suggestions.filter((s) => s.kind === "menu");
  nights.forEach((s, i) => events.push({ title: s.title, detail: s.pitch, start: next(5, i * 2, 19), hours: 3 }));
  menu.forEach((s, i) => events.push({ title: `Launch: ${s.title}`, detail: s.pitch, start: next(1, i, 9), hours: 1 }));
  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

export function calendarFile(result: RunResult): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Localtaste//Taste plan//EN", "CALSCALE:GREGORIAN"];
  schedule(result).forEach((e, i) => {
    const end = new Date(e.start.getTime() + e.hours * 3_600_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${result.jobId}-${i}@localtaste`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(`${e.detail}\n\nFrom your Localtaste plan for ${result.area.label}.`)}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function planText(result: RunResult): string {
  const out = [`Localtaste plan for ${result.area.label}`, ""];
  if (result.summary) out.push(result.summary, "");
  for (const s of result.suggestions) {
    out.push(`${KIND[s.kind]}: ${s.title}`, `  ${s.pitch}`);
    if (s.why) out.push(`  Why it fits: ${s.why}`);
    out.push("");
  }
  out.push("Based on aggregate taste data from Qloo, not any individual's preferences.");
  return out.join("\n");
}

export const spotifySearch = (artist: string) => `https://open.spotify.com/search/${encodeURIComponent(artist)}`;
export const youtubeSearch = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
