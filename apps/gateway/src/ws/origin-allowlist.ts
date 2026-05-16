/**
 * Origin allowlist enforcement for the WS upgrade.
 *
 * `GATEWAY_ALLOWED_ORIGINS` is a comma-separated list of values that match
 * the request's `Origin` header. An empty list means "no allowlist" and is
 * only accepted outside production (the env parser refuses to start in
 * production with an empty list).
 */
export interface OriginPolicy {
  allowlist: string[];
  permissive: boolean;
}

export function parseOriginPolicy(
  raw: string,
  isProduction: boolean,
): OriginPolicy {
  const allowlist = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return {
    allowlist,
    permissive: !isProduction && allowlist.length === 0,
  };
}

export function originIsAllowed(
  policy: OriginPolicy,
  origin: string | undefined,
): boolean {
  if (policy.permissive) return true;
  if (!origin) return false;
  // Exact match. We keep this strict on purpose — wildcard handling is a
  // foot-gun we will only add once an operator explicitly requests it.
  return policy.allowlist.includes(origin);
}
