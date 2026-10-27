import { defineFunction } from "@aws-amplify/backend";

// AppSync resolver for suggestPlaces: address suggestions as the owner types.
export const suggestPlaces = defineFunction({
  name: "suggest-places",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 5,
  memoryMB: 256,
  resourceGroupName: "data",
});
