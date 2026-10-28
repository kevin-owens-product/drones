# ADR 0008: OIDC, Keycloak in development, CAC/PIV in production

Status: Accepted
Date: 2026-10-28

## Context

Production authentication is a CAC or PIV presented to an enterprise IdP. This repo cannot ship a DoD PKI. It still has to speak the protocol that IdP will speak.

## Decision

The API accepts OIDC tokens. Verification checks signature (RS256 or ES256 only), issuer, audience, and expiry. The only claim read is `sub`. Clearance, citizenship, and need-to-know come from the personnel row.

Development runs Keycloak realm `a2e-dev` with authorization code and PKCE on the public client `a2e-ui`. The confidential client's direct-access grant exists only in that realm so engineers can script a token. Production Helm does not deploy Keycloak (`keycloak.enabled` defaults false).

`A2E_AUTH_MODE=test` signs local tokens for automated tests. Settings refuse to start if `A2E_ENV=production` and the auth mode is `test`. The dev-login route is not mounted in production.

`# STUB:` there is no PIV/CAC broker container. The production IdP is expected to perform PIV authentication and mint the OIDC token. MFA is therefore not demonstrated by this compose file.

## Consequences

A forged `clearance` claim does nothing. A disabled personnel row cannot use a still-valid token. Access tokens in the dev realm live eight hours so a demo is usable; production lifetime is the enterprise IdP's setting, and the API enforces whatever `exp` it receives. Refresh tokens are `# STUB` (re-authenticate when the access token expires).
