import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { AppSyncResolverEvent } from "aws-lambda";
import { type Job, createJob, getJob } from "./jobs.ts";

// AppSync resolver for startAnalysis and startFollowUp: records the job and
// enqueues it for the worker.
const sqs = new SQSClient();
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient());

const clean = (v: string | null | undefined, max: number) => (v ?? "").trim().slice(0, max);
const FOLLOW_UPS = new Set(["branch", "competitor", "ask"]);

// Every run costs Qloo quota and Bedrock tokens, so cap runs per visitor
// (Cognito identity, guests included) and for the whole demo, per hour.
const PER_VISITOR = 15;
const OVERALL = 400;
async function underLimit(key: string, max: number) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: process.env.RATE_TABLE,
      Key: { key: `${key}#${hour}` },
      UpdateExpression: "ADD runs :one SET expiresAt = :exp",
      ExpressionAttributeValues: { ":one": 1, ":exp": (hour + 2) * 3600 },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return (Attributes?.runs ?? 0) <= max;
}

type Args = { location?: string; menu?: (string | null)[] | null; compareWith?: string | null; cafe?: string | null; parentId?: string; kind?: string; input?: string | null };

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  const who = (event.identity as { cognitoIdentityId?: string } | null)?.cognitoIdentityId ?? "anonymous";
  if (!(await underLimit(`visitor#${who}`, PER_VISITOR)) || !(await underLimit("all", OVERALL)))
    throw new Error("That's a lot of runs in a short time. Please try again in a little while.");

  const args = event.arguments;
  let job: Omit<Job, "id">;
  if (event.info.fieldName === "startFollowUp") {
    const kind = clean(args.kind, 20);
    if (!FOLLOW_UPS.has(kind)) throw new Error("Unknown follow-up.");
    const parent = await getJob(clean(args.parentId, 64));
    if (!parent || parent.status !== "DONE") throw new Error("Run the analysis first.");
    const input = clean(args.input, 300);
    if ((kind === "competitor" || kind === "ask") && !input) throw new Error(kind === "ask" ? "Type a question first." : "Enter the competitor's name.");
    job = { location: parent.location, menu: parent.menu, cafe: parent.cafe, kind, parentId: parent.id, input, status: "QUEUED", step: "Queued" };
  } else {
    const location = clean(args.location, 200);
    if (!location) throw new Error("Enter your café's address or neighbourhood.");
    const menu = (args.menu ?? []).map((m) => clean(m, 80)).filter(Boolean).slice(0, 60);
    job = {
      location,
      menu,
      compareWith: clean(args.compareWith, 200) || undefined,
      cafe: clean(args.cafe, 120) || undefined,
      kind: "analyze",
      status: "QUEUED",
      step: "Queued",
    };
  }

  const created = await createJob(job);
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.QUEUE_URL, MessageBody: JSON.stringify({ jobId: created.id }) }));
  return created;
};
