# llms-install.md

Wanderdog is a **local stdio MCP server** distributed as an npm package.

## Install method

Use `npx wanderlog-mcp` and set the `WANDERLOG_COOKIE` environment variable.

## Required environment variable

- `WANDERLOG_COOKIE` — your Wanderlog `connect.sid` cookie value from your logged-in browser session

This cookie is sensitive and should be treated like a password.

## Setup summary

1. Log in to https://wanderlog.com in your browser.
2. Open browser DevTools.
3. Find the `connect.sid` cookie for `https://wanderlog.com`.
4. Copy its full value.
5. Configure the MCP client to launch `npx wanderlog-mcp` with `WANDERLOG_COOKIE` set to that value.

## Example configuration patterns

### Claude Code

```bash
claude mcp add wanderlog-mcp npx wanderlog-mcp \
  --env WANDERLOG_COOKIE="s%3A...your value here..."
```

### Claude Desktop

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

### Cursor

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

## Notes for installation agents

- The server speaks stdio MCP and is meant to be launched by an MCP client.
- Do **not** expect useful terminal output when running it directly in a shell.
- If tool calls fail with an auth error, the cookie is expired or incorrect. Capture a fresh `connect.sid` value and update the MCP config.
- Prefer the main `README.md` for full setup, supported clients, troubleshooting, and examples.
