# ServiceNow MCP Server

A TypeScript [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that wraps the ServiceNow REST API and exposes ticket management as structured MCP tools and resources. Targets the **Zurich release** of ServiceNow.

Built to serve as the backend transport layer for an AI triage agent that helps users identify the right ServiceNow ticket type and fill it out correctly.

---

## Tools

| Tool | Description |
|------|-------------|
| `create_ticket` | Creates a new ticket in a specified ServiceNow table |
| `get_ticket` | Retrieves a ticket by `sys_id` or ticket number (e.g. `INC0001234`) |
| `list_ticket_types` | Returns all supported ticket types with labels and descriptions |
| `get_ticket_schema` | Returns field definitions for a given table (no live ServiceNow call) |

## Resources

| URI | Description |
|-----|-------------|
| `servicenow://ticket-types` | Static JSON catalog of all supported ticket types |

## Supported Ticket Tables

| Table | Label | Number Prefix | Notes |
|-------|-------|---------------|-------|
| `incident` | Incident | `INC` | Unplanned service interruptions |
| `change_request` | Change Request | `CHG` | Planned system modifications |
| `sc_request` | Service Request | `REQ` | Top-level catalog requests |
| `sc_req_item` | Requested Item | `RITM` | Individual items within a service request |
| `problem` | Problem | `PRB` | Root cause investigations |
| `idea` | Idea | `IDEA` | Requires Innovation Management plugin |

---

## Requirements

- Node.js >= 20 LTS
- npm >= 10
- A ServiceNow instance (Zurich release) with API key access

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — fill in SERVICENOW_INSTANCE_URL and SERVICENOW_API_KEY

# 3. Run in STDIO mode (Claude Desktop / local MCP clients)
npm run dev

# 4. Run in HTTP+SSE mode (remote clients, Codespaces, Docker)
npm run dev:http
```

---

## Configuration

Copy `.env.example` to `.env` and populate the values. **Never commit `.env` to git.**

### Required

| Variable | Description |
|----------|-------------|
| `SERVICENOW_INSTANCE_URL` | Full base URL, no trailing slash. e.g. `https://dev12345.service-now.com` |
| `AUTH_TYPE` | Must be `api_key` |
| `SERVICENOW_API_KEY` | Your ServiceNow API key (sent via `x-sn-apikey` header) |

### Transport

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | `stdio` for local clients, `http` for remote/Docker |
| `MCP_PORT` | `8080` | HTTP listen port (HTTP mode only) |
| `MCP_SERVER_API_KEY` | — | Inbound API key protecting `/sse`. Unset = unprotected (dev only) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVICENOW_TIMEOUT` | `30000` | HTTP request timeout in milliseconds |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `NODE_ENV` | — | Set to `production` in Docker |

Config is validated with Zod at startup. If any required value is missing or invalid, the server logs the error and exits with code 1.

---

## Transport Modes

### STDIO (default)

Used with Claude Desktop and local MCP clients. No network port is opened — the OS process boundary provides the security boundary.

```bash
npm run dev
```

To register with Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["/absolute/path/to/my-serviceNow-mcp/dist/server/index.js"],
      "env": {
        "SERVICENOW_INSTANCE_URL": "https://dev12345.service-now.com",
        "AUTH_TYPE": "api_key",
        "SERVICENOW_API_KEY": "your-key-here"
      }
    }
  }
}
```

### HTTP + SSE

Exposes two endpoints for remote MCP clients:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sse` | `GET` | Establishes an SSE stream. Protected by `MCP_SERVER_API_KEY` if set. |
| `/messages` | `POST` | Receives JSON-RPC messages from clients. |

Inbound auth accepts the key in either:
- `Authorization: Bearer <key>` header
- `x-api-key: <key>` header

```bash
npm run dev:http

# Verify the SSE endpoint
curl -v http://localhost:8080/sse \
  -H "Authorization: Bearer your-mcp-key"
```

---

## Deploying to a VPS (Docker + Nginx)

> **Prerequisites:** The VPS has Docker and Docker Compose installed, and Nginx is already running on ports 80/443 with TLS. The container binds to `127.0.0.1:8080` only — your existing Nginx proxies to it.

### Step 1 — SSH in and clone the repository

```bash
ssh user@your-vps-ip
git clone <your-repo-url> my-serviceNow-mcp
cd my-serviceNow-mcp
```

### Step 2 — Configure the environment

```bash
cp .env.example .env
nano .env
```

Set these values in `.env`:

| Variable | Value |
|----------|-------|
| `SERVICENOW_INSTANCE_URL` | `https://dev12345.service-now.com` |
| `AUTH_TYPE` | `api_key` |
| `SERVICENOW_API_KEY` | Your ServiceNow API key |
| `MCP_TRANSPORT` | `http` |
| `MCP_PORT` | `8080` |
| `MCP_SERVER_API_KEY` | A strong random string — this protects the `/sse` endpoint |
| `LOG_LEVEL` | `info` |
| `NODE_ENV` | `production` |

> **Never commit `.env` to git.** It contains secrets.

To generate a random key for `MCP_SERVER_API_KEY`:
```bash
openssl rand -hex 32
```

### Step 3 — Build and start the container

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Verify it started:

```bash
# Check the container is running
docker compose -f docker/docker-compose.yml ps

# Check the startup logs
docker compose -f docker/docker-compose.yml logs mcp
```

The container runs on `127.0.0.1:8080` and is not reachable from the internet until Nginx is configured in the next step.

### Step 4 — Add the Nginx proxy block

Find your existing Nginx server block for your domain. Common locations:

```
/etc/nginx/sites-available/<your-site>.conf
/etc/nginx/conf.d/<your-site>.conf
/etc/nginx/nginx.conf
```

Open the file and paste the contents of `nginx/nginx-snippet.conf` **inside the `server { }` block that handles HTTPS (port 443)**:

```nginx
location /sn-mcp/ {
    proxy_pass         http://127.0.0.1:8080/;
    proxy_http_version 1.1;

    # Required for SSE (Server-Sent Events)
    proxy_buffering            off;
    proxy_cache                off;
    proxy_read_timeout         3600s;
    proxy_set_header           Connection '';
    chunked_transfer_encoding  on;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Test and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Step 5 — Verify the deployment

```bash
curl -v https://<your-domain>/sn-mcp/sse \
  -H "Authorization: Bearer <your-MCP_SERVER_API_KEY>"
```

Expected response:
- HTTP status: `200 OK`
- `Content-Type: text/event-stream`
- The connection stays open (SSE stream)

### Redeploying after a code update

```bash
git pull
docker compose -f docker/docker-compose.yml up -d --build
docker image prune -f   # remove old image layers
```

### Container logs and maintenance

```bash
docker compose -f docker/docker-compose.yml logs -f mcp   # live logs
docker compose -f docker/docker-compose.yml ps             # check status
docker compose -f docker/docker-compose.yml down           # stop
```

---

## Development Commands

```bash
npm run dev              # STDIO mode, hot reload
npm run dev:http         # HTTP+SSE mode, hot reload
npm run build            # Compile TypeScript → dist/
npm start                # Run compiled dist/ (production)
npm test                 # Unit tests (single run)
npm run test:watch       # Unit tests in watch mode (TDD)
npm run test:coverage    # Unit tests + coverage report
npm run test:integration # Integration tests (requires live ServiceNow instance)
npm run lint             # ESLint
npm run lint:fix         # ESLint with auto-fix
npm run format           # Prettier
npm run typecheck        # Type check only (no emit)
```

### Integration tests

Integration tests make real calls to a live ServiceNow dev instance and are skipped by default.

```bash
# Requires .env with valid SERVICENOW_INSTANCE_URL and SERVICENOW_API_KEY
INTEGRATION_TESTS=true npm run test:integration
```

All integration test records use the `[MCP Integration Test]` prefix in `short_description` for easy cleanup.

### Coverage thresholds

| Metric | Threshold |
|--------|-----------|
| Statements | 80% |
| Branches | 75% |
| Functions | 80% |

---

## Project Structure

```
src/
├── server/
│   ├── index.ts          # Entry point: reads env, picks transport, starts server
│   ├── mcpServer.ts      # Composition root: wires auth → client → tableApi → tools
│   ├── stdioTransport.ts # STDIO transport wrapper
│   └── httpTransport.ts  # Express + SSE transport with inbound auth
├── tools/
│   ├── index.ts          # Registers all tools on the server
│   ├── createTicket.ts   # Tool: create_ticket
│   ├── getTicket.ts      # Tool: get_ticket
│   ├── listTicketTypes.ts# Tool: list_ticket_types
│   └── getTicketSchema.ts# Tool: get_ticket_schema
├── resources/
│   ├── index.ts          # Registers all resources on the server
│   ├── ticketTypes.ts    # Resource: servicenow://ticket-types
│   └── schemas/          # Static field definitions per table (Zurich-curated JSON)
├── servicenow/
│   ├── client.ts         # Axios instance factory; all ServiceNow HTTP calls go here
│   ├── tableApi.ts       # CRUD wrappers: createRecord, getRecord, queryRecords
│   └── types.ts          # TypeScript types for ServiceNow API shapes
├── auth/
│   ├── authManager.ts    # Returns x-sn-apikey header; sole source of auth headers
│   └── config.ts         # Zod validation for all environment variables
└── logger.ts             # Thin console wrapper respecting LOG_LEVEL
```

---

## GitHub Codespaces

The `.devcontainer/devcontainer.json` configures:
- **Base image:** Node.js 20 on Debian Bullseye
- **Port forward:** `8080` (labeled `MCP Server SSE`)
- **Default env:** `MCP_TRANSPORT=http`, `MCP_PORT=8080`

```bash
cp .env.example .env
# Populate .env (use Codespaces repository secrets for sensitive values)
npm run dev:http
```

The SSE endpoint is available at the forwarded HTTPS URL on path `/sse`.

---

## Notes

- The `idea` table requires the **Innovation Management plugin** to be active on the ServiceNow instance. Verify via the `sys_plugins` table or ask your ServiceNow admin before using it.
- All ServiceNow API calls use `sysparm_display_value=true` and `sysparm_exclude_reference_link=true` — reference fields return human-readable display values, not raw sys_ids.
- Tool handlers never throw. All exceptions are caught at the tool boundary and returned as `{ "success": false, "message": "..." }`.
