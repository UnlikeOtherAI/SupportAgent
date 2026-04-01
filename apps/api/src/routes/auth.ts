import { type FastifyInstance } from 'fastify';
import { getEnv } from '@support-agent/config';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
}

interface UserInfoResponse {
  id: string;
  email?: string;
  displayName?: string;
  name?: string;
  avatarUrl?: string;
  avatar?: string;
  role?: string;
  organisationId?: string;
}

export async function authRoutes(app: FastifyInstance) {
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

    if (env.AUTH_PROVIDER_URL) {
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

  /* GET /providers/:key/start — redirect to external OAuth */
  app.get<{ Params: { key: string } }>('/providers/:key/start', async (request, reply) => {
    const env = getEnv();
    const { key } = request.params;

    if (key !== 'unlikeotherai' || !env.AUTH_PROVIDER_URL) {
      return reply.status(404).send({ error: 'Unknown provider' });
    }

    const callbackUrl = `${env.API_BASE_URL}/v1/auth/providers/unlikeotherai/callback`;
    const authUrl = new URL('/auth', env.AUTH_PROVIDER_URL);
    authUrl.searchParams.set('redirect_url', callbackUrl);
    if (env.AUTH_CLIENT_ID) {
      authUrl.searchParams.set('client_id', env.AUTH_CLIENT_ID);
    }

    return reply.redirect(authUrl.toString());
  });

  /* GET /providers/:key/callback — exchange code, mint JWT, redirect to admin */
  app.get<{ Params: { key: string }; Querystring: Record<string, string> }>(
    '/providers/:key/callback',
    async (request, reply) => {
      const env = getEnv();
      const { key } = request.params;
      const { code, token: directToken, error } = request.query;

      if (key !== 'unlikeotherai' || !env.AUTH_PROVIDER_URL) {
        return reply.status(404).send({ error: 'Unknown provider' });
      }

      const adminUrl = env.ADMIN_APP_URL;

      if (error) {
        return reply.redirect(`${adminUrl}/login?error=${encodeURIComponent(error)}`);
      }

      let accessToken: string;

      if (directToken) {
        // Implicit flow — token returned directly
        accessToken = directToken;
      } else if (code) {
        // Authorization code flow — exchange code for tokens
        const tokenRes = await fetch(`${env.AUTH_PROVIDER_URL}/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            client_id: env.AUTH_CLIENT_ID,
            client_secret: env.AUTH_CLIENT_SECRET,
            redirect_uri: `${env.API_BASE_URL}/v1/auth/providers/unlikeotherai/callback`,
          }),
        });

        if (!tokenRes.ok) {
          app.log.error(
            { status: tokenRes.status, body: await tokenRes.text() },
            'Token exchange failed',
          );
          return reply.redirect(`${adminUrl}/login?error=token_exchange_failed`);
        }

        const tokens = (await tokenRes.json()) as TokenResponse;
        accessToken = tokens.access_token;
      } else {
        return reply.redirect(`${adminUrl}/login?error=missing_code`);
      }

      // Fetch user info from auth provider
      const meRes = await fetch(`${env.AUTH_PROVIDER_URL}/org/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!meRes.ok) {
        app.log.error({ status: meRes.status }, 'User info fetch failed');
        return reply.redirect(`${adminUrl}/login?error=user_info_failed`);
      }

      const userInfo = (await meRes.json()) as UserInfoResponse;
      const externalUserId = userInfo.id;
      const tenantId = userInfo.organisationId ?? 'default';
      const displayName = userInfo.displayName ?? userInfo.name ?? '';
      const email = userInfo.email ?? '';
      const avatarUrl = userInfo.avatarUrl ?? userInfo.avatar ?? '';
      const role = userInfo.role ?? 'member';

      // Find or create identity provider record
      let idp = await app.prisma.identityProvider.findFirst({
        where: { tenantId, providerType: 'unlikeotherai' },
      });

      if (!idp) {
        idp = await app.prisma.identityProvider.create({
          data: {
            tenantId,
            providerType: 'unlikeotherai',
            displayName: 'UnlikeOtherAI SSO',
            config: { providerUrl: env.AUTH_PROVIDER_URL },
            isEnabled: true,
          },
        });
      }

      // Upsert federated identity link
      const existingLink = await app.prisma.federatedIdentityLink.findFirst({
        where: { identityProviderId: idp.id, externalUserId },
      });

      let onboardingRequired = false;

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
        onboardingRequired = true;
      } else {
        await app.prisma.federatedIdentityLink.update({
          where: { id: existingLink.id },
          data: {
            email: email || null,
            displayName: displayName || null,
          },
        });
      }

      // Mint our own JWT
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
      redirectUrl.searchParams.set('onboardingRequired', String(onboardingRequired));

      return reply.redirect(redirectUrl.toString());
    },
  );
}
