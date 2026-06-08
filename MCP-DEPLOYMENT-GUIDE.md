# MCP Server — Azure Container Apps Deployment Guide

A reusable, end-to-end guide for deploying a TypeScript MCP server to Azure Container
Apps with a GitHub Actions CI/CD pipeline. Replace every `{PLACEHOLDER}` with your
project's values before running any commands.

| Placeholder | Description | Example |
|---|---|---|
| `{WORKLOAD}` | Short workload identifier (no spaces) | `snmcp` |
| `{REGION}` | Azure region short code | `scus` (South Central US) |
| `{REGION_FULL}` | Full Azure region name | `southcentralus` |
| `{REGISTRY}` | ACR name (alphanumeric, globally unique) | `crsnmcp001` |
| `{IMAGE}` | Docker image repo name | `servicenow-mcp` |
| `{OWNER}` | GitHub account or org name | `ericstarkey` |
| `{REPO}` | GitHub repository name | `my-serviceNow-mcp` |
| `{REVIEWER}` | GitHub username for prod approval gate | `ericstarkey` |
| `{ENTRY_POINT}` | Compiled JS entry point relative to dist/ | `server/index.js` |

---

## Prerequisites

**Tools — install before starting:**

```bash
# Azure CLI
az --version          # must be >= 2.57

# Container Apps extension
az extension add --name containerapp

# Docker Desktop
docker --version      # must be >= 24

# GitHub CLI
gh --version          # must be >= 2.40

# Node.js
node --version        # must be >= 20 LTS
```

**Access required:**
- Azure: Contributor role on the target subscription
- GitHub: Admin access to the repository
- Any external service your MCP server wraps (e.g. ServiceNow, Jira): API credentials ready

**Log in before running any commands:**

```bash
az login
az account set --subscription "{AZURE_SUBSCRIPTION_ID}"
gh auth login
```

---

## Architecture Overview

```mermaid
graph TD
    subgraph GitHub
        GH[Push to main] --> GA[GitHub Actions]
    end

    subgraph Azure["Azure — {REGION_FULL}"]
        GA -->|docker push| ACR[Container Registry\n{REGISTRY}.azurecr.io]

        subgraph TEST_RG["rg-{WORKLOAD}-test-{REGION}"]
            MI_T[Managed Identity\nid-{WORKLOAD}-test-{REGION}]
            KV_T[Key Vault\nkv-{WORKLOAD}-test-{REGION}]
            CAE_T[Container App Env\ncae-{WORKLOAD}-test-{REGION}]
            CA_T[Container App\nca-{WORKLOAD}-test]
            LOG_T[Log Analytics\nlog-{WORKLOAD}-test-{REGION}]
        end

        subgraph PROD_RG["rg-{WORKLOAD}-prod-{REGION}"]
            MI_P[Managed Identity\nid-{WORKLOAD}-prod-{REGION}]
            KV_P[Key Vault\nkv-{WORKLOAD}-prod-{REGION}]
            CAE_P[Container App Env\ncae-{WORKLOAD}-prod-{REGION}]
            CA_P[Container App\nca-{WORKLOAD}-prod]
            LOG_P[Log Analytics\nlog-{WORKLOAD}-prod-{REGION}]
        end

        ACR -->|AcrPull| CA_T
        ACR -->|AcrPull| CA_P
        KV_T -->|Secrets User| CA_T
        KV_P -->|Secrets User| CA_P
        CAE_T --- LOG_T
        CAE_P --- LOG_P
    end

    Client[MCP Client\nAI Agent] -->|HTTPS SSE| CA_P
```

### CI/CD Pipeline Flow

```
push to main
  └─► test (lint + typecheck + unit tests)
        └─► build (docker build → push to ACR)
              └─► deploy-test (az containerapp update → test ACA)
                    └─► smoke-test (GET /health, 10 retries)
                          └─► integration-test (live external service)
                                └─► [MANUAL APPROVAL — {REVIEWER}]
                                      └─► deploy-prod (az containerapp update + traffic shift)
                                            └─► integration-test-prod
```

### Resource Naming Convention (CAF pattern)

```
{abbreviation}-{workload}-{environment}-{region}
```

| Abbreviation | Resource type |
|---|---|
| `rg` | Resource Group |
| `ca` | Container App |
| `cae` | Container App Environment |
| `kv` | Key Vault |
| `log` | Log Analytics Workspace |
| `id` | Managed Identity |
| `cr` | Container Registry |

### Mandatory Tags

Apply these tags to every resource:

| Tag | Value |
|---|---|
| `application` | your app name |
| `environment` | `prod` or `test` |
| `region` | `{REGION_FULL}` |
| `tier` | `api` |
| `owner` | GitHub username |
| `repository` | full GitHub URL |
| `created-date` | `YYYY-MM-DD` |

---

## Step 1 — Docker Image

Place this file at `docker/Dockerfile` in your repository. Adjust `{ENTRY_POINT}` and
the `cp` line if your build copies additional static assets (e.g. JSON schemas).

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
# Adjust the cp line to copy any static assets your app needs at runtime
RUN npm run build && cp -r src/resources/schemas dist/resources/schemas

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
CMD ["node", "dist/{ENTRY_POINT}"]
```

**Key decisions:**
- Non-root user (`mcpuser`) — minimal attack surface.
- `--omit=dev` in production stage — no devDependencies in the image.
- `NODE_ENV=production` and `MCP_TRANSPORT=http` baked in — no runtime flag needed.
- Alpine base — smallest footprint.

---

## Step 2 — Provision Azure Resources

Save the script below as `scripts/provision-azure.sh`. It is idempotent — safe to re-run.
Fill in the configuration variables at the top before running.

```bash
#!/usr/bin/env bash
# =============================================================================
# provision-azure.sh — Idempotent Azure resource provisioning for MCP Server
#
# Prerequisites:
#   az login
#   az extension add --name containerapp
#   az account set --subscription {AZURE_SUBSCRIPTION_ID}
#
# Usage:
#   bash scripts/provision-azure.sh
#
# After running, complete setup manually:
#   1. Assign AcrPull role to both managed identities (Step 4)
#   2. Assign Key Vault Secrets User role to both managed identities (Step 8)
#   3. Populate Key Vault secrets (Step 9)
#   4. Create OIDC federated credential (see Step 3 in this guide)
#   5. Configure GitHub secrets and environments (see Steps 4-5 in this guide)
# =============================================================================

set -euo pipefail

# ── Configuration — edit these ────────────────────────────────────────────────

REGION="{REGION_FULL}"
TODAY=$(date +%Y-%m-%d)

# Resource Groups
PROD_RG="rg-{WORKLOAD}-prod-{REGION}"
TEST_RG="rg-{WORKLOAD}-test-{REGION}"

# Container Registry (shared, lives in prod RG)
ACR_NAME="{REGISTRY}"
ACR_SKU="Standard"

# Managed Identities
PROD_IDENTITY="id-{WORKLOAD}-prod-{REGION}"
TEST_IDENTITY="id-{WORKLOAD}-test-{REGION}"

# Log Analytics Workspaces
PROD_LOG="log-{WORKLOAD}-prod-{REGION}"
TEST_LOG="log-{WORKLOAD}-test-{REGION}"

# Container App Environments
PROD_CAE="cae-{WORKLOAD}-prod-{REGION}"
TEST_CAE="cae-{WORKLOAD}-test-{REGION}"

# Key Vaults
PROD_KV="kv-{WORKLOAD}-prod-{REGION}"
TEST_KV="kv-{WORKLOAD}-test-{REGION}"

# Container Apps
PROD_CA="ca-{WORKLOAD}-prod"
TEST_CA="ca-{WORKLOAD}-test"

# Initial placeholder image (replaced by first pipeline run)
PLACEHOLDER_IMAGE="mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"

# Mandatory tags
PROD_TAGS="application={WORKLOAD} environment=prod region={REGION_FULL} tier=api owner={OWNER} repository=https://github.com/{OWNER}/{REPO} created-date=$TODAY"
TEST_TAGS="application={WORKLOAD} environment=test region={REGION_FULL} tier=api owner={OWNER} repository=https://github.com/{OWNER}/{REPO} created-date=$TODAY"

# ── Helpers ───────────────────────────────────────────────────────────────────

info()    { echo "→ $*"; }
success() { echo "✓ $*"; }
section() { echo ""; echo "━━━ $* ━━━"; }

# ── Step 1: Resource Groups ───────────────────────────────────────────────────

section "Step 1 — Resource Groups"

az group create --name "$PROD_RG" --location "$REGION" --tags $PROD_TAGS --output none
success "$PROD_RG"

az group create --name "$TEST_RG" --location "$REGION" --tags $TEST_TAGS --output none
success "$TEST_RG"

# ── Step 2: Managed Identities ────────────────────────────────────────────────

section "Step 2 — Managed Identities"

az identity create --name "$PROD_IDENTITY" --resource-group "$PROD_RG" \
  --location "$REGION" --tags $PROD_TAGS --output none
PROD_IDENTITY_ID=$(az identity show --name "$PROD_IDENTITY" \
  --resource-group "$PROD_RG" --query id -o tsv)
PROD_IDENTITY_PRINCIPAL=$(az identity show --name "$PROD_IDENTITY" \
  --resource-group "$PROD_RG" --query principalId -o tsv)
success "$PROD_IDENTITY  (principalId: $PROD_IDENTITY_PRINCIPAL)"

az identity create --name "$TEST_IDENTITY" --resource-group "$TEST_RG" \
  --location "$REGION" --tags $TEST_TAGS --output none
TEST_IDENTITY_ID=$(az identity show --name "$TEST_IDENTITY" \
  --resource-group "$TEST_RG" --query id -o tsv)
TEST_IDENTITY_PRINCIPAL=$(az identity show --name "$TEST_IDENTITY" \
  --resource-group "$TEST_RG" --query principalId -o tsv)
success "$TEST_IDENTITY  (principalId: $TEST_IDENTITY_PRINCIPAL)"

# Wait for managed identities to propagate in Azure AD before role assignment
info "Waiting 30s for managed identity propagation..."
sleep 30

# ── Step 3: Container Registry ────────────────────────────────────────────────

section "Step 3 — Container Registry (shared)"

az acr create --name "$ACR_NAME" --resource-group "$PROD_RG" \
  --location "$REGION" --sku "$ACR_SKU" --admin-enabled false \
  --tags $PROD_TAGS --output none
ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$PROD_RG" --query id -o tsv)
success "$ACR_NAME  (id: $ACR_ID)"

# ── Step 4: AcrPull — MANUAL via Portal ──────────────────────────────────────

section "Step 4 — AcrPull role assignment (MANUAL)"

cat <<'MANUAL_ACRROLE'
⚠️  MANUAL STEP: The Azure CLI role assignment has compatibility issues in some
    environments. Assign AcrPull via Azure Portal:

  For PROD identity:
  1. Portal → PROD resource group → Container Registry → Access Control (IAM)
  2. "+ Add" → "Add role assignment" → Role: "AcrPull"
  3. Members: "Managed Identity" → select PROD managed identity
  4. "Review + assign"

  For TEST identity:
  5. Repeat with TEST managed identity on the same Container Registry

MANUAL_ACRROLE

success "Step 4 — marked for manual setup"

# ── Step 5: Log Analytics Workspaces ─────────────────────────────────────────

section "Step 5 — Log Analytics Workspaces"

az monitor log-analytics workspace create --workspace-name "$PROD_LOG" \
  --resource-group "$PROD_RG" --location "$REGION" --tags $PROD_TAGS --output none
PROD_LOG_ID=$(az monitor log-analytics workspace show \
  --workspace-name "$PROD_LOG" --resource-group "$PROD_RG" --query customerId -o tsv)
PROD_LOG_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --workspace-name "$PROD_LOG" --resource-group "$PROD_RG" \
  --query primarySharedKey -o tsv)
success "$PROD_LOG"

az monitor log-analytics workspace create --workspace-name "$TEST_LOG" \
  --resource-group "$TEST_RG" --location "$REGION" --tags $TEST_TAGS --output none
TEST_LOG_ID=$(az monitor log-analytics workspace show \
  --workspace-name "$TEST_LOG" --resource-group "$TEST_RG" --query customerId -o tsv)
TEST_LOG_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --workspace-name "$TEST_LOG" --resource-group "$TEST_RG" \
  --query primarySharedKey -o tsv)
success "$TEST_LOG"

# ── Step 6: Container App Environments ───────────────────────────────────────

section "Step 6 — Container App Environments"

az containerapp env create --name "$PROD_CAE" --resource-group "$PROD_RG" \
  --location "$REGION" --logs-workspace-id "$PROD_LOG_ID" \
  --logs-workspace-key "$PROD_LOG_KEY" --tags $PROD_TAGS --output none
success "$PROD_CAE"

az containerapp env create --name "$TEST_CAE" --resource-group "$TEST_RG" \
  --location "$REGION" --logs-workspace-id "$TEST_LOG_ID" \
  --logs-workspace-key "$TEST_LOG_KEY" --tags $TEST_TAGS --output none
success "$TEST_CAE"

# ── Step 7: Key Vaults ────────────────────────────────────────────────────────

section "Step 7 — Key Vaults"

az keyvault create --name "$PROD_KV" --resource-group "$PROD_RG" \
  --location "$REGION" --enable-rbac-authorization true \
  --tags $PROD_TAGS --output none
PROD_KV_ID=$(az keyvault show --name "$PROD_KV" --resource-group "$PROD_RG" \
  --query id -o tsv)
success "$PROD_KV"

az keyvault create --name "$TEST_KV" --resource-group "$TEST_RG" \
  --location "$REGION" --enable-rbac-authorization true \
  --tags $TEST_TAGS --output none
TEST_KV_ID=$(az keyvault show --name "$TEST_KV" --resource-group "$TEST_RG" \
  --query id -o tsv)
success "$TEST_KV"

# ── Step 8: Key Vault Secrets User — MANUAL via Portal ───────────────────────

section "Step 8 — Key Vault role assignments (MANUAL)"

cat <<'MANUAL_KVROLE'
⚠️  MANUAL STEP: Assign "Key Vault Secrets User" via Azure Portal:

  For PROD identity on PROD Key Vault:
  1. Portal → PROD resource group → Key Vault → Access Control (IAM)
  2. "+ Add" → "Add role assignment" → Role: "Key Vault Secrets User"
  3. Members: "Managed Identity" → select PROD managed identity
  4. "Review + assign"

  For TEST identity on TEST Key Vault:
  5. Repeat with TEST managed identity on TEST Key Vault

MANUAL_KVROLE

success "Step 8 — marked for manual setup"

# ── Step 9: MANUAL — Populate Key Vault Secrets ──────────────────────────────

section "Step 9 — MANUAL: Populate Key Vault Secrets"

cat <<MANUAL
Run these commands with real values. Adjust secret names to match your app's
env var names (use hyphens, not underscores — Key Vault naming requirement).

  PROD Key Vault ($PROD_KV):
  az keyvault secret set --vault-name $PROD_KV \\
    --name YOUR-SECRET-NAME --value "your-value"

  TEST Key Vault ($TEST_KV):
  az keyvault secret set --vault-name $TEST_KV \\
    --name YOUR-SECRET-NAME --value "your-value"

Continuing with Container App creation using placeholder image...
MANUAL

# ── Step 10: Test Container App ───────────────────────────────────────────────

section "Step 10 — Container App: $TEST_CA (test)"

PROD_KV_URI="https://$PROD_KV.vault.azure.net"
TEST_KV_URI="https://$TEST_KV.vault.azure.net"

# NOTE: Adjust --secrets and --env-vars to match your application's secrets.
# The pattern is:
#   --secrets "my-secret=keyvaultref:{KV_URI}/secrets/MY-SECRET,identityref:{IDENTITY_ID}"
#   --env-vars "MY_ENV_VAR=secretref:my-secret"

info "Creating $TEST_CA (scale-to-zero, single revision mode)"
az containerapp create \
  --name "$TEST_CA" \
  --resource-group "$TEST_RG" \
  --environment "$TEST_CAE" \
  --image "$PLACEHOLDER_IMAGE" \
  --user-assigned "$TEST_IDENTITY_ID" \
  --registry-server "$ACR_NAME.azurecr.io" \
  --registry-identity "$TEST_IDENTITY_ID" \
  --ingress external \
  --target-port 8080 \
  --transport http \
  --min-replicas 0 \
  --max-replicas 1 \
  --cpu 0.25 \
  --memory 0.5Gi \
  --revisions-mode single \
  --env-vars \
    "MCP_TRANSPORT=http" \
    "MCP_PORT=8080" \
    "NODE_ENV=production" \
    "LOG_LEVEL=debug" \
  --tags $TEST_TAGS \
  --output none

# SSE requires sticky sessions — clients must reconnect to the same replica
az containerapp ingress sticky-sessions set \
  --name "$TEST_CA" --resource-group "$TEST_RG" --affinity sticky --output none

TEST_CA_FQDN=$(az containerapp show --name "$TEST_CA" \
  --resource-group "$TEST_RG" \
  --query "properties.configuration.ingress.fqdn" -o tsv)
success "$TEST_CA — https://$TEST_CA_FQDN"

# ── Step 11: Prod Container App ───────────────────────────────────────────────

section "Step 11 — Container App: $PROD_CA (production)"

info "Creating $PROD_CA (min 1, max 3, multiple revision mode)"
az containerapp create \
  --name "$PROD_CA" \
  --resource-group "$PROD_RG" \
  --environment "$PROD_CAE" \
  --image "$PLACEHOLDER_IMAGE" \
  --user-assigned "$PROD_IDENTITY_ID" \
  --registry-server "$ACR_NAME.azurecr.io" \
  --registry-identity "$PROD_IDENTITY_ID" \
  --ingress external \
  --target-port 8080 \
  --transport http \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --revisions-mode multiple \
  --env-vars \
    "MCP_TRANSPORT=http" \
    "MCP_PORT=8080" \
    "NODE_ENV=production" \
    "LOG_LEVEL=info" \
  --tags $PROD_TAGS \
  --output none

az containerapp ingress sticky-sessions set \
  --name "$PROD_CA" --resource-group "$PROD_RG" --affinity sticky --output none

PROD_CA_FQDN=$(az containerapp show --name "$PROD_CA" \
  --resource-group "$PROD_RG" \
  --query "properties.configuration.ingress.fqdn" -o tsv)
success "$PROD_CA — https://$PROD_CA_FQDN"

# ── Summary ───────────────────────────────────────────────────────────────────

section "Provisioning Complete"

cat <<EOF
Resources created in $REGION:

  Resource Groups:     $PROD_RG  /  $TEST_RG
  Container Registry:  $ACR_NAME.azurecr.io  (in $PROD_RG)
  Container Apps:      $PROD_CA  →  https://$PROD_CA_FQDN
                       $TEST_CA  →  https://$TEST_CA_FQDN
  Key Vaults:          $PROD_KV  /  $TEST_KV
  Managed Identities:  $PROD_IDENTITY  /  $TEST_IDENTITY

Next steps:
  1. (MANUAL) Assign AcrPull to both managed identities — Step 4 above
  2. (MANUAL) Assign Key Vault Secrets User to both managed identities — Step 8
  3. Populate Key Vault secrets — Step 9 above
  4. Create OIDC federated credential — Step 3 in MCP-DEPLOYMENT-GUIDE.md
  5. Add GitHub repository secrets — Step 4 in MCP-DEPLOYMENT-GUIDE.md
  6. Configure GitHub environments — Step 5 in MCP-DEPLOYMENT-GUIDE.md
  7. Push a commit to main to trigger the first pipeline run
EOF
```

---

## Step 3 — OIDC Federated Auth (No Stored Azure Secrets)

GitHub Actions authenticates to Azure via OIDC — no passwords or certificates stored.

### 3a — Create an App Registration

```bash
az ad app create --display-name "gh-actions-{WORKLOAD}"
# Note the appId from the output — this is your AZURE_CLIENT_ID
```

### 3b — Add Federated Credentials

```bash
APP_ID="{AZURE_CLIENT_ID}"   # from step 3a

# For the 'testing' GitHub environment
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-testing",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:{OWNER}/{REPO}:environment:testing",
  "audiences": ["api://AzureADTokenExchange"]
}'

# For the 'production' GitHub environment
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:{OWNER}/{REPO}:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

### 3c — Create a Service Principal for the App

```bash
az ad sp create --id "$APP_ID"
```

### 3d — Grant Contributor on Both Resource Groups

```bash
SP_OBJECT_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

az role assignment create \
  --assignee-object-id "$SP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role Contributor \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-{WORKLOAD}-prod-{REGION}"

az role assignment create \
  --assignee-object-id "$SP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role Contributor \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-{WORKLOAD}-test-{REGION}"
```

### 3e — Collect Values for GitHub

```bash
echo "AZURE_CLIENT_ID:       $APP_ID"
echo "AZURE_TENANT_ID:       $(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID: $SUBSCRIPTION_ID"
```

---

## Step 4 — Configure GitHub Repository Secrets

```bash
gh secret set AZURE_CLIENT_ID       --body "{AZURE_CLIENT_ID}"
gh secret set AZURE_TENANT_ID       --body "{AZURE_TENANT_ID}"
gh secret set AZURE_SUBSCRIPTION_ID --body "{AZURE_SUBSCRIPTION_ID}"
```

If your integration tests need live service credentials, add those too:

```bash
gh secret set YOUR_SERVICE_URL  --body "https://..."
gh secret set YOUR_API_KEY      --body "..."
```

---

## Step 5 — Configure GitHub Environments

```bash
# 'testing' environment — auto-deploys, no approval required
gh api repos/{OWNER}/{REPO}/environments/testing --method PUT \
  --field wait_timer=0

# 'production' environment — requires manual approval from {REVIEWER}
# (easier to set up via the GitHub UI: Settings → Environments → New environment)
# Settings to apply:
#   - Required reviewers: {REVIEWER}
#   - Deployment branches: Selected branches → main
```

> The manual approval gate works because `deploy-prod` in the workflow declares
> `environment: production`. GitHub pauses the job and sends a notification to
> the required reviewer before proceeding.

---

## Step 6 — GitHub Actions CI/CD Pipeline

Save this file as `.github/workflows/deploy.yml`. Fill in the `env:` block at the top.

```yaml
# CI/CD Pipeline — MCP Server
#
# Flow:
#   push to main → test → build & push image → deploy-test
#   → smoke-test → integration-test → [manual approval] → deploy-prod
#   → prod health check → integration-test-prod
#
# Required GitHub repository secrets:
#   AZURE_CLIENT_ID          — App registration client ID (OIDC)
#   AZURE_TENANT_ID          — Azure AD tenant ID
#   AZURE_SUBSCRIPTION_ID    — Azure subscription ID
#   (+ any app-specific secrets your integration tests need)
#
# Required GitHub environments (Settings → Environments):
#   testing    — no protection rules
#   production — Required reviewer: {REVIEWER}, branch: main

name: Build and Deploy

on:
  push:
    branches:
      - main

permissions:
  id-token: write  # Required for OIDC token exchange with Azure
  contents: read

env:
  ACR_NAME: {REGISTRY}
  IMAGE_REPO: {IMAGE}
  PROD_RG: rg-{WORKLOAD}-prod-{REGION}
  TEST_RG: rg-{WORKLOAD}-test-{REGION}
  CA_PROD: ca-{WORKLOAD}-prod
  CA_TEST: ca-{WORKLOAD}-test

jobs:
  # ── Job 1: Lint, type check, unit tests ─────────────────────────────────────
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Unit tests
        run: npm test

  # ── Job 2: Build Docker image and push to ACR ───────────────────────────────
  build:
    name: Build & Push Image
    needs: test
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ steps.image-tag.outputs.tag }}
      image-ref: ${{ steps.image-tag.outputs.ref }}
    steps:
      - uses: actions/checkout@v4

      - name: Derive short image tag from commit SHA
        id: image-tag
        run: |
          TAG="${GITHUB_SHA::7}"
          REF="${{ env.ACR_NAME }}.azurecr.io/${{ env.IMAGE_REPO }}:$TAG"
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"
          echo "ref=$REF" >> "$GITHUB_OUTPUT"
          echo "Image: $REF"

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Authenticate Docker to ACR
        run: az acr login --name ${{ env.ACR_NAME }}

      - name: Build Docker image
        run: docker build -f docker/Dockerfile -t "${{ steps.image-tag.outputs.ref }}" .

      - name: Push Docker image to ACR
        run: docker push "${{ steps.image-tag.outputs.ref }}"

  # ── Job 3: Deploy to test Container App ─────────────────────────────────────
  deploy-test:
    name: Deploy → Test
    needs: build
    runs-on: ubuntu-latest
    environment: testing
    steps:
      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy new image to test ACA
        run: |
          az containerapp update \
            --name "${{ env.CA_TEST }}" \
            --resource-group "${{ env.TEST_RG }}" \
            --image "${{ needs.build.outputs.image-ref }}"

  # ── Job 4: Smoke test — health check with cold-start handling ───────────────
  smoke-test:
    name: Smoke Test (test ACA)
    needs: [build, deploy-test]
    runs-on: ubuntu-latest
    steps:
      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Get test ACA FQDN
        id: fqdn
        run: |
          FQDN=$(az containerapp show \
            --name "${{ env.CA_TEST }}" \
            --resource-group "${{ env.TEST_RG }}" \
            --query "properties.configuration.ingress.fqdn" \
            -o tsv)
          echo "fqdn=$FQDN" >> "$GITHUB_OUTPUT"
          echo "Test ACA FQDN: $FQDN"

      - name: Health check (retry up to 10x for cold-start)
        # Test ACA scales to zero — allow up to 10 retries × 15s = 2.5 min for cold start
        run: |
          URL="https://${{ steps.fqdn.outputs.fqdn }}/health"
          echo "Health check URL: $URL"
          for i in $(seq 1 10); do
            HTTP_STATUS=$(curl -s -o /tmp/health_body -w "%{http_code}" --max-time 15 "$URL" || echo "000")
            echo "Attempt $i — HTTP $HTTP_STATUS"
            if [ "$HTTP_STATUS" = "200" ]; then
              echo "Health check passed."
              exit 0
            fi
            if [ "$i" = "10" ]; then
              echo "Health check failed after 10 attempts (last status: $HTTP_STATUS)"
              cat /tmp/health_body 2>/dev/null || true
              exit 1
            fi
            echo "Retrying in 15s..."
            sleep 15
          done

  # ── Job 5: Integration tests against live external service ──────────────────
  integration-test:
    name: Integration Tests
    needs: [build, smoke-test]
    runs-on: ubuntu-latest
    environment: testing
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run integration tests
        env:
          INTEGRATION_TESTS: 'true'
          # Add your app-specific env vars from GitHub secrets here, e.g.:
          # SERVICE_URL: ${{ secrets.SERVICE_URL }}
          # SERVICE_API_KEY: ${{ secrets.SERVICE_API_KEY }}
        run: npm run test:integration

  # ── Job 6: Deploy to production (requires manual approval) ──────────────────
  deploy-prod:
    name: Deploy → Production
    needs: [build, smoke-test, integration-test]
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://ca-{WORKLOAD}-prod.{REGION_FULL}.azurecontainerapps.io
    steps:
      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy to production ACA (blue-green via revision suffix)
        # Creates a new revision tagged with the commit SHA.
        # The old revision stays at 0% traffic for instant rollback.
        run: |
          TAG="${{ needs.build.outputs.image-tag }}"
          IMAGE="${{ needs.build.outputs.image-ref }}"

          echo "Deploying image: $IMAGE"
          az containerapp update \
            --name "${{ env.CA_PROD }}" \
            --resource-group "${{ env.PROD_RG }}" \
            --image "$IMAGE" \
            --revision-suffix "$TAG"

          # Shift 100% traffic to the new revision immediately
          REVISION="${{ env.CA_PROD }}--$TAG"
          echo "Routing 100% traffic to: $REVISION"
          az containerapp ingress traffic set \
            --name "${{ env.CA_PROD }}" \
            --resource-group "${{ env.PROD_RG }}" \
            --revision-weight "$REVISION=100"

      - name: Verify production health
        run: |
          FQDN=$(az containerapp show \
            --name "${{ env.CA_PROD }}" \
            --resource-group "${{ env.PROD_RG }}" \
            --query "properties.configuration.ingress.fqdn" \
            -o tsv)
          URL="https://$FQDN/health"
          echo "Production health check URL: $URL"
          sleep 10
          for i in $(seq 1 5); do
            HTTP_STATUS=$(curl -s -o /tmp/prod_health_body -w "%{http_code}" --max-time 15 "$URL" || echo "000")
            echo "Attempt $i — HTTP $HTTP_STATUS"
            if [ "$HTTP_STATUS" = "200" ]; then
              echo "Production health check passed."
              exit 0
            fi
            sleep 10
          done
          echo "Production health check failed."
          cat /tmp/prod_health_body 2>/dev/null || true
          exit 1

  # ── Job 7: Integration tests against production ──────────────────────────────
  integration-test-prod:
    name: Integration Tests — Production
    needs: [build, deploy-prod]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run integration tests (production)
        env:
          INTEGRATION_TESTS: 'true'
          # Add your app-specific env vars from GitHub secrets here
        run: npm run test:integration
```

---

## Step 7 — MCP Server HTTP Endpoints

Your MCP server must expose these three endpoints when running in HTTP mode (`MCP_TRANSPORT=http`):

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | None | Liveness/readiness probe. Returns `{"status":"ok"}` with HTTP 200. Required by smoke test and ACA health probes. |
| `GET /sse` | `Authorization: Bearer <key>` or `x-api-key: <key>` | Establishes the legacy MCP SSE stream. Returns `text/event-stream`. |
| `POST /messages` | None (session-bound) | Routes JSON-RPC 2.0 messages to the active SSE session. |
| `POST` / `GET` / `DELETE /mcp` | `Authorization: Bearer <key>` or `x-api-key: <key>` | Streamable HTTP transport for modern clients (e.g. Azure AI Foundry). **All three methods must be routed to the transport** — `POST` initializes and sends requests, `GET` opens the server→client SSE stream, `DELETE` closes the session. Wiring only `POST` causes a **404** on `GET`/`DELETE` that breaks the client connection. |

> **Streamable HTTP gotcha:** modern MCP clients drive the session across `GET`, `POST`,
> and `DELETE` on a single `/mcp` path. If you register only `app.post('/mcp', ...)`,
> Express returns `404 Cannot GET /mcp` when the client opens its server→client stream —
> the client reports this as a connection failure. Route all three methods to the same
> handler and key transports by the `mcp-session-id` header.

**Inbound auth middleware** (HTTP mode only):
- Read `MCP_SERVER_API_KEY` from env.
- Accept key via `Authorization: Bearer <key>` or `x-api-key: <key>`.
- Return `401 {"error":"Unauthorized"}` on mismatch.
- If `MCP_SERVER_API_KEY` is unset, log a loud warning — acceptable only in dev.
- Apply middleware only to `/sse`. The `/health` endpoint must be unauthenticated.

---

## Step 8 — Nginx Reverse Proxy (VPS / Secondary)

If running behind Nginx (e.g. on a VPS), SSE requires specific proxy settings.
Paste this inside your existing `server { }` HTTPS block:

```nginx
# Adjust the location path and upstream port to match your setup
location /mcp/ {
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

> `proxy_buffering off` and `proxy_read_timeout 3600s` are critical — without them
> Nginx will buffer the SSE stream and the client will receive nothing.

---

## Step 9 — First Deployment

### 9a — Run the Provisioning Script

```bash
bash scripts/provision-azure.sh
```

Then complete the **two manual Portal steps** printed by the script (AcrPull + Key Vault Secrets User role assignments).

### 9b — Populate Key Vault Secrets

```bash
# Example — replace secret names and values with your app's requirements
az keyvault secret set --vault-name "kv-{WORKLOAD}-prod-{REGION}" \
  --name "YOUR-SECRET-NAME" --value "your-value"

az keyvault secret set --vault-name "kv-{WORKLOAD}-test-{REGION}" \
  --name "YOUR-SECRET-NAME" --value "your-value"
```

### 9c — Add Key Vault Secret References to Container Apps

After populating secrets, update the Container Apps to pull them from Key Vault:

```bash
IDENTITY_ID=$(az identity show --name "id-{WORKLOAD}-prod-{REGION}" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" --query id -o tsv)
KV_URI="https://kv-{WORKLOAD}-prod-{REGION}.vault.azure.net"

az containerapp secret set \
  --name "ca-{WORKLOAD}-prod" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" \
  --secrets \
    "your-secret=keyvaultref:$KV_URI/secrets/YOUR-SECRET-NAME,identityref:$IDENTITY_ID"

az containerapp update \
  --name "ca-{WORKLOAD}-prod" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" \
  --set-env-vars "YOUR_ENV_VAR=secretref:your-secret"
```

Repeat for the test Container App using the test Key Vault and test identity.

### 9d — Trigger the Pipeline

```bash
git push origin main
```

Watch the pipeline:

```bash
gh run watch
```

---

## Step 10 — Verify the Deployment

```bash
# Get the production FQDN
FQDN=$(az containerapp show \
  --name "ca-{WORKLOAD}-prod" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" \
  --query "properties.configuration.ingress.fqdn" -o tsv)

# Health check (no auth required)
curl "https://$FQDN/health"
# Expected: {"status":"ok"}

# MCP SSE connection (requires API key)
curl -N \
  -H "Authorization: Bearer {MCP_SERVER_API_KEY}" \
  "https://$FQDN/sse"
# Expected: stream of text/event-stream data begins
```

---

## Ongoing Operations

### View Live Logs

```bash
az containerapp logs show \
  --name "ca-{WORKLOAD}-prod" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" \
  --follow
```

### List Revisions (Blue-Green State)

```bash
az containerapp revision list \
  --name "ca-{WORKLOAD}-prod" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" \
  --output table
```

### Emergency Rollback

```bash
# List revisions to find the previous one
az containerapp revision list \
  --name "ca-{WORKLOAD}-prod" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" \
  --output table

# Shift 100% traffic back to the previous revision
az containerapp ingress traffic set \
  --name "ca-{WORKLOAD}-prod" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" \
  --revision-weight {PREVIOUS_REVISION_NAME}=100
```

### Adjust Scaling

```bash
az containerapp update \
  --name "ca-{WORKLOAD}-prod" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" \
  --min-replicas 1 \
  --max-replicas 5
```

### Deactivate an Old Revision

```bash
az containerapp revision deactivate \
  --name "ca-{WORKLOAD}-prod" \
  --resource-group "rg-{WORKLOAD}-prod-{REGION}" \
  --revision {OLD_REVISION_NAME}
```

---

## Checklist

Use this checklist when deploying a new MCP project end-to-end:

- [ ] Dockerfile placed at `docker/Dockerfile`, entry point correct
- [ ] `GET /health` endpoint returns `{"status":"ok"}` with HTTP 200
- [ ] `GET /sse` and `POST /messages` endpoints implemented
- [ ] Inbound API key middleware protecting `/sse`
- [ ] `provision-azure.sh` placeholder values replaced and script run
- [ ] AcrPull role assigned to both managed identities (Portal)
- [ ] Key Vault Secrets User role assigned to both managed identities (Portal)
- [ ] Key Vault secrets populated
- [ ] Container Apps updated with secret references
- [ ] OIDC App Registration created, federated credentials added for both environments
- [ ] GitHub repository secrets set (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`)
- [ ] GitHub `testing` environment created (no protection rules)
- [ ] GitHub `production` environment created (required reviewer set)
- [ ] `deploy.yml` placeholder values replaced
- [ ] First `git push origin main` triggered and pipeline passed
- [ ] `GET /health` verified against production FQDN
- [ ] SSE connection verified with API key
