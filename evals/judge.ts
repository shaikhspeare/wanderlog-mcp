import Anthropic from "@anthropic-ai/sdk";
import type { AgentRunResult, EvalPrompt, JudgeVerdict } from "./types.js";

/**
 * Claude-as-judge. Hands the agent transcript and the prompt's rubric to
 * a fresh Claude call and asks for a structured verdict via forced tool
 * use. Tool use is a stronger structured-output mechanism than asking
 * for JSON in text: the model cannot accidentally wander off schema.
 */

const JUDGE_SYSTEM = `You are a rigorous evaluator of a trip-planning agent. You receive:
1. The user prompt the agent was asked to fulfill.
2. The rubric defining what a correct response looks like.
3. A log of the tools the agent called and what they returned.
4. The agent's final natural-language response.

Your job: decide pass/fail and assign a score from 0 to 10.

Judging guidelines:
- Focus on whether the rubric was met, not on surface style.
- Wrong information, hallucinated trips/places, or silent failure is a fail regardless of how nicely written the answer is.
- Missing a suggested tool call is fine if the final answer is still correct.
- Extra tool calls are fine unless they performed unintended mutations.
- A response that correctly surfaces a tool error back to the user is a pass for error-handling prompts.
- Be fair but strict. "Close enough" with missing specifics is usually a fail on discovery prompts.

Return your verdict via the record_verdict tool — don't write free prose outside it.`;

const verdictTool = {
  name: "record_verdict",
  description: "Record the evaluation verdict for one prompt.",
  input_schema: {
    type: "object" as const,
    properties: {
      pass: {
        type: "boolean",
        description: "True only if the agent met the rubric.",
      },
      score: {
        type: "number",
        description: "Integer 0..10 — 10 is ideal, 7 is clear pass, below 5 is fail.",
      },
      rationale: {
        type: "string",
        description:
          "2-4 sentences explaining the key observation driving the verdict. Reference specific rubric clauses and transcript evidence.",
      },
    },
    required: ["pass", "score", "rationale"],
    additionalProperties: false,
  },
};

export type JudgeOptions = {
  anthropic: Anthropic;
  model: string;
};

export async function judge(
  opts: JudgeOptions,
  prompt: EvalPrompt,
  run: AgentRunResult,
): Promise<JudgeVerdict> {
  const toolLog = run.toolCalls.length
    ? run.toolCalls
        .map(
          (c, i) =>
            `--- call ${i + 1}: ${c.name}${c.isError ? " (ERROR)" : ""} ---\ninput: ${JSON.stringify(c.input)}\noutput: ${truncate(c.output, 2000)}`,
        )
        .join("\n\n")
    : "(no tool calls)";

  const userMessage = `USER PROMPT:
${prompt.prompt}

RUBRIC:
${prompt.rubric}

${prompt.expectedTools ? `EXPECTED TOOLS (informational, not strictly required): ${prompt.expectedTools.join(", ")}\n` : ""}
TRANSCRIPT — TOOL CALLS (${run.toolCalls.length}):
${toolLog}

AGENT FINAL RESPONSE:
${run.finalText || "(empty)"}

${run.error ? `HARNESS ERROR: ${run.error}` : ""}

Now record your verdict via the record_verdict tool.`;

  try {
    const response = await opts.anthropic.messages.create({
      model: opts.model,
      max_tokens: 1024,
      system: JUDGE_SYSTEM,
      tools: [verdictTool as Anthropic.Messages.Tool],
      tool_choice: { type: "tool", name: "record_verdict" },
      messages: [{ role: "user", content: userMessage }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      return {
        pass: false,
        score: 0,
        rationale: "judge failed: no tool_use block in response",
      };
    }

    const input = toolUse.input as {
      pass: boolean;
      score: number;
      rationale: string;
    };
    return {
      pass: Boolean(input.pass),
      score: clamp(input.score, 0, 10),
      rationale: String(input.rationale ?? ""),
    };
  } catch (err) {
    return {
      pass: false,
      score: 0,
      rationale: `judge errored: ${(err as Error).message}`,
    };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…[truncated ${s.length - n} chars]` : s;
}

function clamp(n: number, lo: number, hi: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
