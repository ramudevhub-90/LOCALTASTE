// The whole Localtaste backend as one CDK stack. Every resource has an
// explicit localtaste-… name.
//
//   browser ──IAM (guest)──▶ AppSync localtaste-api
//     startAnalysis / startFollowUp ─▶ λ localtaste-start-analysis ─▶ SQS localtaste-jobs
//     suggestPlaces ─▶ λ localtaste-suggest-places ─▶ Amazon Location
//     getAnalysisJob / onUpdateAnalysisJob ◀── table localtaste-jobs
//   SQS ─▶ λ localtaste-analyze-worker ─▶ Qloo + Bedrock, progress via updateAnalysisJob

import path from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as appsync from "aws-cdk-lib/aws-appsync";
import { CfnIdentityPool, CfnIdentityPoolRoleAttachment } from "aws-cdk-lib/aws-cognito";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { FederatedPrincipal, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, type NodejsFunctionProps, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

// SecureString, created by hand (CloudFormation can't create SecureStrings):
// read -rs "K?Qloo key: " && aws ssm put-parameter --name /localtaste/qloo-api-key --type SecureString --overwrite --value "$K"; unset K
const QLOO_KEY_PARAM = "/localtaste/qloo-api-key";

export interface LocaltasteProps extends StackProps {
  // Invoke-only role in the account with Bedrock model access. Its trust
  // policy must name localtaste-analyze-worker's role.
  bedrockRoleArn?: string;
}

export class LocaltasteStack extends Stack {
  constructor(scope: Construct, id: string, props: LocaltasteProps) {
    super(scope, id, props);

    // ── Storage and queue ──
    const table = (name: string, ttl?: string) =>
      new Table(this, name, {
        tableName: `localtaste-${name}`,
        partitionKey: { name: name === "jobs" ? "id" : "key", type: AttributeType.STRING },
        billingMode: BillingMode.PAY_PER_REQUEST,
        timeToLiveAttribute: ttl,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    const jobsTable = table("jobs");
    // Cached Qloo responses, to protect the event quota.
    const qlooCache = table("qloo-cache", "expiresAt");
    // Hourly run counters for the public demo (per visitor and overall).
    const rateLimits = table("rate-limits", "expiresAt");

    const deadLetters = new Queue(this, "JobsDeadLetters", { queueName: "localtaste-jobs-dlq", retentionPeriod: Duration.days(4) });
    // Agent runs take 20–40 s, longer than an AppSync resolver may, hence the queue.
    const jobsQueue = new Queue(this, "JobsQueue", {
      queueName: "localtaste-jobs",
      visibilityTimeout: Duration.seconds(360),
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: 2 },
    });

    // ── API ──
    const api = new appsync.GraphqlApi(this, "Api", {
      name: "localtaste-api",
      definition: appsync.Definition.fromFile(path.join(HERE, "schema.graphql")),
      authorizationConfig: { defaultAuthorization: { authorizationType: appsync.AuthorizationType.IAM } },
    });

    // ── Lambdas ──
    const fn = (name: string, props: Partial<NodejsFunctionProps>) =>
      new NodejsFunction(this, name, {
        functionName: `localtaste-${name}`,
        role: new Role(this, `${name}-role`, {
          roleName: `localtaste-${name}`,
          assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
          managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
        }),
        entry: path.join(HERE, "functions", `${name}.ts`),
        runtime: Runtime.NODEJS_22_X,
        projectRoot: ROOT,
        depsLockFilePath: path.join(ROOT, "package-lock.json"),
        logGroup: new LogGroup(this, `${name}-logs`, { logGroupName: `/aws/lambda/localtaste-${name}`, retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
        bundling: {
          format: OutputFormat.ESM,
          target: "node22",
          mainFields: ["module", "main"],
          // Some dependencies still call require(); give ESM bundles one.
          banner: "import { createRequire as __localtasteRequire } from 'module'; const require = __localtasteRequire(import.meta.url);",
        },
        ...props,
      });

    const startAnalysis = fn("start-analysis", {
      timeout: Duration.seconds(10),
      environment: { JOBS_TABLE: jobsTable.tableName, QUEUE_URL: jobsQueue.queueUrl, RATE_TABLE: rateLimits.tableName },
    });
    jobsTable.grantReadWriteData(startAnalysis);
    rateLimits.grantReadWriteData(startAnalysis);
    jobsQueue.grantSendMessages(startAnalysis);

    const suggestPlaces = fn("suggest-places", { timeout: Duration.seconds(5), memorySize: 256 });
    suggestPlaces.addToRolePolicy(
      new PolicyStatement({ actions: ["geo-places:Autocomplete"], resources: [`arn:aws:geo-places:${this.region}::provider/default`] }),
    );

    const worker = fn("analyze-worker", {
      timeout: Duration.seconds(300),
      memorySize: 1024,
      environment: {
        JOBS_TABLE: jobsTable.tableName,
        API_URL: api.graphqlUrl,
        QLOO_CACHE_TABLE: qlooCache.tableName,
        QLOO_MODE: "live",
        QLOO_KEY_PARAM,
        // Hackathon keys only work against this gateway; the harness requires the
        // matching trust value before it sends a key to a custom base URL.
        QLOO_BASE_URL: "https://hackathon.api.qloo.com",
        QLOO_TRUSTED_BASE_URL: "https://hackathon.api.qloo.com",
        // Amazon Nova 2 Lite on Bedrock (Converse API), no API key. Chosen over
        // Nova Pro (generic dishes, fewer Qloo calls) and Llama 4 Maverick (did
        // not call tools) in a side-by-side run on 3 areas.
        LLM_PROVIDER: "bedrock",
        BEDROCK_MODEL_ID: "us.amazon.nova-2-lite-v1:0",
        BEDROCK_REGION: "us-east-1",
        ...(props.bedrockRoleArn ? { BEDROCK_ROLE_ARN: props.bedrockRoleArn } : {}),
        // The Lambda filesystem is read-only except /tmp.
        HOME: "/tmp",
      },
    });
    worker.addEventSource(new SqsEventSource(jobsQueue, { batchSize: 1, reportBatchItemFailures: true }));
    jobsTable.grantReadData(worker);
    qlooCache.grantReadWriteData(worker);
    api.grantMutation(worker, "updateAnalysisJob");
    worker.addToRolePolicy(
      new PolicyStatement({ actions: ["ssm:GetParameter"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${QLOO_KEY_PARAM}`] }),
    );
    // Amazon Location: the café's address → neighbourhood and city, and map
    // points from Qloo heatmaps → neighbourhood names.
    worker.addToRolePolicy(
      new PolicyStatement({ actions: ["geo-places:Geocode", "geo-places:ReverseGeocode"], resources: [`arn:aws:geo-places:${this.region}::provider/default`] }),
    );
    // Bedrock through cross-region inference profiles (us.amazon.nova-*). With
    // bedrockRoleArn the worker assumes that invoke-only role in the account
    // with model access; otherwise it calls Bedrock in this account.
    worker.addToRolePolicy(
      props.bedrockRoleArn
        ? new PolicyStatement({ actions: ["sts:AssumeRole"], resources: [props.bedrockRoleArn] })
        : new PolicyStatement({
            actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            resources: ["arn:aws:bedrock:*::foundation-model/*", `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
          }),
    );

    // ── Resolvers ──
    const jobsSource = api.addDynamoDbDataSource("JobsTable", jobsTable);
    const jsResolver = (typeName: string, fieldName: string, file: string) =>
      jobsSource.createResolver(`${typeName}${fieldName}`, {
        typeName,
        fieldName,
        runtime: appsync.FunctionRuntime.JS_1_0_0,
        code: appsync.Code.fromAsset(path.join(HERE, "resolvers", file)),
      });
    jsResolver("Query", "getAnalysisJob", "get-job.js");
    jsResolver("Mutation", "updateAnalysisJob", "update-job.js");

    const startSource = api.addLambdaDataSource("StartAnalysisFn", startAnalysis);
    startSource.createResolver("MutationstartAnalysis", { typeName: "Mutation", fieldName: "startAnalysis" });
    startSource.createResolver("MutationstartFollowUp", { typeName: "Mutation", fieldName: "startFollowUp" });
    api.addLambdaDataSource("SuggestPlacesFn", suggestPlaces).createResolver("QuerysuggestPlaces", { typeName: "Query", fieldName: "suggestPlaces" });

    // ── Visitors ──
    // No sign-up: every browser gets a guest identity from this pool, whose
    // role may call only the public fields (not updateAnalysisJob).
    const visitors = new CfnIdentityPool(this, "Visitors", {
      identityPoolName: "localtaste-visitors",
      allowUnauthenticatedIdentities: true,
      allowClassicFlow: false,
    });
    const guestRole = new Role(this, "GuestRole", {
      roleName: "localtaste-guest",
      assumedBy: new FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: { "cognito-identity.amazonaws.com:aud": visitors.ref },
          "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "unauthenticated" },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });
    api.grantQuery(guestRole, "getAnalysisJob", "suggestPlaces");
    api.grantMutation(guestRole, "startAnalysis", "startFollowUp");
    api.grantSubscription(guestRole, "onUpdateAnalysisJob");
    new CfnIdentityPoolRoleAttachment(this, "VisitorRoles", { identityPoolId: visitors.ref, roles: { unauthenticated: guestRole.roleArn } });

    // Read by the web build (scripts/deploy-web.sh writes them to web/src/backend.json).
    new CfnOutput(this, "ApiUrl", { value: api.graphqlUrl });
    new CfnOutput(this, "IdentityPoolId", { value: visitors.ref });
    new CfnOutput(this, "Region", { value: this.region });
    new CfnOutput(this, "WorkerRoleArn", { value: worker.role!.roleArn });
  }
}
