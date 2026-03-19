import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const RUN = process.env['INTEGRATION_TESTS_HTTP'] === 'true';
const BASE_URL = process.env['MCP_HTTP_BASE_URL'] ?? 'http://localhost:8080';
const API_KEY = process.env['MCP_SERVER_API_KEY'];

describe.skipIf(!RUN)('HTTP+SSE transport integration', () => {
  let client: Client;

  beforeAll(async () => {
    const headers: Record<string, string> = {};
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

    const transport = new SSEClientTransport(new URL(`${BASE_URL}/sse`), {
      requestInit: { headers },
    });

    client = new Client(
      { name: 'integration-test-client', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  // --- Static tool tests (no ServiceNow call required) ---

  it('list_ticket_types returns all 6 ticket types', async () => {
    const result = await client.callTool({ name: 'list_ticket_types', arguments: {} });
    const types = JSON.parse((result.content[0] as { text: string }).text);
    expect(Array.isArray(types)).toBe(true);
    expect(types).toHaveLength(6);
    const tables = types.map((t: { table: string }) => t.table);
    expect(tables).toContain('incident');
    expect(tables).toContain('change_request');
  });

  it('get_ticket_schema returns field definitions for incident', async () => {
    const result = await client.callTool({
      name: 'get_ticket_schema',
      arguments: { table: 'incident' },
    });
    const fields = JSON.parse((result.content[0] as { text: string }).text);
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
    const shortDesc = fields.find((f: { name: string }) => f.name === 'short_description');
    expect(shortDesc).toBeDefined();
    expect(shortDesc.required).toBe(true);
  });

  it('get_ticket_schema returns field definitions for all supported tables', async () => {
    const tables = ['incident', 'change_request', 'sc_request', 'sc_req_item', 'problem', 'idea'];
    for (const table of tables) {
      const result = await client.callTool({
        name: 'get_ticket_schema',
        arguments: { table },
      });
      const fields = JSON.parse((result.content[0] as { text: string }).text);
      expect(Array.isArray(fields), `${table} schema should be an array`).toBe(true);
      expect(fields.length, `${table} schema should have fields`).toBeGreaterThan(0);
    }
  });

  // --- Error handling test (no ServiceNow call required) ---

  it('get_ticket returns structured error for invalid identifier', async () => {
    const result = await client.callTool({
      name: 'get_ticket',
      arguments: { table: 'incident', identifier: 'INVALID-ID-THAT-DOES-NOT-EXIST' },
    });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    // Tool must return a structured object, never throw through the transport layer
    expect(result.content[0]).toBeDefined();
    expect(typeof body).toBe('object');
  });
});
