import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListTicketTypesTool } from '../../../src/tools/listTicketTypes.js';

vi.mock('../../../src/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type TextContent = { type: string; text: string };
type ToolResult = { content: TextContent[] };
type ToolHandler = () => Promise<ToolResult>;

function captureHandler(): ToolHandler {
  const mockTool = vi.fn();
  const server = { tool: mockTool } as unknown as McpServer;
  registerListTicketTypesTool(server);
  return mockTool.mock.calls[0]?.[3] as ToolHandler;
}

function parseResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? '');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
describe('registerListTicketTypesTool()', () => {
  it('should register a tool named "list_ticket_types"', () => {
    const mockTool = vi.fn();
    const server = { tool: mockTool } as unknown as McpServer;
    registerListTicketTypesTool(server);
    expect(mockTool).toHaveBeenCalledWith(
      'list_ticket_types',
      expect.any(String),
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// Handler behaviour
// ---------------------------------------------------------------------------
describe('list_ticket_types handler', () => {
  it('should return a content array with exactly one text item', async () => {
    const result = await captureHandler()();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
  });

  it('should return valid JSON in the text field', async () => {
    const result = await captureHandler()();
    expect(() => parseResult(result)).not.toThrow();
  });

  it('should return exactly 6 ticket types', async () => {
    const result = await captureHandler()();
    expect(parseResult(result)).toHaveLength(6);
  });

  it('each entry should have table, label, numberPrefix, description', async () => {
    const result = await captureHandler()();
    const parsed = parseResult(result) as Array<Record<string, unknown>>;
    for (const entry of parsed) {
      expect(entry).toHaveProperty('table');
      expect(entry).toHaveProperty('label');
      expect(entry).toHaveProperty('numberPrefix');
      expect(entry).toHaveProperty('description');
    }
  });

  it('should include all 6 supported table names', async () => {
    const result = await captureHandler()();
    const tables = (parseResult(result) as Array<{ table: string }>).map((t) => t.table);
    expect(tables).toContain('incident');
    expect(tables).toContain('change_request');
    expect(tables).toContain('sc_request');
    expect(tables).toContain('sc_req_item');
    expect(tables).toContain('problem');
    expect(tables).toContain('idea');
  });

  it('should include the INC number prefix for incident', async () => {
    const result = await captureHandler()();
    const parsed = parseResult(result) as Array<{ table: string; numberPrefix: string }>;
    const incident = parsed.find((t) => t.table === 'incident');
    expect(incident?.numberPrefix).toBe('INC');
  });

  it('should never throw — always returns a result object', async () => {
    const handler = captureHandler();
    await expect(handler()).resolves.toHaveProperty('content');
  });
});
