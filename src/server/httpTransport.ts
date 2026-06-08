import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseConfig } from '../auth/config.js';
import { logger } from '../logger.js';

export async function startHttpTransport(serverFactory: () => McpServer): Promise<void> {
  const config = parseConfig(process.env);
  const app = express();
  app.use(express.json());

  // Reusable inbound API key middleware (shared by /sse and /mcp)
  const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const expectedKey = config.MCP_SERVER_API_KEY;

    if (!expectedKey) {
      logger.warn(
        'MCP_SERVER_API_KEY is not set — MCP endpoints are unprotected. ' +
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
  };

  app.use('/sse', authMiddleware);
  app.use('/mcp', authMiddleware);

  // Health check endpoint — used by ACA liveness/readiness probes
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Track active transports by session ID (legacy SSE transport)
  const sseServer = serverFactory();
  const transports: Record<string, SSEServerTransport> = {};

  // SSE endpoint — establishes a new SSE stream per client connection (legacy transport)
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

      await sseServer.connect(transport);
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

  // Streamable HTTP endpoint — session-managed (modern MCP clients, e.g. Azure AI Foundry).
  //
  // Modern clients drive the session across THREE HTTP methods on the same path:
  //   POST   /mcp  — initialize, then send JSON-RPC requests/notifications
  //   GET    /mcp  — open the server→client SSE stream for the established session
  //   DELETE /mcp  — terminate the session
  // All three must be routed to the transport. Registering only POST makes Express
  // return 404 for GET/DELETE, which clients surface as a connection failure.
  const streamableTransports: Record<string, StreamableHTTPServerTransport> = {};

  const handleMcpRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      const sid = typeof sessionId === 'string' ? sessionId : undefined;

      let transport: StreamableHTTPServerTransport;

      if (sid && streamableTransports[sid]) {
        // Existing session — reuse its transport.
        transport = streamableTransports[sid];
      } else if (!sid && req.method === 'POST' && isInitializeRequest(req.body)) {
        // New session — create a transport and bind it to a fresh server instance.
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newId: string) => {
            streamableTransports[newId] = transport;
            logger.info(`Streamable HTTP session initialized: ${newId}`);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            logger.debug(`Streamable HTTP session closed: ${transport.sessionId}`);
            delete streamableTransports[transport.sessionId];
          }
        };

        const requestServer = serverFactory();
        // Cast needed: SDK's StreamableHTTPServerTransport has onclose? optional,
        // but Transport interface declares it required — exactOptionalPropertyTypes mismatch
        await requestServer.connect(transport as Parameters<typeof requestServer.connect>[0]);
      } else {
        // GET/DELETE without a known session, or POST that is not an initialize request.
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error(`Error handling ${req.method} /mcp`, {
        message: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).send('Error handling request');
      }
    }
  };

  app.post('/mcp', (req, res) => {
    logger.debug('POST /mcp — Streamable HTTP request');
    void handleMcpRequest(req, res);
  });
  app.get('/mcp', (req, res) => {
    logger.debug('GET /mcp — Streamable HTTP SSE stream');
    void handleMcpRequest(req, res);
  });
  app.delete('/mcp', (req, res) => {
    logger.debug('DELETE /mcp — Streamable HTTP session teardown');
    void handleMcpRequest(req, res);
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
