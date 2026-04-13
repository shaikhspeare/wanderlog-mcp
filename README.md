# Wanderdog

An MCP server that lets LLM agents view and edit [Wanderlog](https://wanderlog.com) trips through natural language. Instead of clicking around the Wanderlog UI to add a restaurant to day 2, you tell an agent *"add a sushi place to day 2 of my Tokyo trip"* and it happens.

**Status:** Phases 0–2 complete, Phase 3 in progress. **170/170 tests passing** (142 unit + 28 integration). Nine tools working end-to-end against the live Wanderlog API, plus verified parallel-write safety on live trips. See [`docs/kanban.md`](docs/kanban.md) for the roadmap.

## What you can do with it

**Read**
- `wanderlog_list_trips` — list trips in your account
- `wanderlog_get_trip` — view a full itinerary, or filter to a single day
- `wanderlog_get_trip_url` — get a sharable wanderlog.com link (edit / view / suggest modes)
- `wanderlog_search_places` — find real-world places near a trip's destination

**Write**
- `wanderlog_create_trip` — create a new trip with destination + date range
- `wanderlog_add_place` — add a place to the trip (specific day or general list)
- `wanderlog_add_hotel` — add a hotel booking with check-in and check-out dates
- `wanderlog_remove_place` — remove a place by natural-language reference
- `wanderlog_update_trip_dates` — change a trip's date range (safely handles day section add/remove and preserves content on surviving days)

## Prerequisites

- **Node.js 22 or newer**
- **A Wanderlog account** (you'll need to log in once to capture a session cookie)
- An MCP-compatible client: **Claude Code**, **Claude Desktop**, or anything else that supports stdio MCP servers

## Setup

### 1. Install

```bash
git clone https://github.com/your-org/wanderdog.git
cd wanderdog
npm install
npm run build
```

### 2. Capture your Wanderlog session cookie

Wanderdog authenticates with your `connect.sid` cookie — the same session your browser uses. Valid for ~1 year from when you log in. **It grants the same access you have in the Wanderlog UI, including trip creation/deletion, so treat it like a password.**

> **Why a cookie and not OAuth?** Wanderlog doesn't publish a public API. Wanderdog reverse-engineers the private one their web client talks to, which uses standard cookie auth.

#### Option A — DevTools (works for everyone)

1. Go to [wanderlog.com](https://wanderlog.com) in your browser and **log in**
2. Open DevTools:
   - **Chrome / Edge:** `F12` or right-click → Inspect
   - **Firefox:** `F12` or right-click → Inspect Element
   - **Safari:** Enable "Show Develop menu" in Settings → Advanced first, then right-click → Inspect Element
3. Navigate to the cookie storage view:
   - **Chrome / Edge:** *Application* tab → sidebar *Storage → Cookies → https://wanderlog.com*
   - **Firefox:** *Storage* tab → sidebar *Cookies → https://wanderlog.com*
   - **Safari:** *Storage* tab → *Cookies → wanderlog.com*
4. In the table, find the row where **Name** is `connect.sid`
5. Double-click the **Value** column and copy the entire string — it starts with `s%3A` and is quite long (~100 characters)

#### Option B — Bookmarklet (⚠️ won't work, here's why)

A tempting one-click approach is a `javascript:` bookmarklet that reads `document.cookie`. **This doesn't work** because Wanderlog sets `connect.sid` with the `HttpOnly` flag, which deliberately hides the cookie from JavaScript as an XSS protection. DevTools is the only browser-native way to read it.

You can verify this yourself by pasting the following into the browser console while on wanderlog.com:

```js
document.cookie.split('; ').find(c => c.startsWith('connect.sid'))
```

If the result is `undefined`, `HttpOnly` is on and Option A is the way.

### 3. Configure Wanderdog with the cookie

Pick one of:

#### Local development (`.env` file)

```bash
cp .env.example .env
# Edit .env and paste the cookie value after WANDERLOG_COOKIE=
```

#### Claude Code CLI

```bash
claude mcp add wanderdog node /absolute/path/to/wanderdog/dist/index.js \
  --env WANDERLOG_COOKIE="s%3A...paste your value..."
```

#### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Add to the `mcpServers` section:

```json
{
  "mcpServers": {
    "wanderdog": {
      "command": "node",
      "args": ["/absolute/path/to/wanderdog/dist/index.js"],
      "env": {
        "WANDERLOG_COOKIE": "s%3A...paste your value..."
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### 4. Verify it's working

With `.env` configured, run the live integration tests — they hit the real Wanderlog API using your cookie and will fail loudly if it's wrong or expired:

```bash
npm run test:integration
```

You should see `[test] authenticated as <your-username> (<your-id>)` and all 24 tests passing.

Or, in your MCP client, ask: *"What trips do I have in Wanderlog?"* — it should call `wanderlog_list_trips` and return your trip list.

## Refreshing your cookie

The cookie lasts about a year, but it can die sooner if:
- You log out of wanderlog.com (invalidates all sessions)
- You change your password
- Wanderlog revokes the session server-side

When that happens, every tool call returns:
> **Wanderlog session invalid or expired** — Capture a fresh connect.sid cookie from wanderlog.com DevTools (Application → Cookies) and update WANDERLOG_COOKIE in your MCP config.

Repeat step 2 above, update your `.env` or MCP config, and restart the MCP client.

## Security notes

- The cookie is stored **only** in your `.env` file (gitignored) or your MCP client's config. It is never committed, logged, or sent anywhere except to wanderlog.com itself.
- Wanderdog runs locally on your machine. There's no server to send your credential to.
- The auth probe at startup validates the cookie without printing its value.
- If you ever suspect compromise: log out of wanderlog.com (invalidates the cookie everywhere), then re-capture.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run dev` | Run server directly from source with tsx (development) |
| `npm run test` | Unit tests only (no network, fast) |
| `npm run test:integration` | Integration tests against the live Wanderlog API (requires `.env`) |
| `npm run test:all` | Both |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run probe` | Standalone ShareDB WebSocket probe (Phase 0 diagnostic) |

## Docs

For contributors and agents picking up the project:

- [`docs/north-star.md`](docs/north-star.md) — problem statement, goals, non-goals, success criteria
- [`docs/kanban.md`](docs/kanban.md) — task status by phase, roadmap, eval prompts
- [`docs/architecture.md`](docs/architecture.md) — file layout, runtime flow, key invariants
- [`docs/api-reference.md`](docs/api-reference.md) — reverse-engineered Wanderlog REST + WebSocket + ShareDB protocol
- [`docs/gotchas.md`](docs/gotchas.md) — landmines we've hit; read before assuming things are simple

If you're an LLM agent continuing this project, start with [`CLAUDE.md`](CLAUDE.md) at the repo root — it has the persistent instructions you'll need.

## Disclaimer

Wanderdog is an unofficial third-party tool. It is not affiliated with, endorsed by, or supported by Wanderlog. It works by calling Wanderlog's private web-client API, which may change without notice. Use at your own risk, and please don't abuse Wanderlog's servers.
