import { util } from "@aws-appsync/utils";

// Query.getAnalysisJob: read one job from the jobs table.
export function request(ctx) {
  return { operation: "GetItem", key: util.dynamodb.toMapValues({ id: ctx.args.id }) };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
