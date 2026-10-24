import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/start-analysis";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../data/resource";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();
const sqs = new SQSClient();

const clean = (v: string | null | undefined, max: number) => (v ?? "").trim().slice(0, max);

export const handler: Schema["startAnalysis"]["functionHandler"] = async (event) => {
  const location = clean(event.arguments.location, 200);
  if (!location) throw new Error("Enter your café's address or neighbourhood.");
  const menu = (event.arguments.menu ?? []).map((m) => clean(m, 80)).filter(Boolean).slice(0, 60);
  const compareWith = clean(event.arguments.compareWith, 200) || undefined;

  const { data: job, errors } = await client.models.AnalysisJob.create({
    location,
    menu,
    compareWith,
    status: "QUEUED",
    step: "Queued",
  });
  if (!job) throw new Error(errors?.[0]?.message ?? "Could not start the analysis.");

  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.QUEUE_URL, MessageBody: JSON.stringify({ jobId: job.id }) }));
  return job;
};
