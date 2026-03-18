import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCreateTicketTool } from '../../../src/tools/createTicket.js';
import { ServiceNowError } from '../../../src/servicenow/client.js';
import type { TableApi } from '../../../src/servicenow/tableApi.js';

vi.mock('../../../src/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type TextContent = { type: string; text: string };
type ToolResult = { content: TextContent[] };
type HandlerArgs = { table: string; fields: Record<string, unknown> };
type ToolHandler = (args: HandlerArgs) => Promise<ToolResult>;

function makeTableApiMock(): TableApi {
  return {
    createRecord: vi.fn(),
    getRecord: vi.fn(),
    queryRecords: vi.fn(),
  } as unknown as TableApi;
}

function captureHandler(tableApi: TableApi): ToolHandler {
  const mockTool = vi.fn();
  const server = { tool: mockTool } as unknown as McpServer;
  registerCreateTicketTool(server, tableApi);
  return mockTool.mock.calls[0]?.[3] as ToolHandler;
}

function parseResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? '');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
describe('registerCreateTicketTool()', () => {
  it('should register a tool named "create_ticket"', () => {
    const mockTool = vi.fn();
    const server = { tool: mockTool } as unknown as McpServer;
    registerCreateTicketTool(server, makeTableApiMock());
    expect(mockTool).toHaveBeenCalledWith(
      'create_ticket',
      expect.any(String),
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// Handler — success cases
// ---------------------------------------------------------------------------
describe('create_ticket handler', () => {
  let tableApi: TableApi;

  beforeEach(() => {
    tableApi = makeTableApiMock();
    vi.clearAllMocks();
  });

  it('should call tableApi.createRecord with the correct table and fields', async () => {
    vi.mocked(tableApi.createRecord).mockResolvedValue({
      sys_id: 'abc123def456abc123def456abc123de',
      number: 'INC0001234',
    });
    const handler = captureHandler(tableApi);

    await handler({ table: 'incident', fields: { short_description: 'Test outage' } });

    expect(tableApi.createRecord).toHaveBeenCalledWith({
      table: 'incident',
      fields: { short_description: 'Test outage' },
    });
  });

  it('should return { success: true, ticketNumber, sysId } on success', async () => {
    vi.mocked(tableApi.createRecord).mockResolvedValue({
      sys_id: 'abc123def456abc123def456abc123de',
      number: 'INC0001234',
    });
    const handler = captureHandler(tableApi);

    const result = await handler({ table: 'incident', fields: {} });
    const parsed = parseResult(result) as Record<string, unknown>;

    expect(parsed['success']).toBe(true);
    expect(parsed['ticketNumber']).toBe('INC0001234');
    expect(parsed['sysId']).toBe('abc123def456abc123def456abc123de');
  });

  it('should set ticketNumber to empty string when number is absent from SN response', async () => {
    vi.mocked(tableApi.createRecord).mockResolvedValue({
      sys_id: 'abc123def456abc123def456abc123de',
      // number intentionally absent
    });
    const handler = captureHandler(tableApi);

    const result = await handler({ table: 'incident', fields: {} });
    const parsed = parseResult(result) as Record<string, unknown>;

    expect(parsed['success']).toBe(true);
    expect(parsed['ticketNumber']).toBe('');
  });

  it('should work for all supported tables', async () => {
    const tables = ['incident', 'change_request', 'sc_request', 'sc_req_item', 'problem', 'idea'];
    for (const table of tables) {
      const api = makeTableApiMock();
      vi.mocked(api.createRecord).mockResolvedValue({ sys_id: 'abc', number: 'TST001' });
      const handler = captureHandler(api);
      const result = await handler({ table, fields: {} });
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed['success']).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------
  it('should return { success: false, message } when tableApi throws ServiceNowError', async () => {
    vi.mocked(tableApi.createRecord).mockRejectedValue(
      new ServiceNowError('Forbidden', 403, 'Insufficient privileges'),
    );
    const handler = captureHandler(tableApi);

    const result = await handler({ table: 'incident', fields: {} });
    const parsed = parseResult(result) as Record<string, unknown>;

    expect(parsed['success']).toBe(false);
    expect(parsed['message']).toBe('Forbidden');
  });

  it('should return { success: false, message } on unexpected errors', async () => {
    vi.mocked(tableApi.createRecord).mockRejectedValue(new Error('Network timeout'));
    const handler = captureHandler(tableApi);

    const result = await handler({ table: 'incident', fields: {} });
    const parsed = parseResult(result) as Record<string, unknown>;

    expect(parsed['success']).toBe(false);
    expect(parsed['message']).toBe('Network timeout');
  });

  it('should never throw — error is always returned in content', async () => {
    vi.mocked(tableApi.createRecord).mockRejectedValue(new Error('Boom'));
    const handler = captureHandler(tableApi);

    await expect(handler({ table: 'incident', fields: {} })).resolves.toHaveProperty('content');
  });
});
