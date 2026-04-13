# Wanderdog — agent instructions

Wanderdog is an MCP server that exposes [Wanderlog](https://wanderlog.com) trip editing to LLM agents. TypeScript, stdio transport, cookie-based auth.

## Read before making changes

In order:

1. `docs/north-star.md` — goals, non-goals, success criteria
2. `docs/architecture.md` — file layout, runtime flow, and the **invariants** you must not violate
3. `docs/kanban.md` — current status and what's next
4. `docs/gotchas.md` — landmines we've already hit; read this before you think "it should be easy"
5. `docs/api-reference.md` — reverse-engineered Wanderlog protocol (consult as needed)

## Keep the kanban in sync

`docs/kanban.md` is the source of truth for project status. Update it as you work:

- **Before starting a task:** move it from Todo to Doing (🚧). If the task isn't in the board yet, add it in the right phase before starting.
- **While working:** if you discover follow-up tasks, bugs, or scope changes, add them to the appropriate phase's Todo section.
- **When completing a task:** move it to Done (✅) with a short note — one sentence on what shipped, optionally referencing the commit or file.
- **When finishing a phase:** update the phase status marker at the top and flip the section header (📍 → ✅).
- **Status markers:** ✅ done · 🚧 in progress · 📍 next · ⏸️ planned · ❌ dropped. Stick to these.

Diffs to `docs/kanban.md` should be small and visible in git log. If you make a large change to the board, include it in a dedicated commit with a message like `kanban: mark phase 2 mutation tools complete`.

## Invariants (from `docs/architecture.md` — do not violate)

1. Never assume block shape. Real trips contain `place`, `note`, `flight`, `train`, and unknown types. Always discriminate on `block.type` with a fallback.
2. Never expose raw IDs (`place_id`, section indices, ShareDB paths) to the LLM by default. Use natural references.
3. Every REST response is `{success, payload}`. Always unwrap.
4. Startup must fail fast on auth errors, not silently run with broken auth.
5. Cookie value must never appear in tool responses, logs, or error messages.
6. Section indices are not stable across edits. Always resolve by `date`/`heading`/`type` from a fresh snapshot.
7. Natural language in, natural language out — the LLM shouldn't need to touch ShareDB paths or `ChIJ...` place_ids.
8. **All mutations go through `submitOp` in `src/tools/shared.ts`.** That helper holds the per-trip mutex, wraps the submit in try/catch, and invalidates the cache on failure. Do NOT call `ShareDBClient.submit()` directly from a tool — it bypasses parallel-safety and cache-consistency guarantees.
9. Failed submits must invalidate the cache (`tripCache.invalidate(tripKey)`) so the next read refetches a fresh snapshot.
10. Error frames in `ShareDBClient.handleFrame` must be matched by `seq` first; only fall back to `failAllPending` when the error can't be attributed. One op's error must not kill unrelated in-flight ops.

If a change would require violating one of these, stop and ask the user — don't work around it.

## Dev commands

```bash
npm run build            # compile TS → dist/
npm run test             # unit tests only (no network, fast)
npm run test:integration # live tests against wanderlog.com (requires .env)
npm run test:all         # both
npm run typecheck        # tsc --noEmit
npm run probe            # standalone ShareDB WS probe from Phase 0
```

After changing any `src/**` file, always run `npm run build && npm run test` before claiming the work is done. For changes to `src/transport/**` or `src/tools/**`, also run `npm run test:integration`.

## Don't

- Don't create new top-level docs or README files — extend the existing ones in `docs/` instead.
- Don't add dependencies without a reason. We intentionally use native `fetch` over `undici`, vitest without plugins, and zero HTTP client libraries. Justify new deps in the PR description.
- Don't write comments explaining what code does — names should. Only comment *why* when the reason is non-obvious (hidden constraint, workaround for a specific bug, surprising behavior).
- Don't commit `.env` or anything containing a `connect.sid` value. `.gitignore` already covers `.env` but double-check before `git add`.
- Don't skip the auth probe on startup. It's cheap and it catches the #1 failure mode (expired cookie) immediately.
- Don't re-derive the Wanderlog protocol from HAR files if `docs/api-reference.md` already covers what you need. Update that doc instead when you discover something new.

## Secrets

The `connect.sid` cookie in `.env` is long-lived (~1 year). Treat it as a high-value credential. It's gitignored and should stay that way. If you ever think you need to print it for debugging, you don't — the auth probe tells you whether it's valid without leaking the value.
