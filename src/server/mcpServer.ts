import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../auth/authManager.js';
import { createServiceNowClient } from '../servicenow/client.js';
import { TableApi } from '../servicenow/tableApi.js';
import { registerAllTools } from '../tools/index.js';
import { registerAllResources } from '../resources/index.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'servicenow-mcp', version: '0.1.0' });
  const authManager = new AuthManager();
  const axiosInstance = createServiceNowClient(authManager);
  const tableApi = new TableApi(axiosInstance);
  registerAllTools(server, tableApi);
  registerAllResources(server);
  return server;
}
