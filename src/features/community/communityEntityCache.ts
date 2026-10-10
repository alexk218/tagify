import type { MusicEntityKind, PublicEntityViewV1 } from "@tagify/community-contracts";
import { COMMUNITY_ORIGIN } from "./communityLinks";

/** Public Community pages change slowly; one lookup serves every detail view for ten minutes. */
export const COMMUNITY_ENTITY_CACHE_MS = 10 * 60_000;
/** Network and server failures are retried sooner than a confirmed missing page. */
export const COMMUNITY_ENTITY_FAILURE_CACHE_MS = 60_000;
const MAX_CACHED_ENTITIES = 200;

export interface CommunityEntityLookup {
  /** Community has a public page for this entity. */
  found: boolean;
  entity: PublicEntityViewV1 | null;
}

interface CachedLookup {
  expiresAt: number;
  result: Promise<CommunityEntityLookup>;
}

const lookups = new Map<string, CachedLookup>();
/**
 * The CDN-cacheable public route is newer than the original entity route.
 * Until Community serves it, a missing route answers with the website's HTML
 * 404 page; remember that and use the original route for this session.
 */
let publicRouteAvailable = true;

function entityUrl(kind: MusicEntityKind, providerId: string, publicRoute: boolean): string {
  return `${COMMUNITY_ORIGIN}/api/v2/${publicRoute ? "public-entities" : "entities"}/${kind}/${providerId}`;
}

function isMissingRoute(response: Response): boolean {
  return response.status === 404 && !/\bapplication\/json\b/i.test(response.headers.get("content-type") || "");
}

/**
 * Reads a public Community entity once for every component that shows it.
 * The routes are anonymous, so the request carries no credentials and needs no
 * CORS preflight.
 */
export function lookupCommunityEntity(
  kind: MusicEntityKind,
  providerId: string,
  request: typeof fetch = (...args) => fetch(...args),
  now: () => number = Date.now,
): Promise<CommunityEntityLookup> {
  const key = `${kind}:${providerId}`;
  const cached = lookups.get(key);
  if (cached && cached.expiresAt > now()) {
    // Keep recently used entities at the end so eviction drops the oldest.
    lookups.delete(key);
    lookups.set(key, cached);
    return cached.result;
  }

  const entry: CachedLookup = {
    expiresAt: Number.POSITIVE_INFINITY,
    result: Promise.resolve({ found: false, entity: null }),
  };
  entry.result = (async (): Promise<CommunityEntityLookup> => {
    let cacheFor = COMMUNITY_ENTITY_FAILURE_CACHE_MS;
    try {
      let response = await request(entityUrl(kind, providerId, publicRouteAvailable));
      if (publicRouteAvailable && isMissingRoute(response)) {
        publicRouteAvailable = false;
        response = await request(entityUrl(kind, providerId, false));
      }
      if (response.status === 404) {
        cacheFor = COMMUNITY_ENTITY_CACHE_MS;
        return { found: false, entity: null };
      }
      if (!response.ok) return { found: false, entity: null };
      const body = (await response.json().catch(() => null)) as { entity?: PublicEntityViewV1 } | null;
      cacheFor = COMMUNITY_ENTITY_CACHE_MS;
      return { found: true, entity: body?.entity && typeof body.entity === "object" ? body.entity : null };
    } catch {
      return { found: false, entity: null };
    } finally {
      entry.expiresAt = now() + cacheFor;
    }
  })();

  lookups.delete(key);
  lookups.set(key, entry);
  while (lookups.size > MAX_CACHED_ENTITIES) {
    const oldest = lookups.keys().next().value;
    if (oldest === undefined) break;
    lookups.delete(oldest);
  }
  return entry.result;
}

/** Forgets cached lookups and the route choice (used by tests). */
export function clearCommunityEntityCache(): void {
  lookups.clear();
  publicRouteAvailable = true;
}
