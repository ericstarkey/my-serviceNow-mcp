import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetTicketTool } from '../../../src/tools/getTicket.js';
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
type HandlerArgs = { table: string; identifier: string };
type ToolHandler = (args: HandlerArgs) => Promise<ToolResult>;

const SYS_ID = 'a1b2c3d4e5f60000111122223333abcd'; // 32-char hex

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
  registerGetTicketTool(server, tableApi);
  return mockTool.mock.calls[0]?.[3] as ToolHandler;
}

function parseResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? '');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
describe('registerGetTicketTool()', () => {
  it('should register a tool named "get_ticket"', () => {
    const mockTool = vi.fn();
    const server = { tool: mockTool } as unknown as McpServer;
    registerGetTicketTool(server, makeTableApiMock());
    expect(mockTool).toHaveBeenCalledWith(
      'get_ticket',
      expect.any(String),
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// Handler — identifier routing
// ---------------------------------------------------------------------------
describe('get_ticket handler', () => {
  let tableApi: TableApi;

  beforeEach(() => {
    tableApi = makeTableApiMock();
    vi.clearAllMocks();
  });

  describe('sys_id detection', () => {
    it('should call getRecord when identifier is a 32-char hex string', async () => {
      vi.mocked(tableApi.getRecord).mockResolvedValue({ sys_id: SYS_ID, number: 'INC001' });
      const handler = captureHandler(tableApi);

      await handler({ table: 'incident', identifier: SYS_ID });

      expect(tableApi.getRecord).toHaveBeenCalledWith({ table: 'incident', sysId: SYS_ID });
      expect(tableApi.queryRecords).not.toHaveBeenCalled();
    });

    it('should call queryRecords when identifier is a ticket number', async () => {
      vi.mocked(tableApi.queryRecords).mockResolvedValue([{ sys_id: SYS_ID, number: 'INC0001234' }]);
      const handler = captureHandler(tableApi);

      await handler({ table: 'incident', identifier: 'INC0001234' });

      expect(tableApi.queryRecords).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'number=INC0001234', limit: 1 }),
      );
      expect(tableApi.getRecord).not.toHaveBeenCalled();
    });

    it.each([
      ['INC0001234', 'incident'],
      ['CHG0001234', 'change_request'],
      ['REQ0001234', 'sc_request'],
      ['RITM0001234', 'sc_req_item'],
      ['PRB0001234', 'problem'],
      ['IDEA0001234', 'idea'],
    ])('should use queryRecords for ticket number "%s"', async (identifier, table) => {
      vi.mocked(tableApi.queryRecords).mockResolvedValue([{ sys_id: SYS_ID, number: identifier }]);
      const handler = captureHandler(tableApi);

      await handler({ table, identifier });

      expect(tableApi.queryRecords).toHaveBeenCalled();
      expect(tableApi.getRecord).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Success cases
  // -------------------------------------------------------------------------
  describe('success paths', () => {
    it('should return the record as JSON text on getRecord success', async () => {
      const record = { sys_id: SYS_ID, number: 'INC001', short_description: 'Test' };
      vi.mocked(tableApi.getRecord).mockResolvedValue(record);
      const handler = captureHandler(tableApi);

      const result = await handler({ table: 'incident', identifier: SYS_ID });

      expect(parseResult(result)).toEqual(record);
    });

    it('should return the record as JSON text on queryRecords success', async () => {
      const record = { sys_id: SYS_ID, number: 'INC0001234' };
      vi.mocked(tableApi.queryRecords).mockResolvedValue([record]);
      const handler = captureHandler(tableApi);

      const result = await handler({ table: 'incident', identifier: 'INC0001234' });

      expect(parseResult(result)).toEqual(record);
    });
  });

  // -------------------------------------------------------------------------
  // Not-found / error cases
  // -------------------------------------------------------------------------
  describe('error paths', () => {
    it('should return { success: false } when queryRecords returns empty array', async () => {
      vi.mocked(tableApi.queryRecords).mockResolvedValue([]);
      const handler = captureHandler(tableApi);

      const result = await handler({ table: 'incident', identifier: 'INC9999999' });
      const parsed = parseResult(result) as Record<string, unknown>;

      expect(parsed['success']).toBe(false);
      expect(String(parsed['message'])).toContain('INC9999999');
    });

    it('should return { success: false } when getRecord throws ServiceNowError 404', async () => {
      vi.mocked(tableApi.getRecord).mockRejectedValue(
        new ServiceNowError('Record not found', 404, ''),
      );
      const handler = captureHandler(tableApi);

      const result = await handler({ table: 'incident', identifier: SYS_ID });
      const parsed = parseResult(result) as Record<string, unknown>;

      expect(parsed['success']).toBe(false);
    });

    it('should return { success: false } when queryRecords throws', async () => {
      vi.mocked(tableApi.queryRecords).mockRejectedValue(new Error('Network error'));
      const handler = captureHandler(tableApi);

      const result = await handler({ table: 'incident', identifier: 'INC0001' });
      const parsed = parseResult(result) as Record<string, unknown>;

      expect(parsed['success']).toBe(false);
      expect(parsed['message']).toBe('Network error');
    });

    it('should never throw — error is always returned in content', async () => {
      vi.mocked(tableApi.getRecord).mockRejectedValue(new Error('Boom'));
      const handler = captureHandler(tableApi);

      await expect(handler({ table: 'incident', identifier: SYS_ID })).resolves.toHaveProperty(
        'content',
      );
    });
  });
});
