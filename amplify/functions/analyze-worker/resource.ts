import { defineFunction, secret } from "@aws-amplify/backend";

// SQS consumer that runs the agent (Qloo + Claude on Bedrock). Runs can take
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
    // Claude via Bedrock with the Lambda role; no API key. Claude 5.x is not
    // offered to this account, so use Sonnet 4.6 (needs the one-time Anthropic
    // use-case form in the Bedrock console).
    LLM_PROVIDER: "bedrock",
    BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-4-6",
    // The Lambda filesystem is read-only except /tmp.
    HOME: "/tmp",
  },
});
