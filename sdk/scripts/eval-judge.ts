/**
 * Calibrates the judge: runs every labelled case through the same judge-core
 * the CRE workflow uses and reports accuracy at a 70 threshold.
 *   npm run eval:judge            # LLM if LLM_API_KEY is set, else mock
 *   npm run eval:judge -- --mock
 * Writes docs/judge-eval.md for the README / pitch.
 */
import fs from "node:fs";
import path from "node:path";
import { buildJudgeRequest, mockJudge, parseJudgeResponse } from "../../cre/surely-judge/judge-core";
import { chat, llm } from "./env";
import { EVAL_CASES } from "./eval-cases";

const THRESHOLD = 70;

async function score(spec: string, output: string) {
  if (!llm) return mockJudge(spec, output);
  const body = buildJudgeRequest(llm.model, spec, output);
  return parseJudgeResponse(await chat(body.messages, { temperature: 0, response_format: { type: "json_object" } }));
}

async function main() {
  const judge = llm ? llm.model : "mock";
  console.log(`Judge eval · ${judge} · threshold ${THRESHOLD}\n`);
  const rows: string[] = [];
  let correct = 0;
  for (const c of EVAL_CASES) {
    const r = await score(c.spec, c.output);
    const got = r.score >= THRESHOLD ? "pass" : "fail";
    const hit = got === c.expect;
    if (hit) correct++;
    console.log(`${hit ? "✔" : "✖"} ${c.id.padEnd(24)} score ${String(r.score).padStart(3)}  expected ${c.expect}  got ${got}`);
    rows.push(`| ${c.id} | ${c.expect} | ${r.score} | ${got} | ${hit ? "✅" : "❌"} | ${r.reason.replace(/\|/g, "/")} |`);
  }
  const acc = Math.round((100 * correct) / EVAL_CASES.length);
  console.log(`\nAccuracy ${correct}/${EVAL_CASES.length} = ${acc}%`);

  const md = [
    `# Judge evaluation`,
    ``,
    `Judge: **${judge}** · threshold ${THRESHOLD} · ${new Date().toISOString().slice(0, 10)} · accuracy **${correct}/${EVAL_CASES.length} (${acc}%)**`,
    ``,
    `| Case | Expected | Score | Verdict | OK | Reason |`,
    `|---|---|---|---|---|---|`,
    ...rows,
    ``,
    `Cases: \`sdk/scripts/eval-cases.ts\`. Re-run: \`npm run eval:judge\`.`,
  ].join("\n");
  const out = path.resolve(__dirname, "..", "..", "docs", llm ? "judge-eval.md" : "judge-eval-mock.md");
  fs.writeFileSync(out, md + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
