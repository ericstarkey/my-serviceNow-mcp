import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTicketTypesResource } from './ticketTypes.js';

export function registerAllResources(server: McpServer): void {
  registerTicketTypesResource(server);
}
