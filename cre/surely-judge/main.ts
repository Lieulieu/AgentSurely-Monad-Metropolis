/**
 * Entrypoint compiled by the CRE CLI (workflow-path in workflow.yaml).
 * The logic lives in workflow.ts so it can be unit-tested with bun.
 */
import { Runner } from "@chainlink/cre-sdk";
import { configSchema, initWorkflow, type Config } from "./workflow";

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
