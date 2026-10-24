import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/analyze-worker";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { analyze } from "../../../core/agent.ts";
import { QlooError, type TasteCache, compareAreas, getAreaTaste, qlooExec, qlooMode } from "../../../core/qloo/index.ts";
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
    const area = await getAreaTaste(job.location, cache);
    await step("Ranking menu ideas…");
    const analysis = analyze(area, (job.menu ?? []).filter((m): m is string => !!m));
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

// Invoked directly (not via SQS) to check the harness and Bedrock from inside Lambda.
async function selfTest(dummyKey?: string) {
  if (dummyKey && !process.env.QLOO_API_KEY) process.env.QLOO_API_KEY = dummyKey;
  const out: Record<string, unknown> = { node: process.version, home: process.env.HOME, qlooMode: qlooMode() };
  try {
    const result = await qlooExec("find_tags", { query: "korean street food", limit: 2 });
    out.qloo = { ok: true, sample: JSON.stringify(result).slice(0, 300) };
  } catch (err) {
    out.qloo = { ok: false, code: (err as QlooError).code, message: (err as Error).message };
  }
  try {
    const bedrock = new BedrockRuntimeClient();
    const res = await bedrock.send(
      new ConverseCommand({
        modelId: process.env.BEDROCK_MODEL_ID,
        messages: [{ role: "user", content: [{ text: "Reply with the single word: ready" }] }],
        inferenceConfig: { maxTokens: 5 },
      }),
    );
    out.bedrock = { ok: true, model: process.env.BEDROCK_MODEL_ID, reply: res.output?.message?.content?.[0]?.text };
  } catch (err) {
    out.bedrock = { ok: false, model: process.env.BEDROCK_MODEL_ID, error: (err as Error).name, message: (err as Error).message };
  }
  return out;
}
