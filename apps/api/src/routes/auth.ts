import { type FastifyInstance } from 'fastify';
import { getEnv } from '@support-agent/config';
import {
  createPkcePair,
  getCallbackUrl,
  getConfigUrl,
  getJwksUrl,
  isSsoConfigured,
  signConfigJwt,
} from '../lib/uoa.js';
import {
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  STATE_TTL_SECONDS,
  signStateCookie,
} from '../lib/sso-state-cookie.js';
import {
  clearSessionCookie,
  setSessionCookie,
} from '../lib/session-cookie.js';
import { registerCallbackRoute, PROVIDER_KEY } from './auth-callback.js';

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
  /* GET /dev-login — mint a dev JWT and set the session cookie. */
  app.get('/dev-login', async (_request, reply) => {
    const env = getEnv();

    if (env.NODE_ENV === 'production' || env.UOA_CLIENT_SECRET) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const userId = '00000000-0000-0000-0000-000000000001';
    const tenantId = '00000000-0000-0000-0000-000000000002';

    const token = app.jwt.sign({ sub: userId, tenantId, role: 'admin' }, { expiresIn: '24h' });
    setSessionCookie(reply, token);

    return {
      userId,
      displayName: 'Dev User',
      email: 'dev@localhost',
      avatarUrl: null,
      role: 'admin',
    };
  });

  /* GET /providers — list identity providers. */
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

  /* GET /providers/:key/callback — split into its own module for clarity. */
  registerCallbackRoute(app);

  /* GET /me — identity for the current session.
     Backs the admin app's authenticated identity read. The JWT is resolved
     from either the `__Host-abb_session` cookie or `Authorization: Bearer`. */
  app.get('/me', async (request, reply) => {
    try {
      await request.authenticate();
    } catch {
      return reply.status(401).send({ error: 'unauthenticated' });
    }

    const { sub, tenantId, role } = request.user;

    // Resolve the federated identity (if any) for richer display fields.
    const link = await app.prisma.federatedIdentityLink.findFirst({
      where: { internalUserId: sub },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      userId: sub,
      tenantId,
      role,
      displayName: link?.displayName ?? sub,
      email: link?.email ?? '',
      avatarUrl: null,
    };
  });

  /* POST /logout — clear the session cookie. */
  app.post('/logout', async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });
}
