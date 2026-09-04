import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { buildServer } from "../../src/server.ts";

describe("custom-section MCP tool metadata", () => {
  let client: Client;
  let server: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = buildServer({} as AppContext);
    client = new Client({ name: "metadata-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("publishes lifecycle tools with explicit mutation annotations", async () => {
    const response = await client.listTools();
    const byName = new Map(response.tools.map((tool) => [tool.name, tool]));

    expect(byName.get("wanderlog_add_section")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(byName.get("wanderlog_update_section")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(byName.get("wanderlog_delete_section")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(byName.get("wanderlog_move_place")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(byName.get("wanderlog_move_place")?.inputSchema.required).toEqual(
      expect.arrayContaining(["trip_key", "place_ref"]),
    );
  });
});
