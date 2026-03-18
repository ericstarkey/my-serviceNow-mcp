import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetTicketSchemaTool } from '../../../src/tools/getTicketSchema.js';

vi.mock('../../../src/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type TextContent = { type: string; text: string };
type ToolResult = { content: TextContent[] };
type ToolHandler = (args: { table: string }) => Promise<ToolResult>;

function captureHandler(): ToolHandler {
  const mockTool = vi.fn();
  const server = { tool: mockTool } as unknown as McpServer;
  registerGetTicketSchemaTool(server);
  return mockTool.mock.calls[0]?.[3] as ToolHandler;
}

function parseResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? '');
}

const ALL_TABLES = [
  'incident',
  'change_request',
  'sc_request',
  'sc_req_item',
  'problem',
  'idea',
] as const;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
describe('registerGetTicketSchemaTool()', () => {
  it('should register a tool named "get_ticket_schema"', () => {
    const mockTool = vi.fn();
    const server = { tool: mockTool } as unknown as McpServer;
    registerGetTicketSchemaTool(server);
    expect(mockTool).toHaveBeenCalledWith(
      'get_ticket_schema',
      expect.any(String),
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// Handler behaviour — valid tables
// ---------------------------------------------------------------------------
describe('get_ticket_schema handler', () => {
  it('should return a non-empty array of fields for "incident"', async () => {
    const handler = captureHandler();
    const result = await handler({ table: 'incident' });
    const fields = parseResult(result) as unknown[];
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
  });

  it.each(ALL_TABLES)('should return fields for table "%s"', async (table) => {
    const handler = captureHandler();
    const result = await handler({ table });
    const fields = parseResult(result) as unknown[];
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
  });

  it('each field should have name, label, type, and required', async () => {
    const handler = captureHandler();
    const result = await handler({ table: 'incident' });
    const fields = parseResult(result) as Array<Record<string, unknown>>;
    for (const field of fields) {
      expect(field).toHaveProperty('name');
      expect(field).toHaveProperty('label');
      expect(field).toHaveProperty('type');
      expect(field).toHaveProperty('required');
    }
  });

  it('should include "short_description" in every table schema', async () => {
    const handler = captureHandler();
    for (const table of ALL_TABLES) {
      const result = await handler({ table });
      const fields = parseResult(result) as Array<{ name: string }>;
      const names = fields.map((f) => f.name);
      expect(names).toContain('short_description');
    }
  });

  it('should mark short_description as required in incident', async () => {
    const handler = captureHandler();
    const result = await handler({ table: 'incident' });
    const fields = parseResult(result) as Array<{ name: string; required: boolean }>;
    const sd = fields.find((f) => f.name === 'short_description');
    expect(sd?.required).toBe(true);
  });

  it('should never throw — always returns a result object', async () => {
    const handler = captureHandler();
    await expect(handler({ table: 'incident' })).resolves.toHaveProperty('content');
  });
});
