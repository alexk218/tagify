import type { MusicEntityKind, PublicEntityViewV1 } from "@tagify/community-contracts";
import { COMMUNITY_ORIGIN } from "./communityLinks";

/**
 * Answers are kept for the whole Spotify session and shown straight away.
 * Opening a lens asks Community again, at most this often per item: other
 * members' new tags still appear, and Community's own cache serves the same
 * answer for a minute anyway.
 */
export const COMMUNITY_ENTITY_REVALIDATE_MS = 60_000;
const MAX_CACHED_ENTITIES = 500;

export interface CommunityEntityLookup {
  /** Community has a public page for this entity. */
  found: boolean;
  entity: PublicEntityViewV1 | null;
  /** Community could not be reached and nothing was known before. */
  unavailable?: true;
}

interface CachedLookup {
  checkedAt: number;
  result: CommunityEntityLookup;
}

const answers = new Map<string, CachedLookup>();
const inFlight = new Map<string, Promise<CommunityEntityLookup>>();
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

function remember(key: string, entry: CachedLookup): void {
  // Keep recently used entities at the end so eviction drops the oldest.
  answers.delete(key);
  answers.set(key, entry);
  while (answers.size > MAX_CACHED_ENTITIES) {
    const oldest = answers.keys().next().value;
    if (oldest === undefined) break;
    answers.delete(oldest);
  }
}

/** What this session already knows about an entity, without asking Community. */
export function peekCommunityEntity(kind: MusicEntityKind, providerId: string): CommunityEntityLookup | undefined {
  const key = `${kind}:${providerId}`;
  const cached = answers.get(key);
  if (cached) remember(key, cached);
  return cached?.result;
}

/**
 * Asks Community about a public entity, sharing one request between every
 * view that asks at the same time. The routes are anonymous, so the request
 * carries no credentials and needs no CORS preflight. A failed request keeps
 * the earlier answer.
 */
export function lookupCommunityEntity(
  kind: MusicEntityKind,
  providerId: string,
  request: typeof fetch = (...args) => fetch(...args),
  now: () => number = Date.now,
): Promise<CommunityEntityLookup> {
  const key = `${kind}:${providerId}`;
  const cached = answers.get(key);
  if (cached && now() - cached.checkedAt < COMMUNITY_ENTITY_REVALIDATE_MS) {
    remember(key, cached);
    return Promise.resolve(cached.result);
  }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const result = (async (): Promise<CommunityEntityLookup> => {
    try {
      let response = await request(entityUrl(kind, providerId, publicRouteAvailable));
      if (publicRouteAvailable && isMissingRoute(response)) {
        publicRouteAvailable = false;
        response = await request(entityUrl(kind, providerId, false));
      }
      if (response.status === 404) {
        const missing = { found: false, entity: null };
        remember(key, { checkedAt: now(), result: missing });
        return missing;
      }
      if (!response.ok) throw new Error(`Community answered ${response.status}`);
      const body = (await response.json().catch(() => null)) as { entity?: PublicEntityViewV1 } | null;
      const found: CommunityEntityLookup = { found: true, entity: body?.entity && typeof body.entity === "object" ? body.entity : null };
      remember(key, { checkedAt: now(), result: found });
      return found;
    } catch {
      return answers.get(key)?.result ?? { found: false, entity: null, unavailable: true };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, result);
  return result;
}

/** Forgets cached lookups and the route choice (used by tests). */
export function clearCommunityEntityCache(): void {
  answers.clear();
  inFlight.clear();
  publicRouteAvailable = true;
}
