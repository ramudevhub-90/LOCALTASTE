import { defineFunction, secret } from "@aws-amplify/backend";

// SQS consumer that runs the agent (Qloo + Claude). Runs can take 20–40 s,
// longer than an AppSync resolver may, hence the queue in front of it.
// Both keys are Amplify secrets (SSM). Until one is set, its variable holds a
// placeholder and the worker falls back to sample data / template writing.
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
    ANTHROPIC_API_KEY: secret("ANTHROPIC_API_KEY"),
    CLAUDE_MODEL: "claude-opus-5-5",
    // The Lambda filesystem is read-only except /tmp.
    HOME: "/tmp",
  },
});
