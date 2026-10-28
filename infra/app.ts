// CDK app: one stack, "localtaste", in us-east-1. Deploy with `npm run deploy`.
import { App } from "aws-cdk-lib";
import { LocaltasteStack } from "./stack.ts";

const app = new App();
new LocaltasteStack(app, "localtaste", {
  stackName: "localtaste",
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" },
  description: "Localtaste: taste advisor for independent cafés (Qloo + Amazon Bedrock)",
  bedrockRoleArn: app.node.tryGetContext("bedrockRoleArn"),
});
