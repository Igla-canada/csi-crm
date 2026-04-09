import "server-only";

import { SDK } from "@ringcentral/sdk";

import { getRingCentralEnv } from "@/lib/ringcentral/env";

type Platform = ReturnType<SDK["platform"]>;

let cached: Platform | null = null;

export async function getRingCentralPlatform(): Promise<Platform> {
  const env = getRingCentralEnv();
  if (!env) {
    throw new Error("RingCentral is not configured. Set RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_JWT, RINGCENTRAL_INTEGRATION_USER_ID.");
  }
  if (cached && (await cached.loggedIn())) {
    return cached;
  }
  const rcsdk = new SDK({
    server: env.serverUrl,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  });
  const platform = rcsdk.platform();
  await platform.login({ jwt: env.jwt });
  cached = platform;
  return platform;
}

export function clearRingCentralPlatformCache() {
  cached = null;
}
