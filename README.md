# wanderlog-mcp

An MCP server that lets Claude (or any MCP-compatible agent) view and build [Wanderlog](https://wanderlog.com) trip itineraries through conversation.

Instead of clicking through the Wanderlog UI to plan a trip, you just ask:

> *"Create a 14-day Japan Golden Route trip — Tokyo, Hakone, Kyoto, Nara, and Osaka."*

The agent calls the tools, interleaves places and notes for each day, adds hotel blocks and checklists, and you end up with a fully populated Wanderlog trip in a few minutes.

**See a real example:** [14-day Japan Golden Route](https://wanderlog.com/plan/dmvegdhqsa) — built entirely by an AI agent using this MCP server.

## Tools

| Tool | What it does |
|---|---|
| `wanderlog_list_trips` | List trips in your account |
| `wanderlog_get_trip` | View a full itinerary, or filter to a single day |
| `wanderlog_get_trip_url` | Get a shareable wanderlog.com link |
| `wanderlog_search_places` | Find real-world places near a trip's destination |
| `wanderlog_create_trip` | Create a new trip with destination + date range |
| `wanderlog_add_place` | Add a place to a specific day or general list |
| `wanderlog_add_note` | Add a note (transit tips, booking info, local advice) |
| `wanderlog_add_hotel` | Add a hotel booking with check-in/check-out dates |
| `wanderlog_add_checklist` | Add a pre-trip or per-day checklist |
| `wanderlog_remove_place` | Remove a place by natural-language reference |
| `wanderlog_update_trip_dates` | Change a trip's date range |

## Prerequisites

- **Node.js 22 or newer**
- **A [Wanderlog](https://wanderlog.com) account**
- An MCP-compatible client: **Claude Code**, **Claude Desktop**, **OpenAI Codex**, or any stdio MCP host

## Setup

### Step 1 — Get your Wanderlog session cookie

Wanderlog doesn't have a public API, so wanderlog-mcp authenticates using your browser session cookie (`connect.sid`). It's valid for roughly a year and never leaves your machine.

**Treat it like a password** — it grants the same access you have in the Wanderlog UI.

#### Chrome / Edge

1. Go to [wanderlog.com](https://wanderlog.com) and log in
2. Press `F12` to open DevTools
3. Click the **Application** tab
4. In the left sidebar expand **Storage → Cookies → https://wanderlog.com**
5. Find the row where **Name** is `connect.sid`
6. Click the row, then double-click the **Value** cell and copy the full string — it starts with `s%3A` and is ~100 characters long

#### Firefox

1. Go to [wanderlog.com](https://wanderlog.com) and log in
2. Press `F12` to open DevTools
3. Click the **Storage** tab
4. In the left sidebar expand **Cookies → https://wanderlog.com**
5. Find `connect.sid` in the table, click it, and copy the **Value**

> **Why can't I use `document.cookie` in the console?**
> Wanderlog sets `connect.sid` with the `HttpOnly` flag, which deliberately blocks JavaScript from reading it (XSS protection). DevTools bypasses this restriction — that's why it works and the console doesn't.

### Step 2 — Configure your MCP client

#### Claude Code

```bash
claude mcp add wanderlog-mcp npx wanderlog-mcp \
  --env WANDERLOG_COOKIE="s%3A...your value here..."
```

#### OpenAI Codex

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.wanderlog]
command = "npx"
args = ["wanderlog-mcp"]

[mcp_servers.wanderlog.env]
WANDERLOG_COOKIE = "s%3A...your value here..."
```

Run `/mcp` inside Codex to confirm the server loaded.

#### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wanderlog": {
      "command": "npx",
      "args": ["wanderlog-mcp"],
      "env": {
        "WANDERLOG_COOKIE": "s%3A...your value here..."
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Step 3 — Verify

Ask your agent: *"What trips do I have in Wanderlog?"*

It should call `wanderlog_list_trips` and return your account's trips. If it fails, see [Troubleshooting](#troubleshooting) below.

## Refreshing your cookie

The cookie lasts about a year but can die sooner if you log out of wanderlog.com, change your password, or Wanderlog revokes the session. When that happens every tool call returns:

> **Wanderlog session invalid or expired** — Capture a fresh connect.sid cookie from wanderlog.com DevTools and update WANDERLOG_COOKIE in your MCP config.

Repeat Step 1 above, update your config, and restart your MCP client.

## Troubleshooting

**Server starts but list_trips returns an auth error**
Your cookie is expired or wrong. Re-capture it from DevTools and update your config.

**`npx wanderlog-mcp` hangs or does nothing**
The server speaks stdio MCP — it's designed to be launched by an MCP host, not run directly in a terminal. Run it through Claude Code or Claude Desktop as described above.

**Tools work but the agent ignores notes/checklists**
The server injects instructions into the MCP `initialize` response that tell the agent to interleave places and notes and add checklists. This works reliably with Claude. Other clients may vary.

## Security

- The cookie is stored only in your MCP client config, never committed or logged
- wanderlog-mcp runs entirely on your machine — there's no relay server
- The startup auth probe validates your cookie without printing its value
- To revoke access: log out of wanderlog.com (invalidates all sessions), then re-capture

## Disclaimer

wanderlog-mcp is an unofficial third-party tool, not affiliated with or endorsed by Wanderlog. It works by calling Wanderlog's private web-client API, which may change without notice. Use at your own risk.

## License

MIT — see [LICENSE](LICENSE)

---

Made by [shaikhspeare](https://github.com/shaikhspeare)
