import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseConfig } from '../auth/config.js';
import { logger } from '../logger.js';

export async function startHttpTransport(server: McpServer): Promise<void> {
  const config = parseConfig(process.env);
  const app = express();
  app.use(express.json());

  // Inbound API key middleware for /sse
  app.use('/sse', (req, res, next) => {
    const expectedKey = config.MCP_SERVER_API_KEY;

    if (!expectedKey) {
      logger.warn(
        'MCP_SERVER_API_KEY is not set — /sse endpoint is unprotected. ' +
          'Set MCP_SERVER_API_KEY in production.',
      );
      next();
      return;
    }

    const authHeader = req.headers['authorization'];
    const xApiKey = req.headers['x-api-key'];

    const provided =
      (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined) ?? (typeof xApiKey === 'string' ? xApiKey : undefined);

    if (provided !== expectedKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  });

  // Track active transports by session ID
  const transports: Record<string, SSEServerTransport> = {};

  // SSE endpoint — establishes a new SSE stream per client connection
  app.get('/sse', async (req, res) => {
    logger.debug('GET /sse — establishing SSE stream');
    try {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      transports[sessionId] = transport;

      transport.onclose = () => {
        logger.debug(`SSE transport closed for session ${sessionId}`);
        delete transports[sessionId];
      };

      await server.connect(transport);
      logger.info(`SSE stream established, session: ${sessionId}`);
    } catch (err) {
      logger.error('Error establishing SSE stream', {
        message: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).send('Error establishing SSE stream');
      }
    }
  });

  // Messages endpoint — routes client JSON-RPC requests to the correct transport
  app.post('/messages', async (req, res) => {
    const sessionId = req.query['sessionId'];
    if (typeof sessionId !== 'string' || !sessionId) {
      res.status(400).send('Missing sessionId parameter');
      return;
    }

    const transport = transports[sessionId];
    if (!transport) {
      res.status(404).send('Session not found');
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      logger.error('Error handling POST /messages', {
        message: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).send('Error handling request');
      }
    }
  });

  const port = config.MCP_PORT;
  await new Promise<void>((resolve, reject) => {
    app.listen(port, (err?: Error) => {
      if (err) {
        reject(err);
        return;
      }
      logger.info(`MCP server running on HTTP+SSE, port ${port}`);
      resolve();
    });
  });
}
