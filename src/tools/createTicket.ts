import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TableApi } from '../servicenow/tableApi.js';
import { logger } from '../logger.js';

const TABLE_VALUES = [
  'incident',
  'change_request',
  'sc_request',
  'sc_req_item',
  'problem',
  'idea',
] as const;

export function registerCreateTicketTool(server: McpServer, tableApi: TableApi): void {
  server.tool(
    'create_ticket',
    'Creates a new ticket in the specified ServiceNow table.',
    {
      table: z.enum(TABLE_VALUES),
      fields: z
        .record(z.string(), z.unknown())
        .describe('Key-value pairs matching ServiceNow field names for the chosen table'),
    },
    async ({ table, fields }) => {
      try {
        logger.debug(`create_ticket called for table: ${table}`);
        const record = await tableApi.createRecord({ table, fields });
        const result = {
          success: true as const,
          ticketNumber: typeof record['number'] === 'string' ? record['number'] : '',
          sysId: record.sys_id,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('create_ticket failed', { message });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ success: false, message }, null, 2) },
          ],
        };
      }
    },
  );
}
