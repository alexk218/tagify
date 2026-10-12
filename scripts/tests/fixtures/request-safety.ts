async function main() {
  let reads = 0, writes = 0, http = 0;
  (globalThis as any).Spicetify = {
    showNotification: () => {},
    Locale: { getLocale: () => "en" },
    Platform: { username: "request-fixture", version: "test", PlatformData: { app_platform: "web_player" },
      AuthorizationAPI: { getState: () => ({ token: { accessToken: "fixture" } }) },
      ProductStateAPI: { getValues: async () => ({}) },
      PlaylistAPI: { getContents: async () => { reads++; return { items: [] }; }, add: async () => { writes++; } },
    },
    GraphQL: { Definitions: { getTrack: { name: "getTrack" } }, Request: async (_definition: unknown, { uri }: { uri: string }) => {
      reads++; return { data: { trackUnion: { uri, name: "Example", duration: { totalMilliseconds: 180000 }, artists: { items: [] } } } };
    } },
  };
  const { AudioFeaturesService } = await import("@/services/AudioFeaturesService");
  const { spotifyService } = await import("@/services/SpotifyService");
  const { spotifyApiService } = await import("@/services/SpotifyApiService");
  const { RateLimiter, graphqlRateLimiter } = await import("@/utils/RateLimiter");
  const { spotifyRequestAccounting } = await import("@/utils/spotifyRequestAccounting");
  const { spotifyRead, spotifyFetch } = await import("@/services/SpotifyRequests");
  const result = document.getElementById("result")!;
  const action = (id: string, run: () => Promise<unknown>) => document.getElementById(id)!.addEventListener("click", async () => {
    reads = writes = http = 0; graphqlRateLimiter.reset(); localStorage.clear();
    spotifyRequestAccounting.reset(); (globalThis as any).__tagifyBackgroundPolicyV1?.clear();
    result.textContent = "Running…";
    let details: unknown;
    try { details = await run(); } catch (error) { details = { error: String(error) }; }
    result.textContent = JSON.stringify({ scenario: id, reads, writes, http, details, accounting: spotifyRequestAccounting.snapshot() }, null, 2);
  });
  action("album-counts", async () => {
    const { AlbumTrackTotalsStore } = await import("@/features/playlist-state/services/albumTrackTotals");
    let finish!: (value: Map<string, number>) => void;
    const calls: string[][] = [];
    const store = new AlbumTrackTotalsStore({ storage: null, pause: async () => {},
      lookupSingleTotal: async () => 12,
      lookupTotals: async uris => { calls.push(uris); return calls.length === 1 ? new Promise(resolve => { finish = resolve; }) : new Map(uris.map(uri => [uri, 12])); },
    });
    store.request(["spotify:album:first"]);
    await new Promise(resolve => setTimeout(resolve, 0));
    store.request(["spotify:album:already-loaded"]);
    store.remember({ "spotify:album:already-loaded": 12 });
    finish(new Map([["spotify:album:first", 10]]));
    await new Promise(resolve => setTimeout(resolve, 50));
    return { calls, totals: store.getSnapshot() };
  });
  action("accounting", async () => {
    let finish!: () => void;
    const run = () => { reads++; return new Promise<void>(resolve => { finish = resolve; }); };
    const first = spotifyRead("shared-browser-read", run, { feature: "track-details" });
    const second = spotifyRead("shared-browser-read", run, { feature: "track-details" });
    finish(); await Promise.all([first, second]);
    return { expectedRequests: 2, expectedDispatches: 1 };
  });
  action("playlist-version", async () => {
    const api = Spicetify.Platform.PlaylistAPI as any;
    const originalRead = api.getContents, originalMetadata = api.getMetadata;
    let probes = 0;
    api.getMetadata = async () => { probes++; return { snapshotId: "stable-v1" }; };
    api.getContents = async () => { reads++; return { items: Array.from({ length: 200 }, (_, i) => ({ uri: `spotify:track:${i}` })) }; };
    try {
      const id = `version-${Date.now()}`;
      const first = await spotifyApiService.getTrackUrisForBackgroundSync(id, { priority: "background", feature: "smart-playlists" }, 200);
      const second = await spotifyApiService.getTrackUrisForBackgroundSync(id, { priority: "background", feature: "smart-playlists" }, 200);
      return { firstCount: first.length, secondCount: second.length, probes, fullDownloads: reads };
    } finally { api.getContents = originalRead; api.getMetadata = originalMetadata; }
  });
  action("endpoints", async () => {
    const urls: string[] = [];
    globalThis.fetch = async input => { http++; urls.push(String(input)); return new Response(null, { status: 404 }); };
    await new AudioFeaturesService().getAudioFeaturesByTrackId("endpoint-fixture");
    await spotifyApiService.getAlbumTrackTotals(["spotify:album:fixture"]);
    const legacyCalls = urls.filter(url => url.includes("api.spotify.com"));
    graphqlRateLimiter.reset(); localStorage.clear();
    globalThis.fetch = async () => { http++; return new Response(JSON.stringify({ error: { status: 429, reason: "QUOTA_EXCEEDED" } }), { status: 429 }); };
    const failures: unknown[] = [];
    for (const id of ["first", "second"]) {
      try { await spotifyFetch(`https://api.spotify.com/v1/tracks/${id}`); }
      catch (error) { const e = error as any; failures.push({ status: e.status, failure: e.spotifyFailure ?? null }); }
    }
    return { legacyCalls, failures };
  });
  action("audio", async () => {
    globalThis.fetch = async () => { http++; return new Response(null, { status: 429, headers: { "Retry-After": "60" } }); };
    const service = new AudioFeaturesService();
    for (const id of ["first", "second"]) try { await service.getAudioFeaturesByTrackId(id); } catch { /* Simulate the next selection. */ }
  });
  action("bulk", async () => {
    const controller = new AbortController();
    const task = spotifyService.getBatchTracks(Array.from({ length: 100 }, (_, i) => `spotify:track:bulk${i}`), 2, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await task;
  });
  action("cache", async () => {
    const uri = `spotify:track:cache${Date.now()}`;
    await spotifyService.getTrack(uri); await spotifyService.getTrackMetadata(uri); await spotifyService.getAlbumCover(uri);
  });
  action("writes", async () => {
    const uris = Array.from({ length: 100 }, (_, i) => `spotify:track:write${i}`);
    if (spotifyApiService.updatePlaylistTracks) await spotifyApiService.updatePlaylistTracks("fixture", uris, []);
    else for (const uri of uris) await spotifyApiService.addTrackToSpotifyPlaylist(uri, "fixture");
  });
  action("foreground", async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 5 });
    await limiter.execute("background-1", async () => true, { priority: "background" });
    await limiter.execute("background-2", async () => true, { priority: "background" });
    const controller = new AbortController(); let backgroundStarted = false;
    const queued = limiter.execute("background-3", async () => { backgroundStarted = true; }, { priority: "background", signal: controller.signal }).catch(() => {});
    const startedAt = performance.now();
    await limiter.execute("user", async () => true);
    const foregroundWaitMs = Math.round(performance.now() - startedAt);
    controller.abort(); await queued; limiter.reset();
    return { foregroundWaitMs, backgroundStarted };
  });
  action("stalled", async () => {
    const limiter = new RateLimiter({ requestTimeoutMs: 100 });
    const finishes: Array<() => void> = [];
    const stuck = Array.from({ length: 4 }, (_, i) => limiter.execute(`desktop-${i}`, () => new Promise<void>(resolve => finishes.push(resolve))).catch(() => {}));
    await Promise.all(stuck);
    const metadata = await limiter.execute("metadata", async () => "Available", { transport: "graphql" });
    const stalled = limiter.getStats().stalledRequests;
    finishes.forEach(finish => finish()); await new Promise(resolve => setTimeout(resolve, 0));
    const recovered = await limiter.execute("desktop-recovered", async () => true);
    limiter.reset(); return { metadata, stalled, recovered };
  });
  action("uncertain", async () => {
    const api = Spicetify.Platform.PlaylistAPI as any; const original = api.add; let finish!: () => void;
    api.add = () => { writes++; return new Promise<void>(resolve => { finish = resolve; }); };
    try {
      const first = await spotifyApiService.updatePlaylistTracks("uncertain", ["spotify:track:one"], [], []);
      const second = await spotifyApiService.updatePlaylistTracks("uncertain", ["spotify:track:one"], [], []);
      finish(); await new Promise(resolve => setTimeout(resolve, 0));
      return { firstSucceeded: first.success, overlappingRetryBlocked: !second.success };
    } finally { api.add = original; }
  });
  action("refresh", async () => {
    const { PlaylistMembershipStore } = await import("@/features/track-insights/services/playlistMembership");
    const api = Spicetify.Platform.PlaylistAPI as any; const original = api.getContents;
    api.getContents = async () => { reads++; return { items: [{ uri: reads === 1 ? "spotify:track:old" : "spotify:track:new" }] }; };
    try {
      const store = new PlaylistMembershipStore(); const uri = "spotify:playlist:refresh";
      await store.request(uri); await store.request(uri, "", true);
      return { tracks: store.getSnapshot()[uri].uris };
    } finally { api.getContents = original; }
  });

}
void main();
