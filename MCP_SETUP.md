# Strap MCP

Strap exposes a Streamable HTTP MCP server backed by the same Neon data used by the dashboard.

## Endpoint and identity

- MCP endpoint: `https://strap60.vercel.app/api/mcp`
- Protected-resource metadata: `https://strap60.vercel.app/.well-known/oauth-protected-resource/api/mcp`
- OAuth issuer: the production Neon Auth base URL configured as `NEON_AUTH_BASE_URL`
- Brand icon: `https://strap60.vercel.app/favicon.svg`
- OAuth sign-in page: `https://strap60.vercel.app/mcp-login.html`
- OAuth consent page: `https://strap60.vercel.app/mcp-consent.html`

Neon Auth is configured as the OAuth 2.1 authorization server. Client ID Metadata Documents are enabled and legacy dynamic client registration is disabled. The user must sign in and approve the connection.

## Current rollout state

The Neon OAuth provider settings and production grant tables are prepared, but OAuth is intentionally **disabled** until Vercel deploys the latest MCP auth proxy, consent page, protected-resource metadata rewrite, and JWT verification code. Do not enable OAuth or call the OAuth flow production-ready before those files are live and the end-to-end checks below pass. Existing bearer-token MCP access remains separate.

## Permissions

There are two supported connection types:

1. **OAuth connection** — read-only access to the user's active branch by default. After the client makes its first successful MCP request, it appears in Dashboard → Settings → MCP. The owner can change its branch access and enable product/stock writes, or revoke it.
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

For OAuth-capable clients, add the remote MCP URL above and complete the Strap sign-in/approval flow.

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

- [ ] Vercel production deployment includes the MCP route, auth proxy, OAuth pages, metadata rewrite, and settings UI.
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
