// Live Qloo source: runs harness workflows in-process via
// createDirectQlooWorkflowExecutorFromEnvironment, which reads QLOO_API_KEY.
// The key only ever lives in the Lambda environment (Amplify secret).
// Result mapping is finished on Day 3 once real responses can be inspected.

import { createDirectQlooWorkflowExecutorFromEnvironment } from "@qloo/qloo-harness";
import type { AreaTaste, QlooSource } from "./types.ts";
import { QlooError } from "./types.ts";

type Executor = NonNullable<ReturnType<typeof createDirectQlooWorkflowExecutorFromEnvironment>>;
let executor: Executor | undefined;

export async function qlooExec(operation: Parameters<Executor["execute"]>[0], input: Record<string, unknown>) {
  executor ??= createDirectQlooWorkflowExecutorFromEnvironment();
  if (!executor) throw new QlooError("QLOO_NOT_CONFIGURED", "Qloo is not configured (missing QLOO_API_KEY).");
  try {
    const run = await executor.execute(operation, input as never);
    return run.result;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "QLOO_FAILED";
    const message = code === "QLOO_RATE_LIMIT" ? "Qloo rate limit reached. Try again shortly." : `Qloo ${operation} failed (${code}).`;
    throw new QlooError(code, message);
  }
}

export const liveSource: QlooSource = {
  mode: "live",
  async areaTaste(_location: string): Promise<AreaTaste> {
    throw new QlooError("NOT_IMPLEMENTED", "Live Qloo mapping lands on Day 3; set QLOO_MODE=sample.");
  },
};
