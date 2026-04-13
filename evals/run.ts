import Anthropic from "@anthropic-ai/sdk";
import { createContext } from "../src/context.js";
import { WanderlogError } from "../src/errors.js";
import { runAgent } from "./harness.js";
import { judge } from "./judge.js";
import { EVAL_PROMPTS } from "./prompts.js";
import { renderMarkdown, summarize, writeReport } from "./report.js";
import { WANDERDOG_TOOLS } from "./tools-adapter.js";
import type { EvalResult } from "./types.js";

/**
 * Eval CLI entrypoint. Wires the Anthropic client, the Wanderdog tool
 * adapter, and the prompt set together, then runs each prompt through
 * the agent + judge pipeline and writes a markdown report.
 *
 * Env:
 *   ANTHROPIC_API_KEY   required
 *   WANDERLOG_COOKIE    required (same as the MCP server)
 *   WANDERLOG_EVAL_MODEL         default: claude-sonnet-4-6
 *   WANDERLOG_EVAL_JUDGE_MODEL   default: claude-sonnet-4-6
 *
 * Flags:
 *   --filter <id>       run only prompts whose id starts with <id>
 *   --category <cat>    run only prompts in this category
 *   --mutations         include mutation prompts (default: off)
 *   --held-out          include held-out prompts (default: off)
 *   --only-held-out     run ONLY held-out prompts (final eval)
 *   --dry               build + print plan without calling any APIs
 */

type Flags = {
  filter?: string;
  category?: string;
  mutations: boolean;
  heldOut: boolean;
  onlyHeldOut: boolean;
  dry: boolean;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    mutations: false,
    heldOut: false,
    onlyHeldOut: false,
    dry: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--filter") flags.filter = argv[++i];
    else if (a === "--category") flags.category = argv[++i];
    else if (a === "--mutations") flags.mutations = true;
    else if (a === "--held-out") flags.heldOut = true;
    else if (a === "--only-held-out") flags.onlyHeldOut = true;
    else if (a === "--dry") flags.dry = true;
  }
  return flags;
}

function selectPrompts(flags: Flags) {
  return EVAL_PROMPTS.filter((p) => {
    if (flags.onlyHeldOut) return p.heldOut === true;
    if (p.heldOut && !flags.heldOut) return false;
    if (p.mutation && !flags.mutations) return false;
    if (flags.filter && !p.id.startsWith(flags.filter)) return false;
    if (flags.category && p.category !== flags.category) return false;
    return true;
  });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const model = process.env.WANDERLOG_EVAL_MODEL ?? "claude-sonnet-4-6";
  const judgeModel =
    process.env.WANDERLOG_EVAL_JUDGE_MODEL ?? "claude-sonnet-4-6";

  const selected = selectPrompts(flags);
  console.log(`[eval] ${selected.length} prompts selected`);
  console.log(
    `[eval] agent=${model} judge=${judgeModel} mutations=${flags.mutations} heldOut=${flags.heldOut || flags.onlyHeldOut}`,
  );

  if (flags.dry) {
    for (const p of selected) {
      console.log(`  ${p.id} [${p.category}] ${p.prompt.slice(0, 72)}`);
    }
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "[eval] ANTHROPIC_API_KEY is not set — add it to .env or export it",
    );
    process.exit(1);
  }

  // Wanderdog context + auth probe (same code path as the real server
  // boot so a broken cookie is caught before we burn any API calls).
  let ctx;
  try {
    ctx = createContext();
    const user = await ctx.rest.getUser();
    ctx.userId = user.id;
    console.log(`[eval] wanderlog authenticated as ${user.username} (${user.id})`);
  } catch (err) {
    const msg =
      err instanceof WanderlogError ? err.toUserMessage() : (err as Error).message;
    console.error(`[eval] wanderlog auth failed: ${msg}`);
    process.exit(1);
  }

  const anthropic = new Anthropic();

  const results: EvalResult[] = [];
  const suiteStart = Date.now();

  for (const prompt of selected) {
    const started = Date.now();
    process.stdout.write(`[eval] ${prompt.id} (${prompt.category}) … `);
    const run = await runAgent(
      { anthropic, model, tools: WANDERDOG_TOOLS, ctx },
      prompt,
    );
    const verdict = await judge({ anthropic, model: judgeModel }, prompt, run);
    const elapsed = Date.now() - started;
    const mark = verdict.pass ? "✅" : "❌";
    process.stdout.write(
      `${mark} score=${verdict.score}/10 turns=${run.turns} tools=${run.toolCalls.length} ${elapsed}ms\n`,
    );
    if (run.error) {
      console.log(`   ⚠ harness error: ${run.error}`);
    }
    results.push({ prompt, run, verdict });
  }

  const duration = Date.now() - suiteStart;
  const summary = summarize(results, duration);

  console.log("");
  console.log(
    `[eval] ${summary.passed}/${summary.total} passed, avg score ${summary.averageScore.toFixed(2)}/10, approx $${summary.approxCostUsd.toFixed(4)}`,
  );

  const markdown = renderMarkdown(results, summary, {
    model,
    judgeModel,
    timestamp: new Date().toISOString(),
  });
  const path = writeReport(markdown, "evals/reports");
  console.log(`[eval] report written to ${path}`);

  // Close transports so the process exits cleanly. Without this the
  // ShareDB pool keeps sockets open from any subscribe calls the agent
  // triggered during mutation prompts.
  ctx.pool.closeAll();

  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`[eval] fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
