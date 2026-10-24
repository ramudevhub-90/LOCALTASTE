import { defineFunction } from "@aws-amplify/backend";

// SQS consumer that runs the agent (Qloo + Bedrock). Runs can take 20–40 s,
// longer than an AppSync resolver may, hence the queue in front of it.
export const analyzeWorker = defineFunction({
  name: "analyze-worker",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 300,
  memoryMB: 1024,
  resourceGroupName: "data",
  environment: {
    QLOO_MODE: "sample",
    // Day 3: add QLOO_API_KEY: secret("QLOO_API_KEY") once the event key is set
    // with `npx ampx sandbox secret set QLOO_API_KEY` (stored in SSM).
    BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-5-5",
    // The Lambda filesystem is read-only except /tmp.
    HOME: "/tmp",
  },
});
