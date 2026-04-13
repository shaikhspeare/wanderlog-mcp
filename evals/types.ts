/**
 * Shared types for the evaluation harness. Kept in one file so the
 * harness, prompts, judge, and reporter all agree on shapes.
 */

export type EvalCategory =
  | "discovery"
  | "disambiguation"
  | "mutation"
  | "injection"
  | "error-handling";

export type EvalPrompt = {
  id: string;
  category: EvalCategory;
  /** The user message sent to the agent. */
  prompt: string;
  /**
   * Human-written rubric the judge uses to decide pass/fail. Speak to the
   * judge like a spec: what the final response MUST contain, what tool calls
   * are expected, and what would count as failure.
   */
  rubric: string;
  /**
   * Optional: names of tools the agent SHOULD call. Used for a cheap
   * pre-judge sanity check and to surface tool-choice regressions.
   */
  expectedTools?: string[];
  /** Mark mutation prompts so they can be filtered out by default. */
  mutation?: boolean;
  /** Held-out prompts are skipped in tuning runs; only used for final evaluation. */
  heldOut?: boolean;
  /** If set, the prompt requires a real trip_key from the test account. */
  requiresTripKey?: boolean;
};

export type ToolCallLogEntry = {
  name: string;
  input: unknown;
  /** Stringified tool result (text content or error message). */
  output: string;
  durationMs: number;
  isError: boolean;
};

export type AgentRunResult = {
  promptId: string;
  finalText: string;
  toolCalls: ToolCallLogEntry[];
  stopReason: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** Total wall-clock time including all network calls. */
  durationMs: number;
  /** Fatal error that stopped the loop (auth, rate limit, transport, etc.). */
  error?: string;
};

export type JudgeVerdict = {
  pass: boolean;
  score: number; // 0..10
  rationale: string;
};

export type EvalResult = {
  prompt: EvalPrompt;
  run: AgentRunResult;
  verdict: JudgeVerdict | { pass: false; score: 0; rationale: string };
};

export type SuiteSummary = {
  total: number;
  passed: number;
  failed: number;
  averageScore: number;
  averageToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  approxCostUsd: number;
  durationMs: number;
};
