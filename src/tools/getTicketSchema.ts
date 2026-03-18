import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../logger.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Load static schemas via require — avoids import-attribute syntax complexity
// with module: Node16 + ESM. Types are unknown[] since resolveJsonModule only
// applies to static import declarations, not createRequire calls.
const SCHEMA_MAP: Record<string, unknown[]> = {
  incident: require('../resources/schemas/incident.json') as unknown[],
  change_request: require('../resources/schemas/change_request.json') as unknown[],
  sc_request: require('../resources/schemas/sc_request.json') as unknown[],
  sc_req_item: require('../resources/schemas/sc_req_item.json') as unknown[],
  problem: require('../resources/schemas/problem.json') as unknown[],
  idea: require('../resources/schemas/idea.json') as unknown[],
};

const TABLE_VALUES = [
  'incident',
  'change_request',
  'sc_request',
  'sc_req_item',
  'problem',
  'idea',
] as const;

export function registerGetTicketSchemaTool(server: McpServer): void {
  server.tool(
    'get_ticket_schema',
    'Returns field definitions for a given table to guide ticket completion. Served from static data — no ServiceNow call required.',
    { table: z.enum(TABLE_VALUES) },
    async ({ table }) => {
      try {
        logger.debug(`get_ticket_schema called for table: ${table}`);
        const schema = SCHEMA_MAP[table];
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(schema, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('get_ticket_schema failed', { message });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ success: false, message }, null, 2) },
          ],
        };
      }
    },
  );
}
