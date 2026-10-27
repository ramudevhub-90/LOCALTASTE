// Browser side of the agent: start a job, then stream its progress over the
// AppSync subscription. The browser never talks to Qloo or Bedrock directly.

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { AskResult } from "../../core/agent-bedrock.ts";
import type { AnalyzeResult } from "../../core/agent.ts";
import type { BranchArea, CompetitorReport, Crowd, Standing, VenueRef } from "../../core/insights.ts";
import type { AreaComparison, Domain, Evidence } from "../../core/qloo/types.ts";

export type { AgentStep, AnalyzeResult, Suggestion } from "../../core/agent.ts";
export type { AskResult } from "../../core/agent-bedrock.ts";
export type { BranchArea, CompetitorReport, Crowd, Standing, VenueRef } from "../../core/insights.ts";
export type { AreaComparison, AreaTaste, Domain, TasteSignal } from "../../core/qloo/types.ts";

export interface Insights {
  cafeName?: string;
  cafe?: VenueRef;
  standing?: Standing;
  crowd?: Crowd;
  cafeCrowd?: Crowd;
}

export type RunResult = AnalyzeResult & { comparison?: AreaComparison; insights?: Insights; jobId: string };
export type BranchResult = { kind: "branch"; areas: BranchArea[]; evidence: Evidence };
export type CompetitorResult = CompetitorReport & { kind: "competitor" };
export type AskReply = AskResult & { kind: "ask"; question: string };

export const DOMAIN_LABEL: Record<Domain, string> = {
  dining: "Food & drink",
  music: "Music",
  film_tv: "Film & TV",
  brand: "Brands",
  vibe: "Crowd & vibe",
};

// Suggestions for the address box, grouped by city. Any address works; these
// are well-known café neighbourhoods where Qloo has rich data.
export const DEMO_AREAS = [
  // Bengaluru
  "Indiranagar, Bengaluru",
  "Koramangala, Bengaluru",
  "HSR Layout, Bengaluru",
  "Jayanagar, Bengaluru",
  "Malleshwaram, Bengaluru",
  "Whitefield, Bengaluru",
  "JP Nagar, Bengaluru",
  "Church Street, Bengaluru",
  // Mumbai
  "Bandra West, Mumbai",
  "Colaba, Mumbai",
  "Lower Parel, Mumbai",
  "Andheri West, Mumbai",
  "Powai, Mumbai",
  // Delhi NCR
  "Hauz Khas, New Delhi",
  "Connaught Place, New Delhi",
  "Khan Market, New Delhi",
  "Cyber Hub, Gurugram",
  // Other Indian cities
  "Jubilee Hills, Hyderabad",
  "Banjara Hills, Hyderabad",
  "Koregaon Park, Pune",
  "Besant Nagar, Chennai",
  "Park Street, Kolkata",
  "Anjuna, Goa",
  // United States
  "Williamsburg, Brooklyn, NY",
  "East Village, New York, NY",
  "Mission District, San Francisco",
  "Hayes Valley, San Francisco",
  "Silver Lake, Los Angeles, CA",
  "Venice, Los Angeles, CA",
  "Wicker Park, Chicago",
  "Capitol Hill, Seattle",
  "South Congress, Austin",
  "Pearl District, Portland",
  // Europe and beyond
  "Shoreditch, London",
  "Soho, London",
  "Le Marais, Paris",
  "Kreuzberg, Berlin",
  "Jordaan, Amsterdam",
  "Gràcia, Barcelona",
  "Shibuya, Tokyo",
  "Surry Hills, Sydney",
  "Fitzroy, Melbourne",
  "Tiong Bahru, Singapore",
  "Jumeirah, Dubai",
];

const client = generateClient<Schema>();
type Job = Schema["AnalysisJob"]["type"];

export async function runAnalysis(
  input: { location: string; menu: string[]; compareWith?: string; cafe?: string },
  onStep: (step: string) => void,
): Promise<RunResult> {
  const { data: job, errors } = await client.mutations.startAnalysis(input);
  if (!job) throw new Error(errors?.[0]?.message ?? "Could not start the analysis.");
  const result = await waitFor(job, onStep);
  return { ...(result as AnalyzeResult), jobId: job.id };
}

export async function runFollowUp<T>(parentId: string, kind: "branch" | "competitor" | "ask", input: string, onStep: (step: string) => void): Promise<T> {
  const { data: job, errors } = await client.mutations.startFollowUp({ parentId, kind, input });
  if (!job) throw new Error(errors?.[0]?.message ?? "Could not start that.");
  return (await waitFor(job, onStep)) as T;
}

// Address suggestions while typing, like a maps search box.
export async function suggestPlaces(text: string): Promise<string[]> {
  const { data } = await client.queries.suggestPlaces({ text });
  return (data ?? []).filter((x): x is string => !!x);
}

function waitFor(job: Job, onStep: (step: string) => void): Promise<unknown> {
  onStep(job.step ?? "Queued");
  return new Promise((resolve, reject) => {
    let settled = false;
    const handle = (j: Job | null | undefined) => {
      if (!j || settled) return;
      if (j.step) onStep(j.step);
      if (j.status === "DONE" || j.status === "FAILED") {
        settled = true;
        sub.unsubscribe();
        clearInterval(poll);
        if (j.status === "DONE") resolve(JSON.parse(j.result as string));
        else reject(new Error(j.error ?? "That didn't work."));
      }
    };
    const sub = client.models.AnalysisJob.onUpdate({ filter: { id: { eq: job.id } } }).subscribe({
      next: handle,
      error: (err) => !settled && reject(err),
    });
    // The subscription's socket can connect after a fast job has finished, so
    // also poll occasionally until one of the two sees a final status.
    const check = () => client.models.AnalysisJob.get({ id: job.id }).then(({ data }) => handle(data));
    const poll = setInterval(check, 3000);
    check();
  });
}
