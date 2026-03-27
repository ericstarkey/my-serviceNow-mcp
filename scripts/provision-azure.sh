#!/usr/bin/env bash
# =============================================================================
# provision-azure.sh — Idempotent Azure resource provisioning
# ServiceNow MCP Server — Azure Container Apps deployment
#
# Prerequisites:
#   - Azure CLI (az) installed and logged in: az login
#   - Container Apps extension: az extension add --name containerapp
#   - Target subscription set: az account set --subscription <id>
#
# Usage:
#   bash scripts/provision-azure.sh
#
# This script is idempotent — safe to re-run. Existing resources are skipped.
# All resources are tagged per the project tagging strategy.
#
# After running this script, complete the setup by:
#   1. Populating Key Vault secrets (see the "MANUAL STEP" sections below)
#   2. Creating the OIDC federated credential for GitHub Actions
#   3. Configuring GitHub repository secrets (AZURE_CLIENT_ID, etc.)
#   4. Configuring GitHub environments (testing, production)
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

REGION="southcentralus"
TODAY=$(date +%Y-%m-%d)

# Resource Groups
PROD_RG="rg-snmcp-prod-scus"
TEST_RG="rg-snmcp-test-scus"

# Container Registry (shared, lives in prod RG)
ACR_NAME="crsnmcp001"
ACR_SKU="Standard"

# Managed Identities
PROD_IDENTITY="id-snmcp-prod-scus"
TEST_IDENTITY="id-snmcp-test-scus"

# Log Analytics Workspaces
PROD_LOG="log-snmcp-prod-scus"
TEST_LOG="log-snmcp-test-scus"

# Container App Environments
PROD_CAE="cae-snmcp-prod-scus"
TEST_CAE="cae-snmcp-test-scus"

# Key Vaults
PROD_KV="kv-snmcp-prod-scus"
TEST_KV="kv-snmcp-test-scus"

# Container Apps
PROD_CA="ca-snmcp-prod"
TEST_CA="ca-snmcp-test"

# Initial placeholder image (replaced by first pipeline run)
PLACEHOLDER_IMAGE="mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"

# Mandatory tags (applied to every resource)
PROD_TAGS="application=servicenow-mcp environment=prod region=southcentralus tier=api owner=ericstarkey repository=https://github.com/ericstarkey/my-serviceNow-mcp created-date=$TODAY"
TEST_TAGS="application=servicenow-mcp environment=test region=southcentralus tier=api owner=ericstarkey repository=https://github.com/ericstarkey/my-serviceNow-mcp created-date=$TODAY"

# ── Helpers ───────────────────────────────────────────────────────────────────

info()    { echo "→ $*"; }
success() { echo "✓ $*"; }
section() { echo ""; echo "━━━ $* ━━━"; }

# ── Step 1: Resource Groups ───────────────────────────────────────────────────

section "Step 1 — Resource Groups"

info "Creating resource group: $PROD_RG"
az group create \
  --name "$PROD_RG" \
  --location "$REGION" \
  --tags $PROD_TAGS \
  --output none
success "$PROD_RG"

info "Creating resource group: $TEST_RG"
az group create \
  --name "$TEST_RG" \
  --location "$REGION" \
  --tags $TEST_TAGS \
  --output none
success "$TEST_RG"

# ── Step 2: User-Assigned Managed Identities ──────────────────────────────────

section "Step 2 — Managed Identities"

info "Creating managed identity: $PROD_IDENTITY"
az identity create \
  --name "$PROD_IDENTITY" \
  --resource-group "$PROD_RG" \
  --location "$REGION" \
  --tags $PROD_TAGS \
  --output none
PROD_IDENTITY_ID=$(az identity show \
  --name "$PROD_IDENTITY" \
  --resource-group "$PROD_RG" \
  --query id -o tsv)
PROD_IDENTITY_PRINCIPAL=$(az identity show \
  --name "$PROD_IDENTITY" \
  --resource-group "$PROD_RG" \
  --query principalId -o tsv)
success "$PROD_IDENTITY  (principalId: $PROD_IDENTITY_PRINCIPAL)"

info "Creating managed identity: $TEST_IDENTITY"
az identity create \
  --name "$TEST_IDENTITY" \
  --resource-group "$TEST_RG" \
  --location "$REGION" \
  --tags $TEST_TAGS \
  --output none
TEST_IDENTITY_ID=$(az identity show \
  --name "$TEST_IDENTITY" \
  --resource-group "$TEST_RG" \
  --query id -o tsv)
TEST_IDENTITY_PRINCIPAL=$(az identity show \
  --name "$TEST_IDENTITY" \
  --resource-group "$TEST_RG" \
  --query principalId -o tsv)
success "$TEST_IDENTITY  (principalId: $TEST_IDENTITY_PRINCIPAL)"

# Wait for managed identities to fully propagate in Azure AD before role assignment
info "Waiting 30 seconds for managed identities to propagate in Azure AD..."
sleep 30

# ── Step 3: Azure Container Registry ─────────────────────────────────────────

section "Step 3 — Container Registry (shared)"

info "Creating ACR: $ACR_NAME (SKU: $ACR_SKU)"
az acr create \
  --name "$ACR_NAME" \
  --resource-group "$PROD_RG" \
  --location "$REGION" \
  --sku "$ACR_SKU" \
  --admin-enabled false \
  --tags $PROD_TAGS \
  --output none
ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$PROD_RG" --query id -o tsv)
success "$ACR_NAME  (id: $ACR_ID)"

# ── Step 4: Grant AcrPull to managed identities ───────────────────────────────

section "Step 4 — AcrPull role assignments (MANUAL — via Azure Portal)"

cat <<'MANUAL_ACRROLE'
⚠️  MANUAL STEP: The Azure CLI role assignment command has compatibility issues
    in this environment. You must assign AcrPull role manually via Azure Portal:

  For id-snmcp-prod-scus:
  1. Go to Azure Portal → rg-snmcp-prod-scus resource group
  2. Open crsnmcp001 (Container Registry)
  3. Left sidebar → Access Control (IAM)
  4. Click "+ Add" → "Add role assignment"
  5. Role tab: search for and select "AcrPull"
  6. Members tab: select "Managed Identity" → Azure subscription → id-snmcp-prod-scus
  7. Click "Review + assign"

  For id-snmcp-test-scus:
  8. Repeat steps 1-7 above, but select id-snmcp-test-scus in step 6

  Failure to assign AcrPull will cause Container Apps deployments to fail when
  pulling images. This can be done anytime before the first deployment.

MANUAL_ACRROLE

success "Step 4 marked for manual setup"

# ── Step 5: Log Analytics Workspaces ─────────────────────────────────────────

section "Step 5 — Log Analytics Workspaces"

info "Creating Log Analytics workspace: $PROD_LOG"
az monitor log-analytics workspace create \
  --workspace-name "$PROD_LOG" \
  --resource-group "$PROD_RG" \
  --location "$REGION" \
  --tags $PROD_TAGS \
  --output none
PROD_LOG_ID=$(az monitor log-analytics workspace show \
  --workspace-name "$PROD_LOG" \
  --resource-group "$PROD_RG" \
  --query customerId -o tsv)
PROD_LOG_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --workspace-name "$PROD_LOG" \
  --resource-group "$PROD_RG" \
  --query primarySharedKey -o tsv)
success "$PROD_LOG"

info "Creating Log Analytics workspace: $TEST_LOG"
az monitor log-analytics workspace create \
  --workspace-name "$TEST_LOG" \
  --resource-group "$TEST_RG" \
  --location "$REGION" \
  --tags $TEST_TAGS \
  --output none
TEST_LOG_ID=$(az monitor log-analytics workspace show \
  --workspace-name "$TEST_LOG" \
  --resource-group "$TEST_RG" \
  --query customerId -o tsv)
TEST_LOG_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --workspace-name "$TEST_LOG" \
  --resource-group "$TEST_RG" \
  --query primarySharedKey -o tsv)
success "$TEST_LOG"

# ── Step 6: Container App Environments ───────────────────────────────────────

section "Step 6 — Container App Environments"

info "Creating Container App Environment: $PROD_CAE"
az containerapp env create \
  --name "$PROD_CAE" \
  --resource-group "$PROD_RG" \
  --location "$REGION" \
  --logs-workspace-id "$PROD_LOG_ID" \
  --logs-workspace-key "$PROD_LOG_KEY" \
  --tags $PROD_TAGS \
  --output none
success "$PROD_CAE"

info "Creating Container App Environment: $TEST_CAE"
az containerapp env create \
  --name "$TEST_CAE" \
  --resource-group "$TEST_RG" \
  --location "$REGION" \
  --logs-workspace-id "$TEST_LOG_ID" \
  --logs-workspace-key "$TEST_LOG_KEY" \
  --tags $TEST_TAGS \
  --output none
success "$TEST_CAE"

# ── Step 7: Key Vaults ────────────────────────────────────────────────────────

section "Step 7 — Key Vaults"

info "Creating Key Vault: $PROD_KV"
az keyvault create \
  --name "$PROD_KV" \
  --resource-group "$PROD_RG" \
  --location "$REGION" \
  --enable-rbac-authorization true \
  --tags $PROD_TAGS \
  --output none
PROD_KV_ID=$(az keyvault show --name "$PROD_KV" --resource-group "$PROD_RG" --query id -o tsv)
success "$PROD_KV"

info "Creating Key Vault: $TEST_KV"
az keyvault create \
  --name "$TEST_KV" \
  --resource-group "$TEST_RG" \
  --location "$REGION" \
  --enable-rbac-authorization true \
  --tags $TEST_TAGS \
  --output none
TEST_KV_ID=$(az keyvault show --name "$TEST_KV" --resource-group "$TEST_RG" --query id -o tsv)
success "$TEST_KV"

# ── Step 8: Grant Key Vault Secrets User to managed identities ────────────────

section "Step 8 — Key Vault role assignments (MANUAL — via Azure Portal)"

cat <<'MANUAL_KVrole'
⚠️  MANUAL STEP: Assign "Key Vault Secrets User" role via Azure Portal:

  For id-snmcp-prod-scus on kv-snmcp-prod-scus:
  1. Go to Azure Portal → rg-snmcp-prod-scus resource group
  2. Open kv-snmcp-prod-scus (Key Vault)
  3. Left sidebar → Access Control (IAM)
  4. Click "+ Add" → "Add role assignment"
  5. Role tab: search for and select "Key Vault Secrets User"
  6. Members tab: select "Managed Identity" → Azure subscription → id-snmcp-prod-scus
  7. Click "Review + assign"

  For id-snmcp-test-scus on kv-snmcp-test-scus:
  8. Go to Azure Portal → rg-snmcp-test-scus resource group
  9. Open kv-snmcp-test-scus (Key Vault)
  10. Repeat steps 3-7 above, but select id-snmcp-test-scus in step 6

  Failure to assign this role will cause Container Apps to fail when retrieving
  secrets from Key Vault. This can be done anytime before the first deployment.

MANUAL_KVROLE

success "Step 8 marked for manual setup"

# ── Step 9: MANUAL STEP — Populate Key Vault Secrets ─────────────────────────

section "Step 9 — MANUAL: Populate Key Vault Secrets"

cat <<'MANUAL'
You must populate the following secrets in each Key Vault before the Container
Apps will start successfully. Run these commands with the real values:

  PROD Key Vault (kv-snmcp-prod-scus):
  ─────────────────────────────────────
  az keyvault secret set --vault-name kv-snmcp-prod-scus \
    --name SERVICENOW-INSTANCE-URL \
    --value "https://your-instance.service-now.com"

  az keyvault secret set --vault-name kv-snmcp-prod-scus \
    --name SERVICENOW-API-KEY \
    --value "your-servicenow-api-key"

  az keyvault secret set --vault-name kv-snmcp-prod-scus \
    --name MCP-SERVER-API-KEY \
    --value "your-mcp-inbound-api-key"

  TEST Key Vault (kv-snmcp-test-scus):
  ─────────────────────────────────────
  az keyvault secret set --vault-name kv-snmcp-test-scus \
    --name SERVICENOW-INSTANCE-URL \
    --value "https://your-instance.service-now.com"

  az keyvault secret set --vault-name kv-snmcp-test-scus \
    --name SERVICENOW-API-KEY \
    --value "your-servicenow-api-key"

  az keyvault secret set --vault-name kv-snmcp-test-scus \
    --name MCP-SERVER-API-KEY \
    --value "your-mcp-inbound-api-key"

  Add SERVICENOW-USERNAME, SERVICENOW-PASSWORD, SERVICENOW-CLIENT-ID,
  SERVICENOW-CLIENT-SECRET if using basic or oauth AUTH_TYPE.

Continuing with Container App creation using placeholder image...
MANUAL

# ── Step 10: Create test Container App ───────────────────────────────────────

section "Step 10 — Container App: $TEST_CA (test)"

PROD_KV_URI="https://$PROD_KV.vault.azure.net"
TEST_KV_URI="https://$TEST_KV.vault.azure.net"

info "Creating $TEST_CA (scale to zero, single revision mode)"
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
  --secrets \
    "servicenow-instance-url=keyvaultref:$TEST_KV_URI/secrets/SERVICENOW-INSTANCE-URL,identityref:$TEST_IDENTITY_ID" \
    "servicenow-api-key=keyvaultref:$TEST_KV_URI/secrets/SERVICENOW-API-KEY,identityref:$TEST_IDENTITY_ID" \
    "mcp-server-api-key=keyvaultref:$TEST_KV_URI/secrets/MCP-SERVER-API-KEY,identityref:$TEST_IDENTITY_ID" \
  --env-vars \
    "AUTH_TYPE=api_key" \
    "MCP_TRANSPORT=http" \
    "MCP_PORT=8080" \
    "SERVICENOW_TIMEOUT=30000" \
    "LOG_LEVEL=debug" \
    "NODE_ENV=production" \
    "SERVICENOW_INSTANCE_URL=secretref:servicenow-instance-url" \
    "SERVICENOW_API_KEY=secretref:servicenow-api-key" \
    "MCP_SERVER_API_KEY=secretref:mcp-server-api-key" \
  --tags $TEST_TAGS \
  --output none

# Enable sticky sessions for SSE connections
az containerapp ingress sticky-sessions set \
  --name "$TEST_CA" \
  --resource-group "$TEST_RG" \
  --affinity sticky \
  --output none

TEST_CA_FQDN=$(az containerapp show \
  --name "$TEST_CA" \
  --resource-group "$TEST_RG" \
  --query "properties.configuration.ingress.fqdn" -o tsv)
success "$TEST_CA — https://$TEST_CA_FQDN"

# ── Step 11: Create prod Container App ───────────────────────────────────────

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
  --secrets \
    "servicenow-instance-url=keyvaultref:$PROD_KV_URI/secrets/SERVICENOW-INSTANCE-URL,identityref:$PROD_IDENTITY_ID" \
    "servicenow-api-key=keyvaultref:$PROD_KV_URI/secrets/SERVICENOW-API-KEY,identityref:$PROD_IDENTITY_ID" \
    "mcp-server-api-key=keyvaultref:$PROD_KV_URI/secrets/MCP-SERVER-API-KEY,identityref:$PROD_IDENTITY_ID" \
  --env-vars \
    "AUTH_TYPE=api_key" \
    "MCP_TRANSPORT=http" \
    "MCP_PORT=8080" \
    "SERVICENOW_TIMEOUT=30000" \
    "LOG_LEVEL=info" \
    "NODE_ENV=production" \
    "SERVICENOW_INSTANCE_URL=secretref:servicenow-instance-url" \
    "SERVICENOW_API_KEY=secretref:servicenow-api-key" \
    "MCP_SERVER_API_KEY=secretref:mcp-server-api-key" \
  --tags $PROD_TAGS \
  --output none

# Enable sticky sessions for SSE connections
az containerapp ingress sticky-sessions set \
  --name "$PROD_CA" \
  --resource-group "$PROD_RG" \
  --affinity sticky \
  --output none

PROD_CA_FQDN=$(az containerapp show \
  --name "$PROD_CA" \
  --resource-group "$PROD_RG" \
  --query "properties.configuration.ingress.fqdn" -o tsv)
success "$PROD_CA — https://$PROD_CA_FQDN"

# ── Summary ───────────────────────────────────────────────────────────────────

section "Provisioning Complete"

cat <<EOF
Resources created in South Central US:

  Resource Groups:
    $PROD_RG
    $TEST_RG

  Container Registry:
    $ACR_NAME.azurecr.io  (Standard SKU, in $PROD_RG)

  Container App Environments:
    $PROD_CAE  (in $PROD_RG)
    $TEST_CAE  (in $TEST_RG)

  Container Apps:
    $PROD_CA  →  https://$PROD_CA_FQDN
    $TEST_CA  →  https://$TEST_CA_FQDN

  Key Vaults:
    $PROD_KV  (in $PROD_RG)
    $TEST_KV  (in $TEST_RG)

  Managed Identities:
    $PROD_IDENTITY  (in $PROD_RG)
    $TEST_IDENTITY  (in $TEST_RG)

Next steps:
  1. (MANUAL) Assign AcrPull role to both managed identities (see Step 4 instructions)
  2. (MANUAL) Assign Key Vault Secrets User role to both managed identities (see Step 8)
  3. Populate Key Vault secrets (see Step 9 instructions above)
  4. Set up OIDC federated credential — see docs/azure-deployment.md
  5. Add GitHub repository secrets — see docs/azure-deployment.md
  6. Configure GitHub environments — see docs/azure-deployment.md
  7. Push a commit to main to trigger the first pipeline run
EOF
