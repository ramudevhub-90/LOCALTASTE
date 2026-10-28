// Jobs table access for the Lambdas. Reads and creates go straight to
// DynamoDB; updates go through AppSync's updateAnalysisJob (IAM-signed) so
// subscribed browsers see each step.

import { randomUUID } from "node:crypto";
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

export type JobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

export interface Job {
  id: string;
  location: string;
  menu?: string[];
  compareWith?: string;
  cafe?: string;
  kind?: string;
  parentId?: string;
  input?: string;
  status?: JobStatus;
  step?: string;
  result?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(), { marshallOptions: { removeUndefinedValues: true } });
const TABLE = process.env.JOBS_TABLE;

export async function getJob(id: string): Promise<Job | undefined> {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
  return Item as Job | undefined;
}

export async function createJob(fields: Omit<Job, "id" | "createdAt" | "updatedAt">): Promise<Job> {
  const now = new Date().toISOString();
  const job: Job = { ...fields, id: randomUUID(), createdAt: now, updatedAt: now };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: job }));
  return job;
}

const UPDATE = `mutation Update($input: UpdateAnalysisJobInput!) {
  updateAnalysisJob(input: $input) { id location menu compareWith cafe kind parentId input status step result error createdAt updatedAt }
}`;

const endpoint = new URL(process.env.API_URL ?? "https://invalid.localhost/graphql");
const signer = new SignatureV4({ credentials: defaultProvider(), region: process.env.AWS_REGION ?? "us-east-1", service: "appsync", sha256: Sha256 });

export async function updateJob(input: Pick<Job, "id"> & Partial<Pick<Job, "status" | "step" | "result" | "error">>) {
  const body = JSON.stringify({ query: UPDATE, variables: { input } });
  const req = await signer.sign(
    new HttpRequest({
      method: "POST",
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      path: endpoint.pathname,
      headers: { host: endpoint.hostname, "content-type": "application/json" },
      body,
    }),
  );
  const res = await fetch(endpoint, { method: "POST", headers: req.headers, body });
  const out = (await res.json()) as { errors?: { message: string }[] };
  if (!res.ok || out.errors?.length) throw new Error(`updateAnalysisJob failed: ${out.errors?.[0]?.message ?? res.status}`);
}
