import { util } from "@aws-appsync/utils";

// Mutation.updateAnalysisJob (worker only): set the given fields and stamp
// updatedAt. Going through AppSync, not DynamoDB directly, is what pushes the
// change to subscribers.
export function request(ctx) {
  const input = ctx.args.input;
  const sets = ["#updatedAt = :updatedAt"];
  const names = { "#updatedAt": "updatedAt" };
  const values = { ":updatedAt": util.time.nowISO8601() };
  Object.keys(input).forEach((k) => {
    if (k === "id" || input[k] === null || input[k] === undefined) return;
    sets.push(`#${k} = :${k}`);
    names[`#${k}`] = k;
    values[`:${k}`] = input[k];
  });
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ id: input.id }),
    update: { expression: `SET ${sets.join(", ")}`, expressionNames: names, expressionValues: util.dynamodb.toMapValues(values) },
    condition: { expression: "attribute_exists(id)" },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
