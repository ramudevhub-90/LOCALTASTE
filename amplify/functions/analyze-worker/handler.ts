import Anthropic from "@anthropic-ai/sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/analyze-worker";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { claudeAvailable, runAgent } from "../../../core/agent-claude.ts";
import { QlooError, type TasteCache, compareAreas, qlooExec, qlooMode } from "../../../core/qloo/index.ts";
import type { Schema } from "../../data/resource";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

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
type SelfTest = { selftest: true; dummyKey?: string };

export const handler = async (event: SQSEvent | SelfTest): Promise<SQSBatchResponse | Record<string, unknown>> => {
  if ("selftest" in event) return selfTest(event.dummyKey);
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
  const { data: job } = await client.models.AnalysisJob.get({ id: jobId });
  if (!job || job.status === "DONE") return;
  const step = (text: string) => client.models.AnalysisJob.update({ id: jobId, status: "RUNNING", step: text });

  try {
    await step("Mapping neighbourhood taste…");
    const menu = (job.menu ?? []).filter((m): m is string => !!m);
    // Compare jobs only need the comparison, so they skip the Claude run.
    const analysis = await runAgent(job.location, menu, { cache, onStep: step, useClaude: !job.compareWith });
    const comparison = job.compareWith ? (await step("Comparing areas…"), await compareAreas(job.location, job.compareWith, cache)) : undefined;
    await client.models.AnalysisJob.update({
      id: jobId,
      status: "DONE",
      step: "Done",
      result: JSON.stringify({ ...analysis, comparison }),
    });
  } catch (err) {
    console.error(err);
    await client.models.AnalysisJob.update({
      id: jobId,
      status: "FAILED",
      step: "Failed",
      error: err instanceof QlooError ? err.message : "The agent hit an unexpected error.",
    });
  }
}

// Invoked directly (not via SQS) to check the Qloo harness and Claude from inside Lambda.
async function selfTest(dummyKey?: string) {
  if (dummyKey && !process.env.QLOO_API_KEY) process.env.QLOO_API_KEY = dummyKey;
  const out: Record<string, unknown> = { node: process.version, home: process.env.HOME, qlooMode: qlooMode() };
  try {
    const result = await qlooExec("find_tags", { query: "korean street food", limit: 2 });
    out.qloo = { ok: true, sample: JSON.stringify(result).slice(0, 300) };
  } catch (err) {
    out.qloo = { ok: false, code: (err as QlooError).code, message: (err as Error).message };
  }
  out.claude = { available: claudeAvailable(), model: process.env.CLAUDE_MODEL };
  if (claudeAvailable()) {
    try {
      const res = await new Anthropic().messages.create({
        model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
        max_tokens: 64,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
      });
      const text = res.content.find((b) => b.type === "text");
      out.claude = { ...(out.claude as object), ok: true, reply: text?.type === "text" ? text.text : res.stop_reason };
    } catch (err) {
      out.claude = { ...(out.claude as object), ok: false, error: (err as Error).name, message: (err as Error).message };
    }
  }
  return out;
}
