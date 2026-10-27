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
import { suggestPlaces } from "./functions/suggest-places/resource";

const backend = defineBackend({ auth, data, startAnalysis, analyzeWorker, suggestPlaces });

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

// Hourly run counters for the public demo (per visitor and overall).
const rateLimits = new Table(stack, "RateLimits", {
  partitionKey: { name: "key", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expiresAt",
  removalPolicy: RemovalPolicy.DESTROY,
});
rateLimits.grantReadWriteData(starter);
backend.startAnalysis.addEnvironment("RATE_TABLE", rateLimits.tableName);
backend.analyzeWorker.addEnvironment("QLOO_CACHE_TABLE", qlooCache.tableName);

// Bedrock models through cross-region inference profiles (us.amazon.nova-*, …).
// With LOCALTASTE_BEDROCK_ROLE_ARN, the worker assumes that invoke-only role in
// an account with model access instead (its trust policy names this worker's
// role); otherwise it calls Bedrock in this account.
const bedrockRoleArn = process.env.LOCALTASTE_BEDROCK_ROLE_ARN ?? "";
if (bedrockRoleArn) {
  backend.analyzeWorker.addEnvironment("BEDROCK_ROLE_ARN", bedrockRoleArn);
  worker.addToRolePolicy(new PolicyStatement({ actions: ["sts:AssumeRole"], resources: [bedrockRoleArn] }));
} else {
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: ["arn:aws:bedrock:*::foundation-model/*", `arn:aws:bedrock:*:${stack.account}:inference-profile/*`],
    }),
  );
}

// Amazon Location geocoding: the café's address → neighbourhood and city, and
// map points from Qloo heatmaps → neighbourhood names.
worker.addToRolePolicy(
  new PolicyStatement({
    actions: ["geo-places:Geocode", "geo-places:ReverseGeocode"],
    resources: [`arn:aws:geo-places:${stack.region}::provider/default`],
  }),
);

backend.suggestPlaces.resources.lambda.addToRolePolicy(
  new PolicyStatement({ actions: ["geo-places:Autocomplete"], resources: [`arn:aws:geo-places:${stack.region}::provider/default`] }),
);
