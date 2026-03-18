import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TICKET_TYPES } from '../resources/ticketTypes.js';
import { logger } from '../logger.js';

export function registerListTicketTypesTool(server: McpServer): void {
  server.tool(
    'list_ticket_types',
    'Returns all supported ServiceNow ticket types with labels and when-to-use descriptions.',
    {},
    async () => {
      try {
        logger.debug('list_ticket_types called');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(TICKET_TYPES, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('list_ticket_types failed', { message });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ success: false, message }, null, 2) },
          ],
        };
      }
    },
  );
}
