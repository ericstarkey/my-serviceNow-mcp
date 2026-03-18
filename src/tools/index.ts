import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TableApi } from '../servicenow/tableApi.js';
import { registerCreateTicketTool } from './createTicket.js';
import { registerGetTicketTool } from './getTicket.js';
import { registerListTicketTypesTool } from './listTicketTypes.js';
import { registerGetTicketSchemaTool } from './getTicketSchema.js';

export function registerAllTools(server: McpServer, tableApi: TableApi): void {
  registerCreateTicketTool(server, tableApi);
  registerGetTicketTool(server, tableApi);
  registerListTicketTypesTool(server);
  registerGetTicketSchemaTool(server);
}
