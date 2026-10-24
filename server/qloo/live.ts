// Live Qloo source: runs `qloo exec <operation>` from @qloo/qloo-harness and
// reads its JSON. The key comes from QLOO_API_KEY in the server environment
// only; it is never passed on the command line or sent to the browser.
// Result mapping is finished on Day 3 once real responses can be inspected.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AreaTaste, QlooSource } from "./types.ts";
import { QlooError } from "./types.ts";

// The package's exports hide bin.js, so point at it inside node_modules.
const QLOO_BIN = fileURLToPath(new URL("../../node_modules/@qloo/qloo-harness/dist/bin.js", import.meta.url));

export function qlooExec(operation: string, input: Record<string, unknown>, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [QLOO_BIN, "exec", operation],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) => {
        if (err) {
          const text = `${stdout}\n${stderr}`;
          const code = text.match(/QLOO_[A-Z_]+/)?.[0] ?? "QLOO_EXEC_FAILED";
          return reject(new QlooError(code, code === "QLOO_RATE_LIMIT" ? "Qloo rate limit reached. Try again shortly." : `Qloo ${operation} failed (${code}).`));
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new QlooError("QLOO_BAD_JSON", `Qloo ${operation} returned non-JSON output.`));
        }
      },
    );
    child.stdin?.end(JSON.stringify(input));
  });
}

export const liveSource: QlooSource = {
  mode: "live",
  async areaTaste(_location: string): Promise<AreaTaste> {
    throw new QlooError("NOT_IMPLEMENTED", "Live Qloo mapping lands on Day 3; set QLOO_MODE=sample.");
  },
};
