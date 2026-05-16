import { type FastifyInstance, type FastifyReply } from 'fastify';
import { getEnv } from '@support-agent/config';
import {
  computeClientHash,
  getCallbackUrl,
  getConfigUrl,
  isSsoConfigured,
} from '../lib/uoa.js';
import {
  STATE_COOKIE,
  clearStateCookie,
  verifyStateCookie,
} from '../lib/sso-state-cookie.js';
import { setSessionCookie } from '../lib/session-cookie.js';
import {
  UoaTokenVerificationError,
  decodeUoaAccessTokenForDev,
  redactUoaToken,
  verifyUoaAccessToken,
  type UoaAccessTokenClaims,
  type UoaTokenResponse,
} from '../lib/uoa-token.js';
import { recordAuditEvent } from '../services/audit-service.js';

export const PROVIDER_KEY = 'unlikeotherai';

function redirectWithError(
  reply: FastifyReply,
  adminUrl: string,
  errorCode: string,
): FastifyReply {
  return reply.redirect(`${adminUrl}/login?error=${encodeURIComponent(errorCode)}`);
}

async function logFailedLogin(
  app: FastifyInstance,
  tenantId: string | null,
  externalUserId: string | null,
  errorCode: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await recordAuditEvent(app.prisma, {
    tenantId: tenantId ?? 'unknown',
    actorId: externalUserId,
    actorType: 'federated_user',
    action: 'login_failed',
    resourceType: 'federated_identity_link',
    resourceId: externalUserId ?? 'unknown',
    metadata: { provider: PROVIDER_KEY, errorCode, ...metadata },
  });
}

/**
 * SSO callback handler. Exchanges the UOA `code` for a token, verifies the
 * access_token end-to-end against UOA's JWKS, resolves (or refuses to resolve)
 * a tenant, persists the federated identity link, persists the refresh token,
 * sets an HttpOnly session cookie, and redirects to a clean admin URL.
 *
 * The session JWT never appears in a query string. See finding H1.
 */
export function registerCallbackRoute(app: FastifyInstance): void {
  app.get<{ Params: { key: string }; Querystring: Record<string, string> }>(
    '/providers/:key/callback',
    async (request, reply) => {
      const env = getEnv();
      const { key } = request.params;
      const { code, error } = request.query;
      const adminUrl = env.ADMIN_APP_URL;

      if (key !== PROVIDER_KEY || !isSsoConfigured()) {
        return reply.status(404).send({ error: 'Unknown provider' });
      }

      if (error) {
        clearStateCookie(reply);
        await logFailedLogin(app, null, null, 'provider_error', { providerError: error });
        return redirectWithError(reply, adminUrl, error);
      }

      if (!code) {
        clearStateCookie(reply);
        await logFailedLogin(app, null, null, 'missing_code');
        return redirectWithError(reply, adminUrl, 'missing_code');
      }

      if (!env.UOA_CLIENT_SECRET || !env.UOA_CLIENT_SECRET.startsWith('uoa_sec_')) {
        // Integration has not been approved yet; the Phase-1 claim link has
        // not been consumed. Surface a deterministic error.
        clearStateCookie(reply);
        await logFailedLogin(app, null, null, 'integration_pending');
        return redirectWithError(reply, adminUrl, 'integration_pending');
      }

      const stateCookie = request.cookies[STATE_COOKIE];
      if (!stateCookie) {
        await logFailedLogin(app, null, null, 'missing_state');
        return redirectWithError(reply, adminUrl, 'missing_state');
      }

      const state = await verifyStateCookie(env.JWT_SECRET, stateCookie);
      clearStateCookie(reply);
      if (!state || state.providerKey !== key) {
        await logFailedLogin(app, null, null, 'invalid_state');
        return redirectWithError(reply, adminUrl, 'invalid_state');
      }

      /* ── Exchange code for token ─────────────────────────────────────── */
      const callbackUrl = getCallbackUrl(env.API_BASE_URL, PROVIDER_KEY);
      const configUrl = getConfigUrl(env.API_BASE_URL);
      const clientHash = computeClientHash(env.SSO_DOMAIN, env.UOA_CLIENT_SECRET);

      const tokenUrl = new URL('/auth/token', env.SSO_BASE_URL);
      tokenUrl.searchParams.set('config_url', configUrl);

      let token: UoaTokenResponse;
      try {
        const res = await fetch(tokenUrl.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clientHash}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            redirect_url: callbackUrl,
            code_verifier: state.codeVerifier,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`status ${res.status}: ${text.slice(0, 512)}`);
        }
        token = (await res.json()) as UoaTokenResponse;
      } catch (err) {
        app.log.error({ err }, 'UOA token exchange failed');
        await logFailedLogin(app, null, null, 'token_exchange_failed');
        return redirectWithError(reply, adminUrl, 'token_exchange_failed');
      }

      /* ── Verify access_token end-to-end ──────────────────────────────── */
      let claims: UoaAccessTokenClaims;
      try {
        if (env.NODE_ENV === 'production') {
          claims = await verifyUoaAccessToken(token.access_token);
        } else {
          // Local dev against a UOA stub without JWKS — never executes in prod.
          try {
            claims = await verifyUoaAccessToken(token.access_token);
          } catch {
            claims = decodeUoaAccessTokenForDev(token.access_token);
          }
        }
      } catch (err) {
        // Redact before logging — finding H-1.
        app.log.error(
          {
            err: err instanceof Error ? err.message : String(err),
            cause:
              err instanceof UoaTokenVerificationError && err.cause instanceof Error
                ? err.cause.message
                : undefined,
            token: redactUoaToken(token),
          },
          'UOA access_token failed verification',
        );
        await logFailedLogin(app, null, null, 'invalid_token');
        return redirectWithError(reply, adminUrl, 'invalid_token');
      }

      const externalUserId = typeof claims.sub === 'string' ? claims.sub : '';
      if (!externalUserId) {
        app.log.error({ token: redactUoaToken(token) }, 'UOA access_token missing sub claim');
        await logFailedLogin(app, null, null, 'invalid_token');
        return redirectWithError(reply, adminUrl, 'invalid_token');
      }

      const email = typeof claims.email === 'string' ? claims.email : '';
      const displayName = email.split('@')[0] || externalUserId;

      /* ── Tenant resolution ───────────────────────────────────────────── */
      // No `'default'` fallback. A federated identity with no org membership
      // must be queued for explicit admin attachment. Finding H4.
      const firstOrg = token.firstLogin?.memberships?.orgs?.[0];
      if (!firstOrg?.orgId) {
        app.log.warn(
          { externalUserId, email, token: redactUoaToken(token) },
          'SSO login refused: no tenant assigned',
        );
        await logFailedLogin(app, null, externalUserId, 'no_tenant', { email });
        return redirectWithError(reply, adminUrl, 'no_tenant');
      }
      const tenantId = firstOrg.orgId;

      // Local role mapping owned by the relying party. Treat UOA's
      // org-membership role as our local role, but refuse to inherit the
      // UOA-platform `role` claim from `claims.role`. Finding H5.
      const role = firstOrg.role ?? 'member';
      const orgName = email.split('@')[1] ?? 'My Organization';

      /* ── Persist identity provider, link, and refresh token ──────────── */
      let idp = await app.prisma.identityProvider.findFirst({
        where: { tenantId, providerType: PROVIDER_KEY },
      });

      let isNewIdp = false;
      if (!idp) {
        idp = await app.prisma.identityProvider.create({
          data: {
            tenantId,
            providerType: PROVIDER_KEY,
            displayName: orgName,
            config: { baseUrl: env.SSO_BASE_URL },
            isEnabled: true,
          },
        });
        isNewIdp = true;
      }

      const existingLink = await app.prisma.federatedIdentityLink.findFirst({
        where: { identityProviderId: idp.id, externalUserId },
      });

      let isNewLink = false;
      let link;
      if (!existingLink) {
        link = await app.prisma.federatedIdentityLink.create({
          data: {
            identityProviderId: idp.id,
            externalUserId,
            internalUserId: externalUserId,
            email: email || null,
            displayName: displayName || null,
          },
        });
        isNewLink = true;
      } else {
        link = await app.prisma.federatedIdentityLink.update({
          where: { id: existingLink.id },
          data: {
            email: email || null,
            displayName: displayName || null,
          },
        });
      }

      // Persist UOA refresh token if present.
      // TODO(secrets-encryption): the `ciphertext` column currently stores the
      // raw refresh token. The secrets-encryption sibling agent owns the
      // shared cipher primitive — wrap reads/writes through it once it lands.
      if (typeof token.refresh_token === 'string' && token.refresh_token.length > 0) {
        const expiresAt = token.refresh_token_expires_in
          ? new Date(Date.now() + token.refresh_token_expires_in * 1000)
          : null;
        await app.prisma.federatedIdentityRefreshToken.create({
          data: {
            federatedIdentityLinkId: link.id,
            ciphertext: token.refresh_token,
            expiresAt,
          },
        });
      }

      /* ── Audit ───────────────────────────────────────────────────────── */
      if (isNewIdp) {
        await recordAuditEvent(app.prisma, {
          tenantId,
          actorId: externalUserId,
          actorType: 'federated_user',
          action: 'account_created',
          resourceType: 'identity_provider',
          resourceId: idp.id,
          metadata: { providerType: PROVIDER_KEY, orgName },
        });
      }
      if (isNewLink) {
        await recordAuditEvent(app.prisma, {
          tenantId,
          actorId: externalUserId,
          actorType: 'federated_user',
          action: 'identity_attached',
          resourceType: 'federated_identity_link',
          resourceId: link.id,
          metadata: { providerType: PROVIDER_KEY, email },
        });
      }
      await recordAuditEvent(app.prisma, {
        tenantId,
        actorId: externalUserId,
        actorType: 'federated_user',
        action: 'login_succeeded',
        resourceType: 'federated_identity_link',
        resourceId: link.id,
        metadata: { providerType: PROVIDER_KEY, email, role },
      });

      /* ── Mint session JWT and set HttpOnly cookie ────────────────────── */
      const jwt = app.jwt.sign({ sub: externalUserId, tenantId, role }, { expiresIn: '24h' });
      setSessionCookie(reply, jwt);

      // Redirect to a clean URL — no token, no email, no userId in the query.
      // The admin app reads identity via `/v1/auth/me`. Finding H1.
      const redirectUrl = new URL('/auth/callback', adminUrl);
      return reply.redirect(redirectUrl.toString());
    },
  );
}
