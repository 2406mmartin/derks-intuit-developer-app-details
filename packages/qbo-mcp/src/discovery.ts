// Intuit publishes an OpenID Connect discovery document for each environment.
// Fetching it (instead of hardcoding URLs) means endpoint changes on Intuit's
// side don't require a code update — and the App Assessment expects Yes to
// "Did you use the Intuit discovery document?"

const DISCOVERY_URLS = {
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
  sandbox: "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
} as const;

export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint: string;
  jwks_uri: string;
}

const cache = new Map<"production" | "sandbox", Promise<DiscoveryDocument>>();

export function getDiscovery(
  environment: "production" | "sandbox",
): Promise<DiscoveryDocument> {
  const hit = cache.get(environment);
  if (hit) return hit;
  const promise = fetch(DISCOVERY_URLS[environment], {
    headers: { Accept: "application/json" },
  }).then(async (res) => {
    if (!res.ok) {
      cache.delete(environment);
      throw new Error(
        `Failed to load Intuit discovery document for ${environment}: ${res.status}`,
      );
    }
    return (await res.json()) as DiscoveryDocument;
  });
  cache.set(environment, promise);
  return promise;
}
