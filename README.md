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

Exposes these endpoints:

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | `GET` | None | Liveness probe — returns `{"status":"ok"}`. Used by ACA health checks. |
| `/sse` | `GET` | Bearer / x-api-key | Establishes an SSE stream. Protected by `MCP_SERVER_API_KEY` if set. |
| `/messages` | `POST` | None (session-bound) | Receives JSON-RPC messages from clients. |

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

## Deploying to Azure Container Apps (Primary)

The server is deployed to two Azure Container Apps in South Central US via an automated GitHub Actions pipeline.

| Environment | Container App | URL |
|-------------|---------------|-----|
| Test | `ca-snmcp-test` | Auto-deployed on every `main` push |
| Production | `ca-snmcp-prod` | Deployed after manual approval |

**Pipeline flow:** push to `main` → tests → build image → deploy to test → smoke test → approve → deploy to prod

All secrets are managed in Azure Key Vault. No secrets are stored in Docker images or GitHub Secrets.

```bash
# One-time provisioning (creates all Azure resources)
bash scripts/provision-azure.sh
```

For the full setup guide including OIDC credential setup, Key Vault secrets population, and GitHub environment configuration, see [docs/azure-deployment.md](docs/azure-deployment.md).

For the infrastructure diagram, see [docs/architecture.md](docs/architecture.md).

---

## Local Docker Testing

Use `docker/docker-compose.local.yml` to run the container locally for testing and troubleshooting. This config exposes port 8080 directly to the host.

```bash
# Build and start
docker compose -f docker/docker-compose.local.yml up -d --build

# Watch startup logs
docker compose -f docker/docker-compose.local.yml logs -f mcp

# Verify endpoints
curl http://localhost:8080/health
# Expected: {"status":"ok"}

curl -v http://localhost:8080/sse \
  -H "Authorization: Bearer <your-MCP_SERVER_API_KEY>"
# Expected: HTTP 200, Content-Type: text/event-stream

# Run HTTP integration tests against the container
npm run test:integration:http

# Tear down
docker compose -f docker/docker-compose.local.yml down
```

`LOG_LEVEL` is set to `debug` in this config for verbose output during troubleshooting.

---

## Secondary Environment — Hostinger VPS

The VPS is available for special-case testing outside Azure. It is not part of the automated pipeline.

```bash
# On the VPS — pull a specific image from ACR and start
az acr login --name crsnmcp001
docker pull crsnmcp001.azurecr.io/servicenow-mcp:<sha>
docker compose -f docker/docker-compose.yml up -d
```

Add `nginx/nginx-snippet.conf` to your existing Nginx `server {}` block, then `nginx -t && systemctl reload nginx`.

SSE endpoint: `https://<your-domain>/sn-mcp/sse`

---

## Development Commands

```bash
npm run dev                  # STDIO mode, hot reload
npm run dev:http             # HTTP+SSE mode, hot reload
npm run build                # Compile TypeScript → dist/
npm start                    # Run compiled dist/ (production)
npm test                     # Unit tests (single run)
npm run test:watch           # Unit tests in watch mode (TDD)
npm run test:coverage        # Unit tests + coverage report
npm run test:integration     # Integration tests (requires live ServiceNow instance)
npm run test:integration:http# HTTP+SSE container integration tests (requires running container)
npm run lint                 # ESLint
npm run lint:fix             # ESLint with auto-fix
npm run format               # Prettier
npm run typecheck            # Type check only (no emit)
```

### Unit test coverage

```bash
npm run test:coverage
```

| Metric | Threshold |
|--------|-----------|
| Statements | 80% |
| Branches | 75% |
| Functions | 80% |

### ServiceNow integration tests

Makes real calls to a live ServiceNow dev instance. Skipped by default.

```bash
# Requires .env with valid SERVICENOW_INSTANCE_URL and SERVICENOW_API_KEY
npm run test:integration
```

All integration test records use the `[MCP Integration Test]` prefix in `short_description` for easy cleanup.

### HTTP+SSE container integration tests

Connects to a running MCP server container as a real MCP client via `SSEClientTransport` and exercises tools through the full HTTP transport stack. No live ServiceNow connection is required — the static tools (`list_ticket_types`, `get_ticket_schema`) are sufficient to validate container health.

```bash
# 1. Start the container (see Local Docker Testing section)
docker compose -f docker/docker-compose.local.yml up -d

# 2. Run the tests
npm run test:integration:http
```

To test against a remote deployment (e.g. the VPS), override the base URL:

```bash
MCP_HTTP_BASE_URL=https://<your-domain>/sn-mcp npm run test:integration:http
```

The test suite covers:
- `list_ticket_types` — SSE connection, auth middleware, and JSON-RPC round-trip
- `get_ticket_schema` for all 6 tables — confirms static JSON schemas are present in `dist/`
- `get_ticket` with an invalid identifier — validates structured error handling end-to-end

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

---

## CI/CD Pipeline Status

✅ **Azure Container Apps deployment fully operational**
- Test ACA: Auto-deploys on every push to `main`
- Production ACA: Deploys after manual approval
- Full pipeline: Test → Build → Deploy Test → Smoke Test → (Approval) → Deploy Prod

See [docs/azure-deployment.md](docs/azure-deployment.md) for complete setup and operations documentation.
