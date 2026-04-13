import Anthropic from "@anthropic-ai/sdk";
import type { AppContext } from "../src/context.js";
import type { WanderdogToolDef } from "./tools-adapter.js";
import type { AgentRunResult, EvalPrompt, ToolCallLogEntry } from "./types.js";

/**
 * Runs one eval prompt against a real Claude API call, dispatching any
 * tool_use blocks against the provided Wanderdog tools in-process.
 *
 * Design notes:
 *   - Tools are cache-controlled so the full list is paid for once per run.
 *   - Max turns is capped to stop runaway loops; if the model keeps
 *     calling tools past the cap, we end the run with an error.
 *   - Tool results over 16k chars are truncated before being sent back,
 *     so one oversized response can't blow the context budget for the
 *     rest of the conversation.
 */

const MAX_TURNS = 12;
const MAX_TOOL_RESULT_CHARS = 16_000;

const SYSTEM_PROMPT = `You are an assistant helping a user plan trips via the Wanderdog MCP tools. You have access to tools that read from and write to the user's real Wanderlog account.

Rules:
- Prefer wanderlog_list_trips first when the user names a trip but you don't have its trip_key.
- Pass ISO dates (YYYY-MM-DD) when the tool supports them.
- For mutations, confirm the action succeeded by re-reading the trip before claiming success in borderline cases.
- Keep final answers concise and directly responsive to the user. Do not narrate every tool call.
- If a tool returns an error with "Next steps:", follow the first applicable suggestion automatically — don't ask the user to clarify if the tool already told you what to do.`;

export type HarnessOptions = {
  anthropic: Anthropic;
  model: string;
  tools: WanderdogToolDef[];
  ctx: AppContext;
  maxTurns?: number;
};

export async function runAgent(
  opts: HarnessOptions,
  prompt: EvalPrompt,
): Promise<AgentRunResult> {
  const started = Date.now();
  const toolCalls: ToolCallLogEntry[] = [];

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  let stopReason = "unknown";
  let finalText = "";

  const anthropicTools = opts.tools.map((t, i) => {
    const def: Record<string, unknown> = {
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    };
    // Cache the last tool — Anthropic caches the full tools block up to
    // and including the marked entry.
    if (i === opts.tools.length - 1) {
      def.cache_control = { type: "ephemeral" };
    }
    return def;
  });

  type Message = Anthropic.Messages.MessageParam;
  const messages: Message[] = [
    { role: "user", content: prompt.prompt },
  ];

  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  let turn = 0;
  let hitError: string | undefined;

  while (turn < maxTurns) {
    turn++;
    let response: Anthropic.Messages.Message;
    try {
      response = await opts.anthropic.messages.create({
        model: opts.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: anthropicTools as unknown as Anthropic.Messages.Tool[],
        messages,
      });
    } catch (err) {
      hitError = `anthropic_error: ${(err as Error).message}`;
      stopReason = "api_error";
      break;
    }

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    cacheCreateTokens += response.usage.cache_creation_input_tokens ?? 0;
    stopReason = response.stop_reason ?? "unknown";

    // Collect text from this turn; each turn's text is the running
    // candidate for the final answer — we take the last one at end_turn.
    const turnText = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (turnText) finalText = turnText;

    // Push the assistant message into history verbatim so tool_use ids
    // line up when we reply with tool_result blocks.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") break;

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) break;

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const t0 = Date.now();
      const tool = opts.tools.find((x) => x.name === use.name);
      let out: { text: string; isError: boolean };
      if (!tool) {
        out = {
          text: `error: tool "${use.name}" not available`,
          isError: true,
        };
      } else {
        try {
          out = await tool.run(opts.ctx, use.input as Record<string, unknown>);
        } catch (err) {
          out = {
            text: `tool threw: ${(err as Error).message}`,
            isError: true,
          };
        }
      }
      const durationMs = Date.now() - t0;
      toolCalls.push({
        name: use.name,
        input: use.input,
        output: out.text,
        durationMs,
        isError: out.isError,
      });
      const truncated =
        out.text.length > MAX_TOOL_RESULT_CHARS
          ? `${out.text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[... truncated ${
              out.text.length - MAX_TOOL_RESULT_CHARS
            } chars ...]`
          : out.text;
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: truncated,
        is_error: out.isError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!hitError && turn >= maxTurns && stopReason === "tool_use") {
    hitError = `max_turns_exceeded (${maxTurns})`;
  }

  return {
    promptId: prompt.id,
    finalText,
    toolCalls,
    stopReason,
    turns: turn,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
    durationMs: Date.now() - started,
    error: hitError,
  };
}
