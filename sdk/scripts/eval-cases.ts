/** Labelled task/output pairs used to calibrate the judge rubric (expected verdict at minScore 70). */
export type EvalCase = { id: string; spec: string; output: string; expect: "pass" | "fail" };

const MONAD = "Summarise Monad's parallel execution model in 5 bullet points for a non-technical reader.";
const TRANSLATE = "Translate into Vietnamese with a friendly tone: 'Hire AI agents that put money behind their work.'";
const AUDIT =
  "Review this Solidity function for reentrancy risk and explain in 3 sentences: function withdraw() external { (bool ok,) = msg.sender.call{value: bal[msg.sender]}(\"\"); bal[msg.sender] = 0; }";
const SQL = "Write a PostgreSQL query returning the 3 customers with the highest total order amount from orders(customer_id, amount).";
const EMAIL = "Write a 3-sentence polite email declining a meeting on Friday and proposing Monday 10am instead.";

export const EVAL_CASES: EvalCase[] = [
  {
    id: "monad-good",
    spec: MONAD,
    output:
      "- Monad works like a supermarket with many checkout lanes: it processes many transactions at the same time instead of one by one.\n- It optimistically assumes transactions don't touch the same data.\n- If two do clash, Monad simply re-runs the affected one.\n- The final result is exactly the same as if everything ran in order, so nothing is lost.\n- This lets Monad handle around 10,000 transactions per second with very low fees.",
    expect: "pass",
  },
  { id: "monad-hallucinated", spec: MONAD, output: "- Monad is a Bitcoin sidechain.\n- It uses proof of work mining.\n- Transactions run strictly one at a time.\n- Blocks take 10 minutes.\n- It has no smart contracts.", expect: "fail" },
  { id: "monad-wrong-format", spec: MONAD, output: "Monad executes transactions in parallel and is fast.", expect: "fail" },
  { id: "translate-good", spec: TRANSLATE, output: "Thuê các AI agent dám đặt tiền thật để bảo chứng cho công việc của mình nhé!", expect: "pass" },
  { id: "translate-wrong-language", spec: TRANSLATE, output: "Contrata agentes de IA que respaldan su trabajo con dinero.", expect: "fail" },
  {
    id: "audit-good",
    spec: AUDIT,
    output:
      "The function sends ETH with an external call before zeroing the balance, so a malicious contract can re-enter withdraw() from its fallback and drain funds repeatedly. This violates the checks-effects-interactions pattern. Fix it by setting bal[msg.sender] = 0 before the call (or using a ReentrancyGuard) and checking the call result.",
    expect: "pass",
  },
  { id: "audit-wrong", spec: AUDIT, output: "This function is safe because it uses msg.sender. There is no reentrancy risk. No changes are needed.", expect: "fail" },
  {
    id: "sql-good",
    spec: SQL,
    output: "SELECT customer_id, SUM(amount) AS total\nFROM orders\nGROUP BY customer_id\nORDER BY total DESC\nLIMIT 3;",
    expect: "pass",
  },
  { id: "sql-wrong", spec: SQL, output: "SELECT * FROM orders ORDER BY amount DESC LIMIT 3;", expect: "fail" },
  {
    id: "email-good",
    spec: EMAIL,
    output:
      "Hi Anna, thank you for the invitation to meet on Friday. Unfortunately I am not available that day. Would Monday at 10am work for you instead?",
    expect: "pass",
  },
];
