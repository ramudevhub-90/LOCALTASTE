// Browser side of the agent: start a job, then stream its progress over the
// AppSync subscription. The browser never talks to Qloo or Bedrock directly.

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { AnalyzeResult } from "../../core/agent.ts";
import type { AreaComparison, Domain } from "../../core/qloo/types.ts";

export type { AnalyzeResult, Suggestion } from "../../core/agent.ts";
export type { AreaComparison, AreaTaste, Domain, TasteSignal } from "../../core/qloo/types.ts";

export type RunResult = AnalyzeResult & { comparison?: AreaComparison };

export const DOMAIN_LABEL: Record<Domain, string> = {
  dining: "Food & drink",
  music: "Music",
  film_tv: "Film & TV",
  brand: "Brands",
};

export const DEMO_AREAS = [
  "Indiranagar, Bengaluru",
  "Koramangala, Bengaluru",
  "Jayanagar, Bengaluru",
  "HSR Layout, Bengaluru",
  "Malleshwaram, Bengaluru",
  "Whitefield, Bengaluru",
];

const client = generateClient<Schema>();
type Job = Schema["AnalysisJob"]["type"];

export async function runAnalysis(
  input: { location: string; menu: string[]; compareWith?: string },
  onStep: (step: string) => void,
): Promise<RunResult> {
  const { data: job, errors } = await client.mutations.startAnalysis(input);
  if (!job) throw new Error(errors?.[0]?.message ?? "Could not start the analysis.");
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
        else reject(new Error(j.error ?? "The analysis failed."));
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
