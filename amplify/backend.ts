import { defineBackend } from "@aws-amplify/backend";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { analyzeWorker } from "./functions/analyze-worker/resource";
import { startAnalysis } from "./functions/start-analysis/resource";

const backend = defineBackend({ auth, data, startAnalysis, analyzeWorker });

// Both functions live in the data stack (resourceGroupName), so the queue and
// cache table go there too to avoid cross-stack cycles.
const stack = Stack.of(backend.data);
const worker = backend.analyzeWorker.resources.lambda;
const starter = backend.startAnalysis.resources.lambda;

const deadLetters = new Queue(stack, "AnalysisDeadLetters", { retentionPeriod: Duration.days(4) });
const jobs = new Queue(stack, "AnalysisJobs", {
  visibilityTimeout: Duration.seconds(360),
  deadLetterQueue: { queue: deadLetters, maxReceiveCount: 2 },
});
jobs.grantSendMessages(starter);
backend.startAnalysis.addEnvironment("QUEUE_URL", jobs.queueUrl);
worker.addEventSource(new SqsEventSource(jobs, { batchSize: 1, reportBatchItemFailures: true }));

// Cache of Qloo responses (TTL attribute `expiresAt`) to protect the event quota.
const qlooCache = new Table(stack, "QlooCache", {
  partitionKey: { name: "key", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expiresAt",
  removalPolicy: RemovalPolicy.DESTROY,
});
qlooCache.grantReadWriteData(worker);
backend.analyzeWorker.addEnvironment("QLOO_CACHE_TABLE", qlooCache.tableName);

worker.addToRolePolicy(
  new PolicyStatement({
    actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    resources: ["arn:aws:bedrock:*::foundation-model/anthropic.*", `arn:aws:bedrock:*:${stack.account}:inference-profile/*`],
  }),
);
