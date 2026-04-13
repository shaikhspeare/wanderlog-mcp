import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EvalResult, SuiteSummary } from "./types.js";

/**
 * Approximate Sonnet 4.6 pricing (input/output per 1M tokens). Kept in one
 * place so we can update it in one spot when pricing moves. Cache-read and
 * cache-create rates also approximated — only used for a rough $ figure
 * in the report.
 */
const PRICE_PER_1M = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.3,
};

export function summarize(results: EvalResult[], durationMs: number): SuiteSummary {
  const total = results.length;
  const passed = results.filter((r) => r.verdict.pass).length;
  const failed = total - passed;

  const averageScore =
    total === 0 ? 0 : results.reduce((a, r) => a + r.verdict.score, 0) / total;
  const averageToolCalls =
    total === 0 ? 0 : results.reduce((a, r) => a + r.run.toolCalls.length, 0) / total;

  const totalInputTokens = results.reduce((a, r) => a + r.run.inputTokens, 0);
  const totalOutputTokens = results.reduce((a, r) => a + r.run.outputTokens, 0);
  const totalCacheReadTokens = results.reduce(
    (a, r) => a + r.run.cacheReadTokens,
    0,
  );
  const totalCacheCreateTokens = results.reduce(
    (a, r) => a + r.run.cacheCreateTokens,
    0,
  );

  const approxCostUsd =
    (totalInputTokens / 1_000_000) * PRICE_PER_1M.input +
    (totalOutputTokens / 1_000_000) * PRICE_PER_1M.output +
    (totalCacheCreateTokens / 1_000_000) * PRICE_PER_1M.cacheWrite +
    (totalCacheReadTokens / 1_000_000) * PRICE_PER_1M.cacheRead;

  return {
    total,
    passed,
    failed,
    averageScore,
    averageToolCalls,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreateTokens,
    approxCostUsd,
    durationMs,
  };
}

export function renderMarkdown(
  results: EvalResult[],
  summary: SuiteSummary,
  meta: { model: string; judgeModel: string; timestamp: string },
): string {
  const lines: string[] = [];
  lines.push(`# Wanderdog eval run — ${meta.timestamp}`);
  lines.push("");
  lines.push(`- **Agent model:** \`${meta.model}\``);
  lines.push(`- **Judge model:** \`${meta.judgeModel}\``);
  lines.push(`- **Prompts:** ${summary.total}`);
  lines.push(`- **Passed:** ${summary.passed} / ${summary.total}`);
  lines.push(`- **Average score:** ${summary.averageScore.toFixed(2)} / 10`);
  lines.push(`- **Average tool calls:** ${summary.averageToolCalls.toFixed(2)}`);
  lines.push(`- **Duration:** ${(summary.durationMs / 1000).toFixed(1)}s`);
  lines.push(
    `- **Tokens:** ${summary.totalInputTokens.toLocaleString()} in, ${summary.totalOutputTokens.toLocaleString()} out (cache read: ${summary.totalCacheReadTokens.toLocaleString()}, create: ${summary.totalCacheCreateTokens.toLocaleString()})`,
  );
  lines.push(`- **Approx cost:** $${summary.approxCostUsd.toFixed(4)}`);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push(
    "| ID | Category | Pass | Score | Tool calls | Turns | Time (ms) | Tokens in/out |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const pass = r.verdict.pass ? "✅" : "❌";
    const toolNames = r.run.toolCalls.map((c) => c.name.replace("wanderlog_", "")).join(", ");
    lines.push(
      `| ${r.prompt.id} | ${r.prompt.category} | ${pass} | ${r.verdict.score} | ${r.run.toolCalls.length} (${toolNames || "—"}) | ${r.run.turns} | ${r.run.durationMs} | ${r.run.inputTokens}/${r.run.outputTokens} |`,
    );
  }
  lines.push("");
  lines.push("## Details");
  lines.push("");
  for (const r of results) {
    const pass = r.verdict.pass ? "✅" : "❌";
    lines.push(`### ${pass} ${r.prompt.id} — ${r.prompt.category}`);
    lines.push("");
    lines.push(`**Prompt:** ${r.prompt.prompt}`);
    lines.push("");
    lines.push(`**Rubric:** ${r.prompt.rubric}`);
    lines.push("");
    lines.push(`**Verdict:** score ${r.verdict.score}/10 — ${r.verdict.rationale}`);
    lines.push("");
    if (r.run.error) {
      lines.push(`**⚠ Harness error:** ${r.run.error}`);
      lines.push("");
    }
    lines.push("**Tool calls:**");
    if (r.run.toolCalls.length === 0) {
      lines.push("- (none)");
    } else {
      for (const c of r.run.toolCalls) {
        const flag = c.isError ? " ⚠" : "";
        lines.push(
          `- \`${c.name}\`${flag} (${c.durationMs}ms) ← ${JSON.stringify(c.input)}`,
        );
      }
    }
    lines.push("");
    lines.push("**Final response:**");
    lines.push("```");
    lines.push(r.run.finalText || "(empty)");
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

export function writeReport(
  markdown: string,
  reportsDir: string,
): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const path = join(reportsDir, `eval-${timestamp}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, markdown, "utf8");
  return path;
}
