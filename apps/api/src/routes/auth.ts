import crypto from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from '@support-agent/config';

/* ── SSO helpers ──────────────────────────────────────────── */

function getDomainHash(domain: string, secret: string): string {
  return crypto.createHash('sha256').update(domain + secret).digest('hex');
}

function getConfigUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl}/v1/auth/sso-config`;
}

async function ssoFetch<T>(
  path: string,
  opts: {
    baseUrl: string;
    domain: string;
    secret: string;
    configUrl: string;
    method?: 'GET' | 'POST';
    body?: unknown;
    includeDomain?: boolean;
  },
): Promise<T> {
  const url = new URL(path, opts.baseUrl);
  url.searchParams.set('config_url', opts.configUrl);
  if (opts.includeDomain !== false) {
    url.searchParams.set('domain', opts.domain);
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${getDomainHash(opts.domain, opts.secret)}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SSO ${path} failed (${res.status}): ${text}`);
  }

  return (await res.json()) as T;
}

function getString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = record[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return null;
}

/* ── Routes ───────────────────────────────────────────────── */

export async function authRoutes(app: FastifyInstance) {
  /* GET /dev-login — mint a dev JWT; only active in non-production without SSO */
  app.get('/dev-login', async (_request, reply) => {
    const env = getEnv();

    if (env.NODE_ENV === 'production' || env.SSO_SHARED_SECRET) {
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

  /* GET /providers — list available identity providers */
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

    if (env.SSO_SHARED_SECRET) {
      providers.push({
        key: 'unlikeotherai',
        label: 'UnlikeOtherAI',
        buttonText: 'Sign in with SSO',
        kind: 'oauth',
        iconUrl: null,
        startUrl: `${env.API_BASE_URL}/v1/auth/providers/unlikeotherai/start`,
        enabled: true,
      });
    }

    return { providers };
  });

  /* GET /sso-config — JWT config consumed by the SSO service */
  app.get('/sso-config', async (request, reply) => {
    const env = getEnv();
    if (!env.SSO_SHARED_SECRET) {
      return reply.status(404).send({ error: 'SSO not configured' });
    }

    const secret = new TextEncoder().encode(env.SSO_SHARED_SECRET);
    const callbackUrl = `${env.API_BASE_URL}/v1/auth/providers/unlikeotherai/callback`;

    const token = await new SignJWT({
      domain: env.SSO_DOMAIN,
      redirect_urls: [callbackUrl],
      enabled_auth_methods: ['email_password', 'google'],
      allowed_social_providers: ['google'],
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
          font_import_url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
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
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(env.SSO_IDENTIFIER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);

    reply.header('Content-Type', 'text/plain');
    return token;
  });

  /* GET /providers/:key/start — redirect to SSO auth UI */
  app.get<{ Params: { key: string } }>('/providers/:key/start', async (request, reply) => {
    const env = getEnv();
    const { key } = request.params;

    if (key !== 'unlikeotherai' || !env.SSO_SHARED_SECRET) {
      return reply.status(404).send({ error: 'Unknown provider' });
    }

    const callbackUrl = `${env.API_BASE_URL}/v1/auth/providers/unlikeotherai/callback`;
    const configUrl = getConfigUrl(env.API_BASE_URL);

    const authUrl = new URL('/auth', env.SSO_BASE_URL);
    authUrl.searchParams.set('config_url', configUrl);
    authUrl.searchParams.set('redirect_url', callbackUrl);
    authUrl.searchParams.set('state', JSON.stringify({ next: '/' }));

    return reply.redirect(authUrl.toString());
  });

  /* GET /providers/:key/callback — exchange code, mint JWT, redirect to admin */
  app.get<{ Params: { key: string }; Querystring: Record<string, string> }>(
    '/providers/:key/callback',
    async (request, reply) => {
      const env = getEnv();
      const { key } = request.params;
      const { code, error } = request.query;

      if (key !== 'unlikeotherai' || !env.SSO_SHARED_SECRET) {
        return reply.status(404).send({ error: 'Unknown provider' });
      }

      const adminUrl = env.ADMIN_APP_URL;

      if (error) {
        return reply.redirect(`${adminUrl}/login?error=${encodeURIComponent(error)}`);
      }

      if (!code) {
        return reply.redirect(`${adminUrl}/login?error=missing_code`);
      }

      const configUrl = getConfigUrl(env.API_BASE_URL);

      // Exchange authorization code for access token JWT
      let tokenData: { access_token: string };
      try {
        tokenData = await ssoFetch<{ access_token: string }>('/auth/token', {
          baseUrl: env.SSO_BASE_URL,
          domain: env.SSO_DOMAIN,
          secret: env.SSO_SHARED_SECRET,
          configUrl,
          method: 'POST',
          includeDomain: false,
          body: { code, grant_type: 'authorization_code' },
        });
      } catch (err) {
        app.log.error({ err }, 'SSO token exchange failed');
        return reply.redirect(`${adminUrl}/login?error=token_exchange_failed`);
      }

      // Verify the access token JWT with shared secret
      const secret = new TextEncoder().encode(env.SSO_SHARED_SECRET);
      let payload: Record<string, unknown>;
      try {
        const result = await jwtVerify(tokenData.access_token, secret);
        payload = result.payload as Record<string, unknown>;
      } catch (err) {
        app.log.error({ err }, 'SSO token verification failed');
        return reply.redirect(`${adminUrl}/login?error=invalid_token`);
      }

      const externalUserId = String(payload.sub ?? '');
      const email = getString(payload, ['email']) ?? '';
      const displayName = getString(payload, ['name', 'displayName']) ?? email.split('@')[0];
      const avatarUrl = getString(payload, ['picture', 'avatar', 'avatar_url', 'avatarUrl']) ?? '';
      const orgPayload = payload.org as {
        org_id?: string;
        org_role?: string;
        org_name?: string;
      } | undefined;
      const tenantId = orgPayload?.org_id ?? 'default';
      const role = orgPayload?.org_role ?? 'member';
      const orgName = orgPayload?.org_name ?? email.split('@')[1] ?? 'My Organization';

      // Find or create identity provider record (acts as tenant record)
      let idp = await app.prisma.identityProvider.findFirst({
        where: { tenantId, providerType: 'unlikeotherai' },
      });

      if (!idp) {
        idp = await app.prisma.identityProvider.create({
          data: {
            tenantId,
            providerType: 'unlikeotherai',
            displayName: orgName,
            config: { baseUrl: env.SSO_BASE_URL },
            isEnabled: true,
          },
        });
      }

      // Upsert federated identity link
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

      // Mint our own JWT for the admin app
      const jwt = app.jwt.sign(
        { sub: externalUserId, tenantId, role },
        { expiresIn: '24h' },
      );

      // Redirect to admin app with auth data
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
