import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { AnalyzeResult } from "../../core/agent.ts";
import { MODEL, askAgent, bedrock, llmAvailable, runAgent } from "../../core/agent-bedrock.ts";
import { type VenueRef, areaCrowd, branchAreas, competitor, crowd, findVenue, standing } from "../../core/insights.ts";
import { type AreaTaste, QlooError, type QlooOperation, type TasteCache, compareAreas, getAreaTaste, qlooExec, qlooMode } from "../../core/qloo/index.ts";
import { getJob, updateJob } from "./jobs.ts";

// The Qloo key is a SecureString parameter (/localtaste/qloo-api-key), read
// once per cold start. Until it is set, the worker falls back to sample data.
if (process.env.QLOO_KEY_PARAM && !process.env.QLOO_API_KEY) {
  const ssm = new SSMClient();
  const key = await ssm
    .send(new GetParameterCommand({ Name: process.env.QLOO_KEY_PARAM, WithDecryption: true }))
    .then((r) => r.Parameter?.Value)
    .catch((err) => console.warn("Qloo key not readable; using sample data", (err as Error).name));
  if (key) process.env.QLOO_API_KEY = key;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient());
const cache: TasteCache = {
  async get(key) {
    const { Item } = await ddb.send(new GetCommand({ TableName: process.env.QLOO_CACHE_TABLE, Key: { key } }));
    return Item && Item.expiresAt > Date.now() / 1000 ? JSON.parse(Item.value) : undefined;
  },
  async set(key, value, ttlSeconds) {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    await ddb.send(new PutCommand({ TableName: process.env.QLOO_CACHE_TABLE, Item: { key, value: JSON.stringify(value), expiresAt } }));
  },
};

// `dummyKey` lets the self-test prove the harness reaches Qloo (expecting a
// QLOO_AUTH 401) before the real key exists. It is never a real credential.
// `probe` runs one Qloo workflow and returns the raw envelope; `agent` runs the
// whole agent without a job. Both are for tuning from the CLI.
type SelfTest = {
  selftest: true;
  dummyKey?: string;
  probe?: { operation: QlooOperation; input: Record<string, unknown> };
  agent?: { location: string; menu: string[]; model?: string };
  area?: string;
  insights?: { location: string; cafe?: string };
};

export const handler = async (event: SQSEvent | SelfTest): Promise<SQSBatchResponse | object> => {
  if ("selftest" in event) {
    if (event.probe) return qlooExec(event.probe.operation, event.probe.input).catch((e) => ({ error: e.code, message: e.message }));
    if (event.area) return getAreaTaste(event.area, cache);
    if (event.insights) {
      const area = await getAreaTaste(event.insights.location, cache);
      const ins = await areaInsights(area, event.insights.cafe);
      return { ins, branch: await branchAreas(area, ins?.cafe) };
    }
    if (event.agent) return runAgent(event.agent.location, event.agent.menu, { cache, model: event.agent.model });
    return selfTest(event.dummyKey);
  }
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    try {
      await run(JSON.parse(record.body).jobId);
    } catch (err) {
      console.error("job failed", err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};

async function run(jobId: string) {
  const job = await getJob(jobId);
  if (!job || job.status === "DONE") return;
  const step = (text: string) => updateJob({ id: jobId, status: "RUNNING", step: text });
  const menu = (job.menu ?? []).filter((m): m is string => !!m);

  try {
    let result: object;
    if (job.kind && job.kind !== "analyze") result = await followUp(job.kind, job.parentId ?? "", job.input ?? "", menu, step);
    else {
      await step("Mapping neighbourhood taste…");
      // Compare jobs only need the comparison, so they skip the model run.
      const area = await getAreaTaste(job.location, cache);
      const [analysis, insights] = await Promise.all([
        runAgent(job.location, menu, { cache, onStep: step, useLlm: !job.compareWith }),
        job.compareWith ? undefined : areaInsights(area, job.cafe ?? undefined),
      ]);
      const comparison = job.compareWith ? (await step("Comparing areas…"), await compareAreas(job.location, job.compareWith, cache)) : undefined;
      result = { ...analysis, comparison, insights };
    }
    await updateJob({ id: jobId, status: "DONE", step: "Done", result: JSON.stringify(result) });
  } catch (err) {
    console.error(err);
    const known = err instanceof QlooError || (err instanceof Error && err.name === "UserError");
    await updateJob({
      id: jobId,
      status: "FAILED",
      step: "Failed",
      error: known ? (err as Error).message : "The agent hit an unexpected error.",
    });
  }
}

class UserError extends Error {
  name = "UserError";
}

// Your café's standing and the area's crowd: extra Qloo calls that run while
// the agent works. Any of them may come back empty; none blocks the result.
async function areaInsights(area: AreaTaste, cafeName?: string) {
  if (area.source !== "live") return undefined;
  const cafe = cafeName ? await findVenue(cafeName, area).catch(() => undefined) : undefined;
  const [rank, areaCrowdProfile, cafeCrowd] = await Promise.all([
    cafe ? retry("standing", () => standing(cafe, area)) : undefined,
    retry("crowd", () => areaCrowd(area)),
    cafe ? retry("cafe crowd", () => crowd([cafe])) : undefined,
  ]);

  return { cafeName, cafe, standing: rank, crowd: areaCrowdProfile, cafeCrowd };
}

// These run alongside the agent's own Qloo calls, so a rate-limit blip is
// likely; try once more before leaving the panel out.
async function retry<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const value = await fn();
      if (value !== undefined || attempt === 2) return value;
    } catch (err) {
      console.warn(`${what} failed (attempt ${attempt})`, err);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return undefined;
}

async function followUp(kind: string, parentId: string, input: string, menu: string[], step: (t: string) => Promise<unknown>) {
  const parent = await getJob(parentId);
  if (!parent?.result) throw new UserError("Run the analysis first.");
  const prior = JSON.parse(parent.result) as AnalyzeResult & { insights?: { cafe?: VenueRef } };
  const area = prior.area;
  if (area.source !== "live") throw new UserError("This needs live Qloo data.");
  if (kind === "branch") {
    await step("Mapping where your neighbourhood's favourites are popular…");
    return { kind, ...(await branchAreas(area, prior.insights?.cafe)) };
  }
  if (kind === "competitor") {
    await step(`Finding ${input} on Qloo…`);
    const report = await competitor(input, area, prior.insights?.cafe);
    if (!report) throw new UserError(`Couldn't find "${input}" on Qloo near ${area.label}. Try its exact name.`);
    return { kind, ...report };
  }
  await step("Thinking about your question…");
  return { kind, question: input, ...(await askAgent(prior, menu, input, { onStep: step })) };
}

// Invoked directly (not via SQS) to check the Qloo harness and Bedrock from inside Lambda.
async function selfTest(dummyKey?: string) {
  if (dummyKey && !process.env.QLOO_API_KEY) process.env.QLOO_API_KEY = dummyKey;
  const out: Record<string, unknown> = { node: process.version, home: process.env.HOME, qlooMode: qlooMode() };
  try {
    const result = await qlooExec("find_tags", { query: "korean street food", limit: 2 });
    out.qloo = { ok: true, sample: JSON.stringify(result).slice(0, 300) };
  } catch (err) {
    out.qloo = { ok: false, code: (err as QlooError).code, message: (err as Error).message };
  }
  out.llm = { available: llmAvailable(), model: MODEL };
  if (llmAvailable()) {
    try {
      const res = await bedrock().send(
        new ConverseCommand({ modelId: MODEL, messages: [{ role: "user", content: [{ text: "Reply with the single word: ready" }] }], inferenceConfig: { maxTokens: 10 } }),
      );
      out.llm = { ...(out.llm as object), ok: true, reply: res.output?.message?.content?.[0]?.text };
    } catch (err) {
      out.llm = { ...(out.llm as object), ok: false, error: (err as Error).name, message: (err as Error).message };
    }
  }
  return out;
}
