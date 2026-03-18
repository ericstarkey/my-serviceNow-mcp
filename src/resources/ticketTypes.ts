import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface TicketType {
  table: string;
  label: string;
  numberPrefix: string;
  description: string;
}

export const TICKET_TYPES: TicketType[] = [
  {
    table: 'incident',
    label: 'Incident',
    numberPrefix: 'INC',
    description: 'Unplanned interruption to a service or reduction in service quality.',
  },
  {
    table: 'change_request',
    label: 'Change Request',
    numberPrefix: 'CHG',
    description: 'Planned modification to a system, service, or infrastructure component.',
  },
  {
    table: 'sc_request',
    label: 'Service Request',
    numberPrefix: 'REQ',
    description: 'Top-level service catalog request submitted by a user.',
  },
  {
    table: 'sc_req_item',
    label: 'Requested Item',
    numberPrefix: 'RITM',
    description: 'Individual catalog item within a service request.',
  },
  {
    table: 'problem',
    label: 'Problem',
    numberPrefix: 'PRB',
    description: 'Root cause investigation for one or more recurring incidents.',
  },
  {
    table: 'idea',
    label: 'Idea',
    numberPrefix: 'IDEA',
    description:
      'Idea submission via Innovation Management module. Requires the Innovation Management plugin to be active on the ServiceNow instance.',
  },
];

export function registerTicketTypesResource(server: McpServer): void {
  server.resource(
    'ticket-types',
    'servicenow://ticket-types',
    { mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(TICKET_TYPES, null, 2),
        },
      ],
    }),
  );
}
