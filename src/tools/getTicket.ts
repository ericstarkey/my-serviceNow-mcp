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

function isSysId(identifier: string): boolean {
  return /^[0-9a-f]{32}$/i.test(identifier);
}

export function registerGetTicketTool(server: McpServer, tableApi: TableApi): void {
  server.tool(
    'get_ticket',
    'Retrieves a single ServiceNow ticket by sys_id (32-char hex) or ticket number (e.g. INC0001234).',
    {
      table: z.enum(TABLE_VALUES),
      identifier: z
        .string()
        .describe('sys_id (32-char hex) or ticket number (e.g. INC0001234)'),
    },
    async ({ table, identifier }) => {
      try {
        logger.debug(`get_ticket called for table: ${table}, identifier: ${identifier}`);

        if (isSysId(identifier)) {
          const record = await tableApi.getRecord({ table, sysId: identifier });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(record, null, 2) }],
          };
        }

        const records = await tableApi.queryRecords({
          table,
          query: `number=${identifier}`,
          limit: 1,
        });

        const record = records.at(0);
        if (record === undefined) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { success: false, message: `No ticket found with number ${identifier}` },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(record, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('get_ticket failed', { message });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ success: false, message }, null, 2) },
          ],
        };
      }
    },
  );
}
