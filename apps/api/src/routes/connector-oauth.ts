import { type FastifyInstance } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from '@support-agent/config';
import { createConnectorRepository } from '../repositories/connector-repository.js';
import { createConnectorService } from '../services/connector-service.js';
import { OAUTH_PLATFORM_MAP, getOAuthCredentials } from '../lib/oauth-platforms.js';

export async function connectorOAuthRoutes(app: FastifyInstance) {
  const repo = createConnectorRepository(app.prisma);
  const service = createConnectorService(repo, app.prisma);

  /**
   * GET /v1/connector-oauth/:platformKey/start?connectorId=<id>
   *
   * Authenticated. Verifies the connector belongs to the caller,
   * signs a short-lived state JWT, builds the provider's authorize URL,
   * and returns it as JSON. The frontend does window.location.href = redirectUrl.
   */
  app.get<{
    Params: { platformKey: string };
    Querystring: { connectorId: string };
  }>('/:platformKey/start', async (request, reply) => {
    await request.authenticate();
    const { platformKey } = request.params;
    const { connectorId } = request.query;
    const { tenantId } = request.user;

    const oauthConfig = OAUTH_PLATFORM_MAP[platformKey];
    if (!oauthConfig) {
      return reply.status(404).send({ error: 'OAuth not supported for this platform' });
    }

    const env = getEnv();
    const creds = getOAuthCredentials(platformKey, env);
    if (!creds) {
      return reply.status(503).send({ error: 'OAuth credentials not configured on server' });
    }

    // Verify the connector belongs to this tenant before issuing the flow
    await service.getConnector(connectorId, tenantId);

    const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
    const state = await new SignJWT({ connectorId, tenantId, platformKey })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(jwtSecret);

    const callbackUrl = `${env.API_BASE_URL}/v1/connector-oauth/${platformKey}/callback`;
    const url = new URL(oauthConfig.authorizeUrl);
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', oauthConfig.scopes.join(' '));
    url.searchParams.set('state', state);

    return { redirectUrl: url.toString() };
  });

  /**
   * GET /v1/connector-oauth/:platformKey/callback?code=&state=
   *
   * Public — the provider redirects here after the user authorizes.
   * Verifies the signed state, exchanges the code for an access token,
   * stores it as the connector secret, then redirects to the admin
   * configure page.
   */
  app.get<{
    Params: { platformKey: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>('/:platformKey/callback', async (request, reply) => {
    const { platformKey } = request.params;
    const { code, state, error } = request.query;
    const env = getEnv();
    const adminUrl = env.ADMIN_APP_URL;

    const oauthConfig = OAUTH_PLATFORM_MAP[platformKey];
    if (!oauthConfig) {
      return reply.redirect(`${adminUrl}/apps?oauth_error=unknown_platform`);
    }

    if (error || !code || !state) {
      const msg = encodeURIComponent(error ?? 'missing_params');
      return reply.redirect(`${adminUrl}/apps?oauth_error=${msg}`);
    }

    const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
    let payload: { connectorId: string; tenantId: string; platformKey: string };
    try {
      const result = await jwtVerify(state, jwtSecret);
      payload = result.payload as typeof payload;
    } catch {
      return reply.redirect(`${adminUrl}/apps?oauth_error=invalid_state`);
    }

    const { connectorId, tenantId } = payload;
    const creds = getOAuthCredentials(platformKey, env);
    if (!creds) {
      return reply.redirect(`${adminUrl}/apps?oauth_error=oauth_not_configured`);
    }

    const callbackUrl = `${env.API_BASE_URL}/v1/connector-oauth/${platformKey}/callback`;
    const tokenRes = await fetch(oauthConfig.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenRes.ok) {
      return reply.redirect(`${adminUrl}/apps?oauth_error=token_exchange_failed`);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      const msg = encodeURIComponent(tokenData.error ?? 'no_access_token');
      return reply.redirect(`${adminUrl}/apps?oauth_error=${msg}`);
    }

    try {
      await service.setConnectorSecret(connectorId, tenantId, 'api_key', tokenData.access_token);
    } catch {
      return reply.redirect(`${adminUrl}/apps?oauth_error=secret_store_failed`);
    }

    return reply.redirect(
      `${adminUrl}/apps/${platformKey}/configure/${connectorId}?oauth=success`,
    );
  });
}
