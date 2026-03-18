# CLAUDE.md — ServiceNow MCP Server (TypeScript)

This file is the primary guidance document for Claude Code when working in this repository.
Read it in full before writing any code or making any architectural decisions.

---

## 1. Project Overview

### What This Is

A **TypeScript MCP (Model Context Protocol) server** that wraps the ServiceNow REST API
and exposes ServiceNow capabilities as structured MCP tools and resources. It targets the
**Zurich release** of ServiceNow and is built on the `@modelcontextprotocol/sdk` TypeScript SDK.

The server is the **backend transport layer** for an AI triage agent (a separate project).
That agent connects to this server to help end users identify the right ServiceNow ticket
type and fill it out correctly.

### What This Is NOT

- **Not the AI triage agent.** The agent is a separate project that consumes this server.
- **Not a full ServiceNow administration tool.** Scope is limited to ticket creation,
  retrieval, and schema introspection for the tables listed below.
- **Not a frontend or UI.** It is a headless MCP server process.

### Ticket Tables in Scope

| Table name       | Ticket type       | Number prefix | Notes                                                   |
|------------------|-------------------|---------------|---------------------------------------------------------|
| `incident`       | Incident          | INC           | Unplanned interruption to a service                     |
| `change_request` | Change Request    | CHG           | Planned modification to a system or service             |
| `sc_request`     | Service Request   | REQ           | Top-level service catalog request                       |
| `sc_req_item`    | Requested Item    | RITM          | Individual catalog items within a service request       |
| `problem`        | Problem           | PRB           | Root cause investigation for recurring incidents        |
| `idea`           | Idea              | IDEA          | **Requires Innovation Management module** — verify that this plugin is active on the target instance before using |

> **Important:** The `idea` table is part of the ServiceNow Innovation Management plugin.
> It is NOT enabled by default on all instances. Before implementing `idea` support, confirm
> the plugin is active on the target instance via: `sys_plugins` table or ask the ServiceNow admin.
> Source: https://www.servicenow.com/docs/bundle/zurich-application-development/page/administer/plugins/reference/r_IdeaManagementPlugin.html

---

## 2. Architecture

```
AI Triage Agent (separate project)
         |
         |  STDIO transport  (local dev — Claude Desktop, local agent)
         |  OR
         |  HTTP + SSE transport  (remote — production VPS, GitHub Codespaces)
         v
┌─────────────────────────────────┐
│     ServiceNow MCP Server       │  (this project)
│                                 │
│  src/server/     Transport layer│
│  src/tools/      MCP tools      │
│  src/resources/  MCP resources  │
│  src/auth/       Auth handlers  │
│  src/servicenow/ REST client    │
└────────────────┬────────────────┘
                 │  HTTPS REST + JSON
                 v
    ServiceNow Instance (Zurich)
    https://<instance>.service-now.com/api/now/...
```

### Transport Mode Decision

The server selects its transport at startup based on the `MCP_TRANSPORT` environment variable:

| Value   | Transport         | Use case                                              |
|---------|-------------------|-------------------------------------------------------|
| `stdio` | STDIO (default)   | Local dev, Claude Desktop, local MCP clients          |
| `http`  | HTTP + SSE        | Production Docker deployment, GitHub Codespaces       |

When `MCP_TRANSPORT` is unset, `stdio` is used.

### Module Responsibilities

| Path                            | Responsibility                                                    |
|---------------------------------|-------------------------------------------------------------------|
| `src/server/index.ts`           | Entry point. Reads env, picks transport, starts server.           |
| `src/server/mcpServer.ts`       | Transport-agnostic MCP Server class. Registers all tools/resources.|
| `src/server/stdioTransport.ts`  | Wraps MCP SDK STDIO transport.                                    |
| `src/server/httpTransport.ts`   | Express + MCP SDK SSE adapter for HTTP mode.                      |
| `src/tools/index.ts`            | Barrel: registers all tools on the MCP server instance.           |
| `src/tools/createTicket.ts`     | Tool: `create_ticket`                                             |
| `src/tools/getTicket.ts`        | Tool: `get_ticket`                                                |
| `src/tools/listTicketTypes.ts`  | Tool: `list_ticket_types`                                         |
| `src/tools/getTicketSchema.ts`  | Tool: `get_ticket_schema`                                         |
| `src/resources/index.ts`        | Barrel: registers all resources on the MCP server instance.       |
| `src/resources/ticketTypes.ts`  | Resource: `servicenow://ticket-types`                             |
| `src/servicenow/client.ts`      | Axios instance factory. ALL ServiceNow HTTP calls go through here.|
| `src/servicenow/tableApi.ts`    | Higher-level CRUD wrappers over the raw client.                   |
| `src/servicenow/types.ts`       | TypeScript types for ServiceNow API request/response shapes.      |
| `src/auth/authManager.ts`       | Auth type selector. Returns correct headers per request.          |
| `src/auth/oauthHandler.ts`      | OAuth 2.0 token fetch, storage, and refresh.                      |
| `src/auth/config.ts`            | Zod schemas for all config and auth env var validation.           |
| `src/logger.ts`                 | Thin console wrapper respecting `LOG_LEVEL` env var.              |

---

## 3. Technology Stack

| Package                         | Version     | Purpose / Why chosen                                                        |
|---------------------------------|-------------|-----------------------------------------------------------------------------|
| `typescript`                    | `^5.4`      | Language. Strict mode required throughout.                                  |
| `@modelcontextprotocol/sdk`     | `^1.x`      | Official MCP server SDK. Source of truth: https://github.com/modelcontextprotocol/typescript-sdk |
| `zod`                           | `^3.23`     | Required peer dep for MCP SDK. Used for ALL config, tool input, and API response validation. |
| `axios`                         | `^1.7`      | HTTP client for ServiceNow REST API. Single instance in `client.ts`.        |
| `express`                       | `^4.19`     | HTTP server for SSE transport mode.                                         |
| `dotenv`                        | `^16.4`     | `.env` file loading in development.                                         |
| `vitest`                        | `^1.6`      | Test runner. Native ESM + TypeScript support without Babel transforms.      |
| `@vitest/coverage-v8`           | `^1.6`      | Coverage reporting.                                                         |
| `eslint`                        | `^9.x`      | Linting.                                                                    |
| `@typescript-eslint/parser`     | `^7.x`      | TypeScript ESLint parser.                                                   |
| `prettier`                      | `^3.x`      | Code formatting.                                                            |
| `tsx`                           | `^4.x`      | Direct TypeScript execution for dev (`tsx watch`). No build step in dev.    |

**Why Vitest over Jest:** The MCP SDK is ESM-first. Vitest handles native TypeScript/ESM
without a Babel transform layer, which eliminates a common class of Jest + TypeScript
configuration failures.

Pin all dependencies to minor version ranges (`^major.minor`). Never use `latest` or `*`.

---

## 4. Project Structure

```
my-serviceNow-mcp/
├── src/
│   ├── server/
│   │   ├── index.ts                # Entry point: reads env, picks transport, starts server
│   │   ├── mcpServer.ts            # Transport-agnostic MCP Server class
│   │   ├── stdioTransport.ts       # STDIO transport wrapper
│   │   └── httpTransport.ts        # Express + SSE transport
│   ├── tools/
│   │   ├── index.ts                # Barrel: registers all tools on the server
│   │   ├── createTicket.ts         # Tool: create_ticket
│   │   ├── getTicket.ts            # Tool: get_ticket
│   │   ├── listTicketTypes.ts      # Tool: list_ticket_types
│   │   └── getTicketSchema.ts      # Tool: get_ticket_schema
│   ├── resources/
│   │   ├── index.ts                # Barrel: registers all resources on the server
│   │   ├── ticketTypes.ts          # Resource: servicenow://ticket-types
│   │   └── schemas/                # Static JSON field schemas per table (curated for Zurich)
│   │       ├── incident.json
│   │       ├── change_request.json
│   │       ├── sc_request.json
│   │       ├── sc_req_item.json
│   │       ├── problem.json
│   │       └── idea.json
│   ├── servicenow/
│   │   ├── client.ts               # Axios instance factory with auth injection
│   │   ├── tableApi.ts             # CRUD wrappers: createRecord, getRecord, queryRecords
│   │   └── types.ts                # TypeScript types for ServiceNow API shapes
│   ├── auth/
│   │   ├── authManager.ts          # Selects auth strategy, returns headers
│   │   ├── oauthHandler.ts         # OAuth 2.0: token fetch, storage, refresh
│   │   └── config.ts               # Zod schemas: ServerConfig, AuthConfig, OAuthConfig
│   └── logger.ts                   # Thin console wrapper respecting LOG_LEVEL
├── tests/
│   ├── unit/
│   │   ├── auth/
│   │   │   ├── authManager.test.ts
│   │   │   └── oauthHandler.test.ts
│   │   ├── tools/
│   │   │   ├── createTicket.test.ts
│   │   │   ├── getTicket.test.ts
│   │   │   ├── listTicketTypes.test.ts
│   │   │   └── getTicketSchema.test.ts
│   │   └── servicenow/
│   │       ├── client.test.ts
│   │       └── tableApi.test.ts
│   └── integration/
│       └── servicenow/
│           └── tableApi.integration.test.ts
├── .devcontainer/
│   ├── devcontainer.json           # GitHub Codespaces configuration
│   └── postCreate.sh               # npm install + env setup
├── docker/
│   ├── Dockerfile                  # Production multi-stage image
│   └── docker-compose.yml          # MCP container (VPS path-proxy mode)
├── nginx/
│   ├── nginx-snippet.conf          # Location block to paste into existing VPS Nginx
│   └── nginx-standalone.conf       # Full Nginx config for port-8443 standalone mode
├── .env.example                    # Template for all env vars (no secrets)
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── tsconfig.json
├── vitest.config.ts
├── package.json
└── CLAUDE.md                       # This file
```

---

## 5. Development Environments

### 5.1 Local Development (Windows / Mac / Linux)

**Prerequisites:** Node.js >= 20 LTS, npm >= 10.

```bash
# Install dependencies
npm install

# Copy env template and fill in your values
cp .env.example .env
# Edit .env — set SERVICENOW_INSTANCE_URL, AUTH_TYPE, and credentials

# Run in STDIO mode (default — connects via Claude Desktop or local agent)
npm run dev

# Run in HTTP+SSE mode locally (for browser or remote client testing)
npm run dev:http
```

`npm run dev` uses `tsx watch src/server/index.ts` for hot reload. No build step needed
in development.

To test STDIO mode manually, pipe JSON-RPC messages via stdin or use an MCP client such
as Claude Desktop with the server registered in its config.

### 5.2 GitHub Codespaces

The `.devcontainer/devcontainer.json` configures:
- **Base image:** `mcr.microsoft.com/devcontainers/javascript-node:0-20-bullseye`
- **Port forward:** `8080` (auto-forwarded, labeled `MCP Server SSE`)
- **postCreateCommand:** `npm install`
- **Default env vars in container:** `MCP_TRANSPORT=http`, `MCP_PORT=8080`

To start in Codespaces:
```bash
cp .env.example .env
# Populate .env — use Codespaces repository secrets for sensitive values
npm run dev:http
```

The SSE endpoint is available at the Codespaces forwarded HTTPS URL, path `/sse`.

### 5.3 Docker (Production)

See Section 12 (Deployment) for full Docker instructions.

Quick start:
```bash
cp .env.example .env
# Edit .env with production credentials
docker compose -f docker/docker-compose.yml up -d --build
```

---

## 6. ServiceNow Integration

### API Base URL

All ServiceNow REST calls use the Table API:
```
https://<instance>.service-now.com/api/now/table/<table_name>
```

`SERVICENOW_INSTANCE_URL` must be the full base URL **without a trailing slash**, e.g.:
```
SERVICENOW_INSTANCE_URL=https://dev12345.service-now.com
```

The client builds: `${SERVICENOW_INSTANCE_URL}/api/now/table/<table>`

Reference: https://www.servicenow.com/docs/bundle/zurich-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html

### Zurich Release Notes

- OAuth 2.0 token endpoint: `<instance_url>/oauth_token.do`
- API key header (introduced in Washington DC, available in Zurich): `x-sn-apikey`
- Use `sysparm_fields` to project only needed fields and limit response size.
- Use `sysparm_display_value=true` to get human-readable values for reference fields.
- Use `sysparm_exclude_reference_link=true` to remove `$ref` links from responses.
- Use `sysparm_limit` and `sysparm_offset` for pagination on list queries.

Reference: https://www.servicenow.com/docs/bundle/zurich-api-reference/page/integrate/inbound-rest/concept/c_RESTAPI.html

### Table Reference

| Table            | Key fields to populate                                                   |
|------------------|--------------------------------------------------------------------------|
| `incident`       | `short_description`, `impact`, `urgency`, `caller_id`, `category`        |
| `change_request` | `short_description`, `type`, `risk`, `category`, `assignment_group`      |
| `sc_request`     | `short_description`, `requested_for`                                     |
| `sc_req_item`    | `short_description`, `request`, `cat_item`, `quantity`                   |
| `problem`        | `short_description`, `known_error`, `root_cause`                         |
| `idea`           | `short_description`, `description`, `product` (**module must be active**)|

### ServiceNow API Error Shape

ServiceNow returns errors in this structure:
```json
{
  "error": { "message": "...", "detail": "..." },
  "status": "failure"
}
```

`src/servicenow/client.ts` must:
1. Intercept all HTTP 4xx/5xx via an axios response interceptor.
2. Extract `error.message` and `error.detail` when present in the body.
3. Throw a typed `ServiceNowError` class (extends `Error`) with `statusCode`, `message`, `detail`.
4. Never let raw axios errors propagate to tool handlers.

---

## 7. MCP Server Design

### Tools

All tools are registered in `src/tools/index.ts`. Tool names use `snake_case`.

#### `create_ticket`

Creates a new ticket in the specified ServiceNow table.

```typescript
// Input schema
z.object({
  table: z.enum(['incident', 'change_request', 'sc_request', 'sc_req_item', 'problem', 'idea']),
  fields: z.record(z.string(), z.unknown())
    .describe('Key-value pairs matching ServiceNow field names for the chosen table')
})

// Success response
{ success: true, ticketNumber: string, sysId: string }

// Error response
{ success: false, message: string }
```

#### `get_ticket`

Retrieves a single ticket by `sys_id` or ticket number (e.g., `INC0001234`).

```typescript
// Input schema
z.object({
  table: z.enum(['incident', 'change_request', 'sc_request', 'sc_req_item', 'problem', 'idea']),
  identifier: z.string()
    .describe('sys_id (32-char hex) or ticket number (e.g. INC0001234)')
})

// Response: flat key-value record; reference fields use display values
```

#### `list_ticket_types`

Returns all supported ticket types with human-readable labels and when-to-use descriptions.
No input required (`z.object({})`).

```typescript
// Response
[
  { "table": "incident", "label": "Incident", "numberPrefix": "INC", "description": "..." },
  ...
]
```

#### `get_ticket_schema`

Returns field definitions for a given table so the triage agent can guide field completion.
Served from static JSON files in `src/resources/schemas/` — **no live ServiceNow call**.

```typescript
// Input schema
z.object({
  table: z.enum(['incident', 'change_request', 'sc_request', 'sc_req_item', 'problem', 'idea'])
})

// Response — array of field objects
[
  {
    "name": "short_description",
    "label": "Short Description",
    "type": "string",
    "required": true,
    "maxLength": 255
  }
]
```

Static schemas are curated for the Zurich release. If a field definition needs updating,
edit the corresponding JSON file in `src/resources/schemas/`.

### Resources

Resources are accessible via MCP `resources/read` using a URI scheme.

#### `servicenow://ticket-types`

Returns the full ticket type catalog (same data as `list_ticket_types` tool but accessible
as a static resource). Does not require a live ServiceNow connection.

MIME type: `application/json`

### Prompts

No MCP prompts are exposed in v1. The triage agent constructs its own prompts. If prompts
are added later, create `src/prompts/` and register in a `src/prompts/index.ts` barrel.

### Tool Response Format

All tools return responses as JSON strings inside `TextContent`. Tool handlers must
**never throw** — all exceptions must be caught at the tool boundary and returned as
`{ success: false, message: string }`.

```typescript
// Success
{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }

// Error (caught exception)
{ content: [{ type: 'text', text: JSON.stringify({ success: false, message: err.message }) }] }
```

---

## 8. Authentication

### Outbound Auth (This Server → ServiceNow)

The `AUTH_TYPE` env var controls which strategy is used:

| `AUTH_TYPE`  | Strategy           | When to use                                |
|--------------|--------------------|--------------------------------------------|
| `oauth`      | OAuth 2.0          | **Production default.** Most secure.       |
| `basic`      | HTTP Basic Auth    | Local dev / quick testing only.            |
| `api_key`    | API Key header     | When an admin has issued a ServiceNow API key. |

`AuthManager` in `src/auth/authManager.ts` exposes a single `getHeaders(): Promise<Record<string, string>>`
method. **No other module constructs auth headers directly.**

#### OAuth 2.0 Flow

ServiceNow OAuth 2.0 token endpoint (Zurich):
```
POST <SERVICENOW_INSTANCE_URL>/oauth_token.do
Authorization: Basic base64(<CLIENT_ID>:<CLIENT_SECRET>)
Content-Type: application/x-www-form-urlencoded
```

Grant type priority in `OAuthHandler`:
1. **`client_credentials`** — uses `SERVICENOW_CLIENT_ID` + `SERVICENOW_CLIENT_SECRET`
2. **`password`** (fallback) — uses above + `SERVICENOW_USERNAME` + `SERVICENOW_PASSWORD`

Token management:
- Token and expiry stored in memory (not persisted to disk).
- `getHeaders()` calls `refreshToken()` automatically when token is within 60 seconds of expiry.
- On startup with `AUTH_TYPE=oauth`, attempt a token fetch and fail fast if it fails.

Reference: https://www.servicenow.com/docs/bundle/zurich-application-development/page/integrate/inbound-rest/concept/c_OAuthRESTIntegration.html

### Inbound Auth (MCP Client → This Server, HTTP Mode Only)

When `MCP_TRANSPORT=http`, an Express middleware validates an inbound API key before
routing to the MCP SSE handler.

- Key is set via `MCP_SERVER_API_KEY` env var.
- If `MCP_SERVER_API_KEY` is unset, the server **logs a loud warning** and the `/sse`
  endpoint is unprotected. Only acceptable in a trusted dev environment.
- Key detection order:
  1. `Authorization: Bearer <key>` header
  2. `x-api-key: <key>` header
- Returns `401 { "error": "Unauthorized" }` on key mismatch.

STDIO mode has no inbound auth (OS process isolation provides the security boundary).

---

## 9. Environment Variables

Copy `.env.example` to `.env` for local development. **Never commit `.env` to git.**

### Required — All Modes

| Variable                  | Description                                                      |
|---------------------------|------------------------------------------------------------------|
| `SERVICENOW_INSTANCE_URL` | Full base URL, e.g. `https://dev12345.service-now.com`          |
| `AUTH_TYPE`               | `oauth` \| `basic` \| `api_key`                                 |

### Basic Auth (`AUTH_TYPE=basic`)

| Variable                | Description          |
|-------------------------|----------------------|
| `SERVICENOW_USERNAME`   | ServiceNow username  |
| `SERVICENOW_PASSWORD`   | ServiceNow password  |

### API Key Auth (`AUTH_TYPE=api_key`)

| Variable              | Description                                                       |
|-----------------------|-------------------------------------------------------------------|
| `SERVICENOW_API_KEY`  | API key value — sent to ServiceNow in `x-sn-apikey` header       |

### OAuth 2.0 (`AUTH_TYPE=oauth`)

| Variable                    | Description                                                          |
|-----------------------------|----------------------------------------------------------------------|
| `SERVICENOW_CLIENT_ID`      | OAuth application Client ID from ServiceNow                          |
| `SERVICENOW_CLIENT_SECRET`  | OAuth application Client Secret from ServiceNow                      |
| `SERVICENOW_USERNAME`       | Username for password grant fallback                                 |
| `SERVICENOW_PASSWORD`       | Password for password grant fallback                                 |
| `SERVICENOW_TOKEN_URL`      | Override token URL (default: `<SERVICENOW_INSTANCE_URL>/oauth_token.do`) |

### Transport / Server

| Variable              | Default  | Description                                                    |
|-----------------------|----------|----------------------------------------------------------------|
| `MCP_TRANSPORT`       | `stdio`  | `stdio` \| `http`                                             |
| `MCP_PORT`            | `8080`   | HTTP listen port (only used when `MCP_TRANSPORT=http`)         |
| `MCP_SERVER_API_KEY`  | —        | Inbound API key for HTTP mode. Unset = unprotected (dev only). |

### Optional

| Variable              | Default  | Description                                    |
|-----------------------|----------|------------------------------------------------|
| `SERVICENOW_TIMEOUT`  | `30000`  | HTTP request timeout in milliseconds           |
| `LOG_LEVEL`           | `info`   | `debug` \| `info` \| `warn` \| `error`        |
| `NODE_ENV`            | —        | Set to `production` in Docker containers       |

Config is validated with Zod at startup (`src/auth/config.ts`). If validation fails,
the server logs the Zod error and exits with code 1.

---

## 10. Testing Strategy

### Philosophy: Test-Driven Development (TDD)

**Write tests before implementation.** The cycle for every new feature or tool:

1. Write a failing test that specifies expected behavior.
2. Write the minimum implementation to make the test pass.
3. Refactor. The tests are the safety net.

Never merge code without test coverage for new behavior.
Rule of thumb: **if it touches ServiceNow or parses user input, it has a test.**

### Test Structure

```
tests/
├── unit/
│   ├── auth/
│   │   ├── authManager.test.ts       # Header generation for each auth type
│   │   └── oauthHandler.test.ts      # Token fetch, refresh, expiry logic
│   ├── tools/
│   │   ├── createTicket.test.ts      # Input validation, response shaping, error paths
│   │   ├── getTicket.test.ts
│   │   ├── listTicketTypes.test.ts
│   │   └── getTicketSchema.test.ts
│   └── servicenow/
│       ├── client.test.ts            # Axios mock, error normalization, timeout
│       └── tableApi.test.ts          # CRUD wrappers with mocked client
└── integration/
    └── servicenow/
        └── tableApi.integration.test.ts  # Real ServiceNow dev instance
```

### Unit Test Conventions

- Use `vi.mock('axios')` at module level. **No real HTTP calls in unit tests.**
- Use `vi.stubEnv()` to inject env vars. Call `vi.unstubAllEnvs()` in `afterEach`.
- Each test file is fully self-contained. No shared mutable state between tests.
- Name pattern: `describe('ClassName or functionName') > it('should <behavior> when <condition>')`
- Integration tests are `.integration.test.ts` and are always skipped unless
  `INTEGRATION_TESTS=true` is set.

### Running Tests

```bash
npm test                        # All unit tests (single run)
npm run test:watch              # Watch mode (TDD loop)
npm run test:coverage           # Unit tests + coverage report

# Integration tests (requires real ServiceNow .env)
INTEGRATION_TESTS=true npm run test:integration

# Single file
npx vitest run tests/unit/auth/authManager.test.ts
```

### Coverage Targets (enforced in `vitest.config.ts`)

| Metric      | Threshold |
|-------------|-----------|
| Statements  | 80%       |
| Branches    | 75%       |
| Functions   | 80%       |

---

## 11. Key Commands

```bash
npm install               # Install all dependencies
npm run dev               # Dev server, STDIO mode, hot reload (tsx watch)
npm run dev:http          # Dev server, HTTP+SSE mode, hot reload
npm run build             # Compile TypeScript → dist/
npm start                 # Run compiled dist/ (production)
npm test                  # Unit tests (single run)
npm run test:watch        # Unit tests in watch mode
npm run test:coverage     # Unit tests + coverage report
npm run test:integration  # Integration tests (set INTEGRATION_TESTS=true first)
npm run lint              # ESLint
npm run lint:fix          # ESLint with auto-fix
npm run format            # Prettier format
npm run typecheck         # tsc --noEmit (type check only)
```

### Target `package.json` scripts

```json
{
  "scripts": {
    "dev":               "tsx watch src/server/index.ts",
    "dev:http":          "MCP_TRANSPORT=http tsx watch src/server/index.ts",
    "build":             "tsc --project tsconfig.json",
    "start":             "node dist/server/index.js",
    "test":              "vitest run tests/unit",
    "test:watch":        "vitest tests/unit",
    "test:coverage":     "vitest run --coverage tests/unit",
    "test:integration":  "vitest run tests/integration",
    "lint":              "eslint src tests",
    "lint:fix":          "eslint src tests --fix",
    "format":            "prettier --write src tests",
    "typecheck":         "tsc --noEmit"
  }
}
```

---

## 12. Deployment

### Docker Image (`docker/Dockerfile`)

Multi-stage build targeting Node.js 20 LTS on Alpine for minimal image size.

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
RUN addgroup -S mcpgroup && adduser -S mcpuser -G mcpgroup
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER mcpuser
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
```

### VPS Deployment — Ports 80/443 Already in Use

Since ports 80/443 are occupied on your Hostinger VPS, two deployment options are documented.
Choose one based on your existing Nginx setup.

---

#### Option A: Path-Based Proxy from Existing Nginx (Recommended)

Add a `location` block to your existing Nginx server block that forwards a path prefix
to the MCP container running internally on port 8080.

**`nginx/nginx-snippet.conf`** — paste into your existing server block:

```nginx
# ServiceNow MCP Server — add inside your existing HTTPS server block
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

**`docker/docker-compose.yml`** — MCP container only, no Nginx (existing Nginx handles TLS):

```yaml
version: "3.9"
services:
  mcp:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    image: sn-mcp:latest
    restart: unless-stopped
    env_file: ../.env
    ports:
      - "127.0.0.1:8080:8080"   # Bind to loopback only — existing Nginx proxies to this
    environment:
      - MCP_TRANSPORT=http
      - MCP_PORT=8080
```

The SSE endpoint will be available at: `https://<your-domain>/sn-mcp/sse`

**Deploy steps:**
```bash
git clone <repo-url> && cd my-serviceNow-mcp
cp .env.example .env && nano .env

# Start the MCP container
docker compose -f docker/docker-compose.yml up -d --build

# Add the snippet from nginx/nginx-snippet.conf to your existing Nginx config
nano /etc/nginx/sites-available/your-site.conf
# (paste the location block inside your HTTPS server block)
nginx -t && systemctl reload nginx

# Verify SSE endpoint
curl -v https://<your-domain>/sn-mcp/sse \
  -H "Authorization: Bearer <MCP_SERVER_API_KEY>"
# Expect: 200 OK, Content-Type: text/event-stream
```

---

#### Option B: Standalone on Port 8443 (Alternative)

Run the MCP server with its own Nginx on port 8443 without touching the existing Nginx.

**`nginx/nginx-standalone.conf`** — full standalone Nginx config:

```nginx
server {
    listen 8443 ssl;
    server_name _;

    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    location /sse {
        proxy_pass         http://mcp:8080/sse;
        proxy_http_version 1.1;
        proxy_buffering            off;
        proxy_cache                off;
        proxy_read_timeout         3600s;
        proxy_set_header           Connection '';
        chunked_transfer_encoding  on;
    }

    location / {
        proxy_pass http://mcp:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

**Deploy steps for Option B:**
```bash
# Generate self-signed cert (once per server)
mkdir -p nginx/certs
openssl req -x509 -nodes -newkey rsa:4096 \
  -keyout nginx/certs/server.key \
  -out nginx/certs/server.crt \
  -days 365 \
  -subj "/CN=sn-mcp-server"

# Build and start
docker compose -f docker/docker-compose-standalone.yml up -d --build

# Verify
curl -k -v https://<VPS_IP>:8443/sse \
  -H "Authorization: Bearer <MCP_SERVER_API_KEY>"
```

> Note: Port 8443 must be open in your Hostinger VPS firewall. Check via the Hostinger
> control panel → Firewall, or `ufw allow 8443`.

---

### Container Maintenance

```bash
docker compose logs -f mcp           # Live logs
docker compose up -d --build         # Redeploy after git pull
docker compose down                  # Stop all services
docker image prune -f                # Clean up old images after redeploy
```

---

## 13. Important Conventions

### TypeScript Configuration

`tsconfig.json` must enable all strict settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`module: "Node16"` and `moduleResolution: "Node16"` are required for correct ESM/CJS
interop with the MCP SDK.

### Zod at All Boundaries

Every external trust boundary must be validated with Zod:
- All env vars at startup (`src/auth/config.ts`)
- All MCP tool inputs (input schema of each tool definition)
- ServiceNow API responses for any fields the server acts on

Never use `as SomeType` casting on data that crossed a trust boundary.
Always call `schema.parse()` (throws on failure) or `schema.safeParse()` (returns error).

### Error Handling Rules

1. **Tool handlers never throw.** Catch all exceptions and return `{ success: false, message: string }`.
2. **ServiceNow API errors** are caught in `src/servicenow/client.ts` and rethrown as
   `ServiceNowError` with `statusCode`, `message`, `detail`.
3. **Auth errors** are caught in `src/auth/authManager.ts` and rethrown as `AuthError`.
4. **Validation errors** (Zod) must include the field path and failure reason in the message.
5. All errors must be logged at `error` level before being returned or re-thrown.
6. **Startup config validation failure** → log Zod error + `process.exit(1)`.

### Naming Conventions

| Element                  | Convention                | Example                                             |
|--------------------------|---------------------------|-----------------------------------------------------|
| Files                    | camelCase                 | `authManager.ts`                                    |
| Classes                  | PascalCase                | `AuthManager`                                       |
| Interfaces               | PascalCase (no `I` prefix)| `TicketRecord`                                      |
| Zod schemas              | PascalCase + `Schema`     | `CreateTicketInputSchema`                           |
| Inferred Zod types       | PascalCase                | `type CreateTicketInput = z.infer<typeof ...Schema>`|
| MCP tool names           | snake_case                | `create_ticket`                                     |
| MCP resource URIs        | `servicenow://` scheme    | `servicenow://ticket-types`                         |
| Environment variables    | SCREAMING_SNAKE_CASE      | `SERVICENOW_INSTANCE_URL`                           |
| Unit test files          | `<module>.test.ts`        | `authManager.test.ts`                               |
| Integration test files   | `<module>.integration.test.ts` | `tableApi.integration.test.ts`                 |

### Code Organization Rules

- **One class per file**, named to match the file.
- **Barrel `index.ts` files** only in `src/tools/` and `src/resources/` for registration.
  Do not create generic barrels that re-export everything — they harm tree-shaking.
- **All ServiceNow HTTP calls** go through `src/servicenow/client.ts`. No other file
  imports `axios` directly.
- **All auth header construction** goes through `src/auth/authManager.ts`. No other
  file builds auth headers directly.

### Logging

Use `src/logger.ts` (a thin wrapper respecting `LOG_LEVEL`):
- `logger.error()` — exceptions and failures
- `logger.warn()` — degraded state, missing optional config
- `logger.info()` — server startup, transport selection, connection events
- `logger.debug()` — request/response tracing (suppressed when `LOG_LEVEL` is not `debug`)

**Never log:**
- Full OAuth tokens or API keys. Log first 8 chars + `...` if traceability is needed.
- Passwords or client secrets.
- Full HTTP response bodies that may contain PII.

### Git Hygiene

- `.env` is gitignored. Never commit it.
- `nginx/certs/` is gitignored. Never commit SSL certificates.
- `dist/` is gitignored. Never commit compiled output.
- `node_modules/` is gitignored.
- Commit message format (conventional commits):
  `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`

---

## 14. Reference Links

### ServiceNow (Zurich Release)
- REST API Overview: https://www.servicenow.com/docs/bundle/zurich-api-reference/page/integrate/inbound-rest/concept/c_RESTAPI.html
- Table API Reference: https://www.servicenow.com/docs/bundle/zurich-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html
- OAuth 2.0 Integration: https://www.servicenow.com/docs/bundle/zurich-application-development/page/integrate/inbound-rest/concept/c_OAuthRESTIntegration.html
- Innovation Management (Idea table): https://www.servicenow.com/docs/bundle/zurich-application-development/page/administer/plugins/reference/r_IdeaManagementPlugin.html

### MCP
- TypeScript SDK (GitHub): https://github.com/modelcontextprotocol/typescript-sdk
- Protocol Specification: https://modelcontextprotocol.io/specification/2025-11-25
- SDK API Reference: https://ts.sdk.modelcontextprotocol.io/
- NPM Package: https://www.npmjs.com/package/@modelcontextprotocol/sdk

### Dependencies
- Zod documentation: https://zod.dev
- Vitest documentation: https://vitest.dev
- Axios documentation: https://axios-http.com/docs/intro

### Infrastructure
- Docker Node.js Guide: https://docs.docker.com/guides/nodejs/containerize/
- GitHub Codespaces Node.js Setup: https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/setting-up-your-nodejs-project-for-codespaces
- Nginx SSE Proxying: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering
