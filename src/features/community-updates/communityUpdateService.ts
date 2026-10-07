import { COMMUNITY_ORIGIN } from "@/features/community/communityLinks";

export interface CommunityUpdate {
  revision: number;
  title: string;
  publishedAt: string;
  changes: string[];
}

export const COMMUNITY_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const COMMUNITY_UPDATE_SEEN_KEY = "tagify:community-updates:seen:v1";
const FEED_URL = `${COMMUNITY_ORIGIN}/api/v1/updates`;
const RETRY_MS = 15 * 60 * 1000;

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function parseCommunityUpdates(value: unknown): CommunityUpdate[] {
  const feed = value as { schemaVersion?: unknown; releases?: unknown } | null;
  if (feed?.schemaVersion !== 1 || !Array.isArray(feed.releases) || feed.releases.length > 20) {
    throw new Error("Invalid Community update feed");
  }
  const revisions = new Set<number>();
  for (const release of feed.releases) {
    if (!release || !Number.isSafeInteger(release.revision) || release.revision < 1
      || revisions.has(release.revision) || !isText(release.title, 120)
      || !isText(release.publishedAt, 40) || !Number.isFinite(Date.parse(release.publishedAt))
      || !Array.isArray(release.changes) || release.changes.length < 1 || release.changes.length > 10
      || !release.changes.every((change: unknown) => isText(change, 500))) {
      throw new Error("Invalid Community update notice");
    }
    revisions.add(release.revision);
  }
  return feed.releases.map(({ revision, title, publishedAt, changes }) => ({ revision, title, publishedAt, changes }))
    .sort((a, b) => b.revision - a.revision);
}

export class CommunityUpdateService {
  private releases: CommunityUpdate[] = [];
  private nextCheckAt = 0;
  private inFlight: Promise<CommunityUpdate[]> | null = null;
  private seenInSession = 0;

  async check(): Promise<CommunityUpdate[]> {
    if (this.inFlight) return this.inFlight;
    if (Date.now() < this.nextCheckAt) return this.unseen();

    this.inFlight = this.fetchUpdates();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async fetchUpdates(): Promise<CommunityUpdate[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(FEED_URL, { signal: controller.signal, credentials: "omit" });
      if (!response.ok) throw new Error(`Community updates: ${response.status}`);
      this.releases = parseCommunityUpdates(await response.json());
      this.nextCheckAt = Date.now() + COMMUNITY_UPDATE_INTERVAL_MS;
    } catch {
      // An unavailable or not-yet-deployed feed must never block tagging.
      this.nextCheckAt = Date.now() + RETRY_MS;
    } finally {
      clearTimeout(timeout);
    }
    return this.unseen();
  }

  private seenRevision(): number {
    try {
      const stored = Number(localStorage.getItem(COMMUNITY_UPDATE_SEEN_KEY));
      if (Number.isSafeInteger(stored) && stored > this.seenInSession) this.seenInSession = stored;
    } catch { /* Keep dismissal for this session when storage is unavailable. */ }
    return this.seenInSession;
  }

  private unseen(): CommunityUpdate[] {
    const seen = this.seenRevision();
    const published = this.releases.filter((release) => Date.parse(release.publishedAt) <= Date.now());
    // New installations get the latest summary, rather than the entire archive.
    return seen === 0 ? published.slice(0, 1) : published.filter((release) => release.revision > seen);
  }

  dismiss(releases: CommunityUpdate[]): void {
    this.seenInSession = Math.max(this.seenRevision(), ...releases.map((release) => release.revision));
    try {
      localStorage.setItem(COMMUNITY_UPDATE_SEEN_KEY, String(this.seenInSession));
    } catch { /* Session dismissal still prevents repeated interruptions. */ }
  }
}

export const communityUpdateService = new CommunityUpdateService();
