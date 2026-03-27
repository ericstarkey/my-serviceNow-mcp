# Azure Deployment Guide — ServiceNow MCP Server

This guide walks through setting up the complete Azure infrastructure and CI/CD pipeline from scratch.

For the infrastructure diagram and architectural narrative, see [architecture.md](architecture.md).

---

## Prerequisites

- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed (for local image builds)
- [GitHub CLI](https://cli.github.com/) installed
- An Azure subscription
- Owner or Contributor access to the subscription (for resource creation and role assignments)

Install the Azure Container Apps CLI extension (one-time):

```bash
az extension add --name containerapp --upgrade
```

Log in and set your subscription:

```bash
az login
az account list --output table          # find your subscription
az account set --subscription "<name or id>"
az account show                         # confirm active subscription
```

---

## Step 1 — Provision Azure Resources

Run the provisioning script. It is idempotent — safe to re-run if anything fails partway through.

```bash
bash scripts/provision-azure.sh
```

The script creates all resources in `southcentralus` and applies mandatory tags to everything. It ends by printing the FQDNs of both Container Apps.

---

## Step 2 — Populate Key Vault Secrets

After provisioning, add the real secret values to each Key Vault. The Container Apps will not start correctly until secrets are populated.

### Production Key Vault (`kv-snmcp-prod-scus`)

```bash
# Required for all AUTH_TYPE values
az keyvault secret set --vault-name kv-snmcp-prod-scus \
  --name SERVICENOW-INSTANCE-URL \
  --value "https://your-instance.service-now.com"

az keyvault secret set --vault-name kv-snmcp-prod-scus \
  --name MCP-SERVER-API-KEY \
  --value "$(openssl rand -hex 32)"   # generate a strong random key

# If AUTH_TYPE=api_key (default):
az keyvault secret set --vault-name kv-snmcp-prod-scus \
  --name SERVICENOW-API-KEY \
  --value "your-servicenow-api-key"

# If AUTH_TYPE=basic (add these instead of api_key):
# az keyvault secret set --vault-name kv-snmcp-prod-scus \
#   --name SERVICENOW-USERNAME --value "your-username"
# az keyvault secret set --vault-name kv-snmcp-prod-scus \
#   --name SERVICENOW-PASSWORD --value "your-password"

# If AUTH_TYPE=oauth (add these):
# az keyvault secret set --vault-name kv-snmcp-prod-scus \
#   --name SERVICENOW-CLIENT-ID --value "your-client-id"
# az keyvault secret set --vault-name kv-snmcp-prod-scus \
#   --name SERVICENOW-CLIENT-SECRET --value "your-client-secret"
```

### Test Key Vault (`kv-snmcp-test-scus`)

Repeat the same commands with `--vault-name kv-snmcp-test-scus`. Test and prod can share the same ServiceNow instance or use separate instances.

### Updating a Secret Later

Container Apps check for Key Vault secret updates every 30 minutes when using the latest-version URI. To force an immediate refresh, restart the active revision:

```bash
az containerapp revision restart \
  --name ca-snmcp-prod \
  --resource-group rg-snmcp-prod-scus \
  --revision $(az containerapp revision list \
    --name ca-snmcp-prod \
    --resource-group rg-snmcp-prod-scus \
    --query "sort_by([], &properties.createdTime)[-1].name" -o tsv)
```

---

## Step 3 — Set Up OIDC Federated Credential for GitHub Actions

This enables GitHub Actions to authenticate with Azure without storing a long-lived secret.

### 3a. Create an App Registration

```bash
APP_ID=$(az ad app create \
  --display-name sp-snmcp-cicd \
  --query appId -o tsv)
echo "App (client) ID: $APP_ID"

# Create a service principal for the app registration
az ad sp create --id "$APP_ID" --output none
SP_OBJECT_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)
echo "Service principal object ID: $SP_OBJECT_ID"
```

### 3b. Add Federated Credential for GitHub Actions

```bash
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:ericstarkey/my-serviceNow-mcp:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"],
    "description": "GitHub Actions OIDC for main branch deployments"
  }'
```

### 3c. Grant Required Roles

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

# Contributor on both resource groups (create/update Container Apps)
az role assignment create \
  --role Contributor \
  --assignee-object-id "$SP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-snmcp-prod-scus"

az role assignment create \
  --role Contributor \
  --assignee-object-id "$SP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-snmcp-test-scus"

# AcrPush on the shared Container Registry (build job pushes images)
ACR_ID=$(az acr show --name crsnmcp001 --resource-group rg-snmcp-prod-scus --query id -o tsv)
az role assignment create \
  --role AcrPush \
  --assignee-object-id "$SP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --scope "$ACR_ID"
```

### 3d. Note the Values You Will Need

```bash
echo "AZURE_CLIENT_ID:       $APP_ID"
echo "AZURE_TENANT_ID:       $(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID: $SUBSCRIPTION_ID"
```

---

## Step 4 — Configure GitHub Repository Secrets

```bash
# Log in to GitHub CLI
gh auth login

# Set repository-level secrets (available to all workflow jobs)
gh secret set AZURE_CLIENT_ID       --body "$APP_ID"
gh secret set AZURE_TENANT_ID       --body "$(az account show --query tenantId -o tsv)"
gh secret set AZURE_SUBSCRIPTION_ID --body "$(az account show --query id -o tsv)"
```

Verify:

```bash
gh secret list
```

---

## Step 5 — Configure GitHub Environments

### Testing Environment (auto-deploy, no approval)

```bash
# Create the environment with no protection rules
gh api \
  --method PUT \
  "repos/ericstarkey/my-serviceNow-mcp/environments/testing" \
  --field "deployment_branch_policy[protected_branches]=false" \
  --field "deployment_branch_policy[custom_branch_policies]=true"

# Restrict to main branch
gh api \
  --method POST \
  "repos/ericstarkey/my-serviceNow-mcp/environments/testing/deployment-branch-policies" \
  --field "name=main" \
  --field "type=branch"
```

### Production Environment (manual approval required)

Configure via the GitHub UI (CLI support for required reviewers is limited):

1. Navigate to **Settings → Environments → New environment** → name it `production`
2. Under **Deployment protection rules**, check **Required reviewers**
3. Add `ericstarkey` as a required reviewer
4. Under **Deployment branches**, select **Selected branches** → add `main`
5. Click **Save protection rules**

---

## Step 6 — Trigger the First Pipeline Run

Push any commit to `main`:

```bash
git add .
git commit -m "feat: add Azure Container Apps deployment"
git push origin main
```

Watch the pipeline in GitHub Actions:

```bash
gh run watch
```

Expected flow:
1. **Test** — runs unit tests, lint, typecheck (~1–2 min)
2. **Build & Push Image** — builds Docker image, pushes to ACR (~2–3 min)
3. **Deploy → Test** — deploys to `ca-snmcp-test` (~1 min)
4. **Smoke Test** — polls `/health` with retries for cold-start (~1–2 min)
5. **⏸ PAUSE** — GitHub notifies you for production approval
6. Approve at: `https://github.com/ericstarkey/my-serviceNow-mcp/actions`
7. **Deploy → Production** — deploys to `ca-snmcp-prod` (~1 min)

---

## Step 7 — Verify Endpoints

After the first successful pipeline run:

```bash
# Get FQDNs
TEST_FQDN=$(az containerapp show \
  --name ca-snmcp-test --resource-group rg-snmcp-test-scus \
  --query "properties.configuration.ingress.fqdn" -o tsv)

PROD_FQDN=$(az containerapp show \
  --name ca-snmcp-prod --resource-group rg-snmcp-prod-scus \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo "Test: https://$TEST_FQDN"
echo "Prod: https://$PROD_FQDN"

# Health checks (no auth required)
curl https://$TEST_FQDN/health
curl https://$PROD_FQDN/health
# Expected: {"status":"ok"}

# SSE connection (requires MCP_SERVER_API_KEY from Key Vault)
MCP_KEY=$(az keyvault secret show \
  --vault-name kv-snmcp-test-scus \
  --name MCP-SERVER-API-KEY \
  --query value -o tsv)

curl -N \
  -H "Authorization: Bearer $MCP_KEY" \
  "https://$TEST_FQDN/sse"
# Expected: HTTP 200, Content-Type: text/event-stream
```

---

## Ongoing Operations

### View Logs

```bash
# Test ACA logs (last 50 lines)
az containerapp logs show \
  --name ca-snmcp-test \
  --resource-group rg-snmcp-test-scus \
  --tail 50

# Prod ACA logs (follow)
az containerapp logs show \
  --name ca-snmcp-prod \
  --resource-group rg-snmcp-prod-scus \
  --follow
```

### List Prod Revisions

```bash
az containerapp revision list \
  --name ca-snmcp-prod \
  --resource-group rg-snmcp-prod-scus \
  --output table
```

### Emergency Rollback (Production)

```bash
# Find the previous revision name (second-to-last by creation time)
PREV=$(az containerapp revision list \
  --name ca-snmcp-prod \
  --resource-group rg-snmcp-prod-scus \
  --query "sort_by([], &properties.createdTime)[-2].name" \
  -o tsv)

echo "Rolling back to: $PREV"

az containerapp ingress traffic set \
  --name ca-snmcp-prod \
  --resource-group rg-snmcp-prod-scus \
  --revision-weight "$PREV=100"
```

### Scale Prod Replicas Manually

```bash
az containerapp update \
  --name ca-snmcp-prod \
  --resource-group rg-snmcp-prod-scus \
  --min-replicas 2 \
  --max-replicas 5
```

---

## Recommended MCP Servers for Azure Management

Add these to your Claude Desktop MCP config to manage Azure resources directly through Claude:

| MCP Server | Repository | Install |
|------------|-----------|---------|
| **Azure MCP Server** (official) | `github.com/Azure/azure-mcp` | `npx @azure/mcp@latest` |
| **GitHub MCP Server** (official) | `github.com/modelcontextprotocol/servers` | `npx @modelcontextprotocol/server-github` |

The Azure MCP Server provides tools for Key Vault secret management, Container App operations, and more — all usable from Claude Desktop without switching to a terminal.

---

## VPS Secondary Environment

The Hostinger VPS remains available for special-case testing. To deploy a specific image to the VPS manually:

```bash
# On the VPS
az acr login --name crsnmcp001
docker pull crsnmcp001.azurecr.io/servicenow-mcp:<sha>

# Update docker-compose.yml image reference, then:
docker compose up -d
```

The VPS is not part of the automated pipeline and requires manual deployment.
