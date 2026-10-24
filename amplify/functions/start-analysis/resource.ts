import { defineFunction } from "@aws-amplify/backend";

// AppSync resolver for startAnalysis: records the job and enqueues it.
export const startAnalysis = defineFunction({
  name: "start-analysis",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 10,
  resourceGroupName: "data",
});
