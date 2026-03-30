import 'dotenv/config';
import { parseConfig } from '../auth/config.js';
import { logger } from '../logger.js';
import { createMcpServer } from './mcpServer.js';
import { startStdioTransport } from './stdioTransport.js';
import { startHttpTransport } from './httpTransport.js';

async function main(): Promise<void> {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (err) {
    logger.error('Configuration validation failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  if (config.MCP_TRANSPORT === 'http') {
    await startHttpTransport(createMcpServer);
  } else {
    await startStdioTransport(createMcpServer());
  }
}

main().catch((err) => {
  logger.error('Fatal error during startup', {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
