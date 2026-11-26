# Strap MCP

Strap exposes a Streamable HTTP MCP server backed by the same Neon data used by the dashboard.

## Endpoint and identity

- MCP endpoint: `https://strap60.vercel.app/api/mcp`
- Protected-resource metadata: `https://strap60.vercel.app/.well-known/oauth-protected-resource/api/mcp`
- OAuth issuer: the production Neon Auth base URL configured as `NEON_AUTH_BASE_URL`
- Brand icon: `https://strap60.vercel.app/favicon.svg`
- OAuth sign-in page: `https://strap60.vercel.app/mcp-login.html`
- OAuth consent page: `https://strap60.vercel.app/mcp-consent.html`

Neon Auth is configured as the OAuth 2.1 authorization server. Client ID Metadata Documents are enabled and legacy dynamic client registration is disabled. The user signs in on Strap's hosted page, selects read/write permissions and allowed branches, then approves the connection on the hosted consent page. Claude's published OAuth identity is discovered through Client ID Metadata Documents; no client ID setup is required.

## Current rollout state

The production Neon Auth OAuth 2.1 provider is enabled for the Strap MCP resource. The app exposes a protected-resource metadata endpoint at the URL above and verifies Neon Auth JWT signatures against the production JWKS, including exact issuer, audience, expiry, and account checks. Keep this rollout marked as pending until the production deployment is live and a real Claude or MCP Inspector OAuth connection has passed the checklist below.

## Permissions

There are two supported connection types:

1. **OAuth connection** — the user approves the app from Strap's hosted consent screen, choosing read-only or read/write access and one or more branches (or all branches). After the client makes its first successful MCP request, it appears in Dashboard → Settings → MCP with its registered app name and icon (when supplied by the client). The owner can change permissions or branch access, or revoke it.
2. **Strap access token** — generated from Dashboard → Settings → MCP. Tokens are unique, stored as SHA-256 hashes, shown once, and can be revoked. Start read-only and only grant write access when necessary.

All access is Premium-gated. Tokens are tied to the authenticated owner. Branch permissions are checked on every tool call. OAuth tokens must match the exact Neon Auth issuer, exact MCP audience, signature, and expiry. The server never accepts a user ID from tool arguments.

## Available tools

Read:
- `strap_whoami`
- `strap_get_store_profile`
- `strap_list_branches`
- `strap_search_products`
- `strap_get_low_stock`
- `strap_get_sales`
- `strap_search_customers`

Write (only when `store:write` is explicitly granted):
- `strap_create_product`
- `strap_update_product`
- `strap_set_branch_stock`
- `strap_upload_product_image` (JPG, PNG, WEBP or GIF; maximum 3 MB)

Write access is intentionally limited to product and stock operations. The MCP server does not expose payment, refund, staff, customer deletion, or account deletion actions.

## Data and audit

- App data is read from and written to the owner's Neon `user_data.blob` records.
- Product reads/writes use the selected branch's `ls:strap.f1.items.<branchId>` key.
- Product images are stored in the existing Neon `media` table (`bytea`) and the product image URL is updated in the same transaction; raw image bytes are never written to the audit log.
- Sales and customers are filtered to the branches granted to the connection.
- Every tool call is recorded in `strap_mcp_audit_log`; access tokens store only a hash, never the raw token.
- OAuth grants are recorded in `strap_mcp_oauth_grants` and can be revoked in Strap settings.

## Client setup

For OAuth-capable clients, copy the remote MCP URL from Dashboard → Settings → MCP, add it as a custom/remote MCP server in the AI app, and select Connect. The browser opens Strap's sign-in page if needed, then the Strap consent screen where the owner selects permissions and branches and approves. The app appears under Connected apps in Strap settings after its first successful MCP request.

For clients that accept a custom bearer header, generate an access token in Strap and configure:

```json
{
  "url": "https://strap60.vercel.app/api/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_STRAP_ACCESS_TOKEN"
  }
}
```

Never commit tokens to source control or paste them into public chats. Revoke a token immediately if it is exposed.

## Production verification checklist

- [ ] Vercel production deployment includes the MCP route, auth proxy, OAuth pages, protected-resource metadata handler, and settings UI.
- [ ] Protected-resource metadata returns the exact production MCP URL and Neon Auth issuer.
- [ ] OAuth discovery works and the issuer matches the production Neon Auth base URL.
- [ ] Complete a real OAuth login and consent flow with Claude or MCP Inspector.
- [ ] Confirm `strap_whoami`, `strap_list_branches`, and `strap_search_products` return only the signed-in owner's data.
- [ ] Confirm a branch-limited connection cannot read another branch.
- [ ] Confirm read-only connections cannot invoke write tools.
- [ ] Confirm enabling write access permits only product and stock tools.
- [ ] Confirm revoking either connection blocks subsequent MCP calls.
- [ ] Confirm the MCP server advertises the Strap favicon.

Do not mark MCP production-ready until this checklist has been exercised against the deployed production URL.
