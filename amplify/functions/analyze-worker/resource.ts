import { defineFunction, secret } from "@aws-amplify/backend";

// SQS consumer that runs the agent (Qloo + a Bedrock model). Runs can take
// 20–40 s, longer than an AppSync resolver may, hence the queue in front of it.
// The Qloo key is an Amplify secret (SSM). Until it is set, its variable holds
// a placeholder and the worker falls back to sample data.
export const analyzeWorker = defineFunction({
  name: "analyze-worker",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 300,
  memoryMB: 1024,
  resourceGroupName: "data",
  environment: {
    QLOO_MODE: "live",
    QLOO_API_KEY: secret("QLOO_API_KEY"),
    // Hackathon keys only work against this gateway; the harness requires the
    // matching trust value before it sends a key to a custom base URL.
    QLOO_BASE_URL: "https://hackathon.api.qloo.com",
    QLOO_TRUSTED_BASE_URL: "https://hackathon.api.qloo.com",
    // Amazon Nova 2 Lite on Bedrock (Converse API), no API key. Chosen over
    // Nova Pro (generic dishes, fewer Qloo calls) and Llama 4 Maverick (did not
    // call tools) in a side-by-side run on 3 areas. This account has
    // almost no Bedrock quota, so the worker assumes an invoke-only role in the
    // account that has model access (backend.ts, LOCALTASTE_BEDROCK_ROLE_ARN).
    LLM_PROVIDER: "bedrock",
    BEDROCK_MODEL_ID: "us.amazon.nova-2-lite-v1:0",
    BEDROCK_REGION: "us-east-1",
    // The Lambda filesystem is read-only except /tmp.
    HOME: "/tmp",
  },
});
