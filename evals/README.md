# evals/

End-to-end evaluation harness for the Wanderdog MCP tools. Loops a Claude
API call + in-process tool dispatch + a Claude-as-judge scorer over a
curated prompt set, and writes a markdown report with pass/fail, scores,
tool-call breakdown, token usage, and approximate $ cost.

## Why this exists

Wanderdog's unit and integration tests verify that each tool *works*. What
they don't verify is whether the *agent* — handed the tools and a
user-style prompt — actually picks the right tool, uses it well, and
turns the response into something the user wanted. That requires a
real model in the loop. The eval harness is that loop, plus a judge, plus
a fence against regressions when we tune tool descriptions.

## Requirements

- `ANTHROPIC_API_KEY` in `.env` (not currently in `.env.example` by
  default — add it before running)
- `WANDERLOG_COOKIE` in `.env` (same as the MCP server)
- A non-empty Wanderlog account. Most discovery prompts work on any
  account; mutation prompts create and tear down their own throwaway
  trips, but the account must allow creating new trips.

## Running

```bash
# Dry run — print the selected prompts without calling any APIs
npm run eval -- --dry

# Full read-only suite (no mutations, no held-out)
npm run eval

# Include mutation prompts (will create and modify trips in your account)
npm run eval -- --mutations

# Single prompt by ID prefix
npm run eval -- --filter D1

# One category
npm run eval -- --category disambiguation

# Final evaluation against held-out set only (don't tune on these)
npm run eval -- --only-held-out
```

Reports land in `evals/reports/eval-<timestamp>.md` and the report dir
is gitignored so you can check them in selectively.

## Architecture

```
run.ts          CLI — parses flags, wires everything, runs the loop
harness.ts      Agent loop — Claude API + in-process tool dispatch
judge.ts        Claude-as-judge with forced-tool-use structured output
prompts.ts      ~20 prompts with rubrics, grouped by category
tools-adapter.ts   Maps our MCP tools to Anthropic tool definitions
schema.ts       Minimal Zod → JSON-schema converter (subset we use)
report.ts       Markdown report + token/cost summary
types.ts        Shared types
```

**In-process dispatch.** The harness doesn't spawn the MCP server. It
imports each tool function and calls it directly against a live
`AppContext`. This is faster, simpler, and avoids re-testing the MCP
transport — the integration suite already covers that surface.

**Tool caching.** The full tool list is marked
`cache_control: "ephemeral"` on the last tool definition, so a full eval
run pays for the tool block once and reads it cheaply for every
subsequent prompt.

**Judging.** The judge is a separate Claude call per prompt with a
rubric-only system prompt. It returns its verdict via a forced
`record_verdict` tool use, which makes the output structured and
robust without regex-scraping prose.

## Prompt categories

| Category | What it tests |
|---|---|
| `discovery` | Read-only tool selection, correct arguments, faithful summaries |
| `disambiguation` | Behavior on ambiguous or non-existent references |
| `injection` | Refusal to follow adversarial instructions embedded in user text |
| `error-handling` | Behavior when a tool returns a structured error |
| `mutation` | Write tools — create/add/remove/update, with round-trip verification |

## Extending the suite

1. Add a prompt to `evals/prompts.ts` with an `id`, `category`, `rubric`,
   and optional `expectedTools` / `mutation` / `heldOut`.
2. Run `npm run eval -- --filter <id>` to smoke it.
3. If the judge is inconsistent, tighten the rubric — the rubric is the
   actual unit of truth, not the prompt.
4. Add a held-out variant if the prompt will be used during tuning.

## Tuning workflow

1. Baseline: `npm run eval -- --mutations` with unmodified tool descriptions.
2. Change *one* tool description or system prompt.
3. Re-run the same command. Compare pass counts, scores, and tool-call
   counts from the two reports.
4. If the change wins, commit it. If it regresses held-out, revert.
5. Never tune against the held-out set — run `--only-held-out` only for
   final validation.

## Known limitations

- In-process dispatch bypasses MCP framing. If a bug lives in the
  `McpServer` wiring, evals won't catch it — the smoke integration tests
  do. This is a deliberate tradeoff.
- Mutation evals rely on the agent creating throwaway trips and
  cleaning them up. Misbehaving prompts may leave orphan trips — check
  your account after mutation runs.
- Cost approximation uses hard-coded Sonnet 4.6 pricing; update
  `evals/report.ts` if pricing shifts.
