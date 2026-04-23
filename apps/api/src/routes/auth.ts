import { type FastifyInstance, type FastifyReply } from 'fastify';
import { SignJWT, decodeJwt, jwtVerify } from 'jose';
import { getEnv } from '@support-agent/config';
import {
  computeClientHash,
  createPkcePair,
  getCallbackUrl,
  getConfigUrl,
  getJwksUrl,
  isSsoConfigured,
  signConfigJwt,
} from '../lib/uoa.js';

const PROVIDER_KEY = 'unlikeotherai';
// `__Host-` requires Path=/, so we use `__Secure-` to scope the cookie to
// the callback route only. Both prefixes enforce HTTPS-only delivery.
const STATE_COOKIE = '__Secure-sso_state';
const STATE_COOKIE_PATH = '/v1/auth/providers';
const STATE_TTL_SECONDS = 600;

interface SsoStatePayload {
  codeVerifier: string;
  next: string;
  providerKey: string;
}

interface UoaOrgMembership {
  orgId?: string;
  role?: string;
}

interface UoaTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  // Present on authorization_code exchange when org_features.enabled=true.
  // Field names inside `firstLogin` are camelCase even though the outer
  // response is snake_case — this is UOA's canonical shape.
  firstLogin?: {
    memberships?: {
      orgs?: UoaOrgMembership[];
      teams?: Array<{ teamId?: string; orgId?: string; role?: string }>;
    };
    pending_invites?: unknown[];
    capabilities?: { can_create_org?: boolean; can_accept_invite?: boolean };
  };
}

interface UoaAccessTokenClaims {
  sub?: string;
  email?: string;
  role?: string;
  domain?: string;
  client_id?: string;
  iss?: string;
  aud?: string;
}

/* ── State cookie helpers ─────────────────────────────────────────────── */

async function signStateCookie(
  secret: string,
  payload: SsoStatePayload,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(key);
}

async function verifyStateCookie(
  secret: string,
  token: string,
): Promise<SsoStatePayload | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    const { codeVerifier, next, providerKey } = payload as Record<string, unknown>;
    if (typeof codeVerifier !== 'string' || typeof next !== 'string' || typeof providerKey !== 'string') {
      return null;
    }
    return { codeVerifier, next, providerKey };
  } catch {
    return null;
  }
}

function clearStateCookie(reply: FastifyReply) {
  reply.setCookie(STATE_COOKIE, '', {
    path: STATE_COOKIE_PATH,
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function buildConfigJwtPayload() {
  const env = getEnv();
  return {
    domain: env.SSO_DOMAIN,
    jwks_url: getJwksUrl(env.API_BASE_URL),
    contact_email: env.UOA_CONTACT_EMAIL!,
    redirect_urls: [getCallbackUrl(env.API_BASE_URL, PROVIDER_KEY)],
    enabled_auth_methods: ['email_password', 'google'],
    org_features: {
      enabled: true,
      org_roles: ['owner', 'admin', 'member'],
      user_needs_team: false,
    },
    ui_theme: {
      colors: {
        bg: '#F6F7F8',
        surface: '#FFFFFF',
        text: '#111827',
        muted: '#6B7280',
        primary: '#10B981',
        primary_text: '#FFFFFF',
        border: '#E5E7EB',
        danger: '#EF4444',
        danger_text: '#FFFFFF',
      },
      radii: { card: '12px', button: '8px', input: '8px' },
      density: 'comfortable',
      button: { style: 'solid' },
      card: { style: 'shadow' },
      typography: {
        font_family: 'DM Sans',
        base_text_size: 'md',
        font_import_url:
          'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
      },
      logo: {
        url: '',
        alt: 'AppBuildBox',
        text: 'AppBuildBox',
        font_size: '18px',
        color: '#111827',
      },
    },
    language_config: 'en',
  };
}

/* ── Routes ───────────────────────────────────────────────────────────── */

export async function authRoutes(app: FastifyInstance) {
  /* GET /dev-login — mint a dev JWT; only active when SSO is not live. */
  app.get('/dev-login', async (_request, reply) => {
    const env = getEnv();

    // Offer dev login whenever the relying party cannot yet exchange real
    // tokens — i.e. non-production AND no claimed client secret. Once the
    // claim is in place the only entry point is the real SSO flow.
    if (env.NODE_ENV === 'production' || env.UOA_CLIENT_SECRET) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const userId = '00000000-0000-0000-0000-000000000001';
    const tenantId = '00000000-0000-0000-0000-000000000002';

    const token = app.jwt.sign(
      { sub: userId, tenantId, role: 'admin' },
      { expiresIn: '24h' },
    );

    return {
      token,
      userId,
      displayName: 'Dev User',
      email: 'dev@localhost',
      avatarUrl: null,
      role: 'admin',
    };
  });

  /* GET /providers — list identity providers. Surfaces during onboarding
     (before claim) so an operator can kick off auto-discovery. */
  app.get('/providers', async () => {
    const env = getEnv();
    const providers: Array<{
      key: string;
      label: string;
      buttonText: string;
      kind: string;
      iconUrl: string | null;
      startUrl: string;
      enabled: boolean;
    }> = [];

    if (isSsoConfigured()) {
      providers.push({
        key: PROVIDER_KEY,
        label: 'UnlikeOtherAI',
        buttonText: 'Sign in with SSO',
        kind: 'oauth',
        iconUrl: null,
        startUrl: `${env.API_BASE_URL}/v1/auth/providers/${PROVIDER_KEY}/start`,
        // Once UOA_CLIENT_SECRET lands the full login flow works end-to-end.
        // Before that the button still renders so the operator can trigger
        // Phase-1 auto-discovery.
        enabled: true,
      });
    }

    return { providers };
  });

  /* GET /sso-config — RS256-signed config JWT fetched by UOA. */
  app.get('/sso-config', async (_request, reply) => {
    if (!isSsoConfigured()) {
      return reply.status(404).send({ error: 'SSO not configured' });
    }

    const jwt = await signConfigJwt(buildConfigJwtPayload());
    reply.header('Content-Type', 'application/jwt');
    return jwt;
  });

  /* GET /providers/:key/start — PKCE + state cookie + redirect to UOA. */
  app.get<{ Params: { key: string }; Querystring: { next?: string } }>(
    '/providers/:key/start',
    async (request, reply) => {
      const env = getEnv();
      const { key } = request.params;
      const next = typeof request.query.next === 'string' ? request.query.next : '/';

      if (key !== PROVIDER_KEY || !isSsoConfigured()) {
        return reply.status(404).send({ error: 'Unknown provider' });
      }

      const callbackUrl = getCallbackUrl(env.API_BASE_URL, PROVIDER_KEY);
      const configUrl = getConfigUrl(env.API_BASE_URL);
      const { verifier, challenge } = createPkcePair();

      const stateToken = await signStateCookie(env.JWT_SECRET, {
        codeVerifier: verifier,
        next,
        providerKey: key,
      });

      // __Host- requires Secure + Path + no Domain. UOA redirects back via
      // the browser, so the browser replays this cookie on the callback.
      reply.setCookie(STATE_COOKIE, stateToken, {
        path: STATE_COOKIE_PATH,
        maxAge: STATE_TTL_SECONDS,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      });

      const authUrl = new URL('/auth', env.SSO_BASE_URL);
      authUrl.searchParams.set('config_url', configUrl);
      authUrl.searchParams.set('redirect_url', callbackUrl);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      return reply.redirect(authUrl.toString());
    },
  );

  /* GET /providers/:key/callback — exchange code server-to-server. */
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
        return reply.redirect(`${adminUrl}/login?error=${encodeURIComponent(error)}`);
      }

      if (!code) {
        clearStateCookie(reply);
        return reply.redirect(`${adminUrl}/login?error=missing_code`);
      }

      if (!env.UOA_CLIENT_SECRET || !env.UOA_CLIENT_SECRET.startsWith('uoa_sec_')) {
        // Integration has not been approved yet; the Phase-1 claim link has
        // not been consumed. (During onboarding the secret is deployed as a
        // placeholder to satisfy Cloud Run's version requirement.) Surface a
        // deterministic error instead of a cryptic 401 from `/auth/token`.
        clearStateCookie(reply);
        return reply.redirect(`${adminUrl}/login?error=integration_pending`);
      }

      const stateCookie = request.cookies[STATE_COOKIE];
      if (!stateCookie) {
        return reply.redirect(`${adminUrl}/login?error=missing_state`);
      }

      const state = await verifyStateCookie(env.JWT_SECRET, stateCookie);
      clearStateCookie(reply);
      if (!state || state.providerKey !== key) {
        return reply.redirect(`${adminUrl}/login?error=invalid_state`);
      }

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
        return reply.redirect(`${adminUrl}/login?error=token_exchange_failed`);
      }

      // UOA carries user identity inside the access_token JWT; the outer
      // body has no `user` field. The token arrived over our authenticated
      // backend channel (client_hash bearer on a TLS call to UOA), so we
      // trust the claims without re-verifying the HS256 signature — UOA
      // keeps the HMAC secret and does not publish it to relying parties.
      let claims: UoaAccessTokenClaims;
      try {
        claims = decodeJwt(token.access_token) as UoaAccessTokenClaims;
      } catch (err) {
        app.log.error({ err, token }, 'UOA access_token could not be decoded');
        return reply.redirect(`${adminUrl}/login?error=invalid_token`);
      }

      const externalUserId = typeof claims.sub === 'string' ? claims.sub : '';
      if (!externalUserId) {
        app.log.error({ claims }, 'UOA access_token missing sub claim');
        return reply.redirect(`${adminUrl}/login?error=invalid_token`);
      }

      const email = typeof claims.email === 'string' ? claims.email : '';
      const displayName = email.split('@')[0] || externalUserId;
      const avatarUrl = '';

      // UOA does not return org_name; fall back to the email domain. When
      // the user has no org membership yet, use 'default' so the request
      // still lands on a tenant record and the operator can complete setup.
      const firstOrg = token.firstLogin?.memberships?.orgs?.[0];
      const tenantId = firstOrg?.orgId ?? 'default';
      const role = firstOrg?.role ?? claims.role ?? 'member';
      const orgName = email.split('@')[1] ?? 'My Organization';

      // Find or create identity provider record (acts as tenant record).
      let idp = await app.prisma.identityProvider.findFirst({
        where: { tenantId, providerType: PROVIDER_KEY },
      });

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
      }

      const existingLink = await app.prisma.federatedIdentityLink.findFirst({
        where: { identityProviderId: idp.id, externalUserId },
      });

      if (!existingLink) {
        await app.prisma.federatedIdentityLink.create({
          data: {
            identityProviderId: idp.id,
            externalUserId,
            internalUserId: externalUserId,
            email: email || null,
            displayName: displayName || null,
          },
        });
      } else {
        await app.prisma.federatedIdentityLink.update({
          where: { id: existingLink.id },
          data: {
            email: email || null,
            displayName: displayName || null,
          },
        });
      }

      const jwt = app.jwt.sign(
        { sub: externalUserId, tenantId, role },
        { expiresIn: '24h' },
      );

      const redirectUrl = new URL('/auth/callback', adminUrl);
      redirectUrl.searchParams.set('token', jwt);
      redirectUrl.searchParams.set('userId', externalUserId);
      redirectUrl.searchParams.set('displayName', displayName);
      redirectUrl.searchParams.set('email', email);
      if (avatarUrl) redirectUrl.searchParams.set('avatarUrl', avatarUrl);
      redirectUrl.searchParams.set('role', role);
      redirectUrl.searchParams.set('onboardingRequired', 'false');

      return reply.redirect(redirectUrl.toString());
    },
  );
}
