export type SpotifyFailureKind = "rate-limit" | "quota-exceeded" | "server-429" | "local-pause" | "unsupported-endpoint";
export type SpotifyFailure = { kind: SpotifyFailureKind; dispatched: boolean; endpoint?: string; status?: number; retryAfterSeconds?: number; cause?: SpotifyFailureKind };

type SpotifyErrorBody = { error?: { reason?: unknown; status?: unknown } };
type ErrorShape = { status?: unknown; statusCode?: unknown; message?: unknown; reason?: unknown; error?: { reason?: unknown; status?: unknown }; body?: SpotifyErrorBody | string; response?: { status?: unknown; headers?: Headers | Record<string, string>; body?: SpotifyErrorBody | string }; extensions?: { status?: unknown; http?: { status?: unknown; headers?: Headers | Record<string, string> } }; headers?: Headers | Record<string, string>; retryAfter?: unknown; retryAfterSeconds?: unknown; spotifyFailure?: SpotifyFailure };
function errorBody(value: ErrorShape | null): SpotifyErrorBody | undefined {
  const body = value?.body ?? value?.response?.body;
  if (typeof body !== "string") return body;
  try { return body.length <= 8192 ? JSON.parse(body) : undefined; } catch { return undefined; }
}
export function spotifyStatus(error: unknown): number {
  const e = error as ErrorShape | null;
  return Number(e?.status ?? e?.statusCode ?? e?.response?.status ?? e?.extensions?.status ?? e?.extensions?.http?.status ?? e?.error?.status ?? errorBody(e)?.error?.status);
}
export function spotifyRetryAfterSeconds(error: unknown): number | undefined {
  const e = error as ErrorShape | null;
  if (!e) return;
  const headers = e.headers ?? e.response?.headers ?? e.extensions?.http?.headers;
  const header = headers && (typeof (headers as Headers).get === "function" ? (headers as Headers).get("Retry-After") : (headers as Record<string, string>)["retry-after"] ?? (headers as Record<string, string>)["Retry-After"]);
  const raw = e.retryAfterSeconds ?? e.retryAfter ?? header;
  if (raw == null || raw === "") return;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = typeof raw === "string" ? Date.parse(raw) : NaN;
  if (Number.isFinite(date)) return Math.max(0, (date - Date.now()) / 1000);
}
/** Only known route words survive; never retain query strings, IDs or SDK payloads. */
export function spotifyEndpointLabel(key: string, method = "GET"): string {
  const url = key.match(/https:\/\/(?:api\.spotify\.com|spclient\.wg\.spotify\.com)(?=\/)[^\s"\\]*/)?.[0];
  if (!url) {
    if (key.startsWith("graphql:")) {
      try {
        const definition = JSON.parse(key.slice(8))[0];
        const name = definition?.name ?? definition?.operationName;
        if (typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(name)) return `GraphQL ${name}`;
      } catch { /* Never retain variables or an arbitrary SDK key. */ }
    }
    const desktop = key.match(/^desktop:(playlist|rootlist|library):(getContents|getMetadata|getTracks|add|remove|createPlaylist)(?=:|$)/);
    if (desktop) return `Desktop ${{ playlist: "PlaylistAPI", rootlist: "RootlistAPI", library: "LibraryAPI" }[desktop[1]]}.${desktop[2]}`;
    return "Spotify SDK";
  }
  const parsed = new URL(url);
  const known = /^(v\d+|metadata|4|track|tracks|albums|artists|playlists|items|me|users|library|contains|following|followers|audio-features|audio-analysis|audio-attributes|extended-metadata|browse|recommendations|markets|episodes|shows|audiobooks|chapters|categories|top-tracks|related-artists|featured-playlists|new-releases)$/;
  return `${method.toUpperCase()} ${parsed.host}${parsed.pathname.split("/").map(part => !part || known.test(part) ? part : "{id}").join("/")}`;
}
export function classifySpotifyFailure(error: unknown, endpoint?: string): SpotifyFailure | undefined {
  const e = error as ErrorShape | null;
  if (e?.spotifyFailure) return e.spotifyFailure;
  if (spotifyStatus(error) !== 429) return;
  const reason = e?.reason ?? e?.error?.reason ?? errorBody(e)?.error?.reason;
  const retryAfterSeconds = spotifyRetryAfterSeconds(error);
  return { kind: reason === "QUOTA_EXCEEDED" ? "quota-exceeded" : retryAfterSeconds !== undefined ? "rate-limit" : "server-429", dispatched: true, status: 429, endpoint, retryAfterSeconds };
}
export function spotifyLocalPause(seconds: number, cause?: SpotifyFailure): Error {
  return Object.assign(new Error(cause?.kind === "quota-exceeded" ? "Spotify's request quota was reached. Checks are paused; your edits remain saved." : "Spotify requests are paused. Your edits remain saved."), {
    // Retained for existing retry consumers; spotifyFailure.status is HTTP-only.
    status: 429, spotifyRequestStopped: true, retryAfterSeconds: seconds,
    spotifyFailure: { kind: "local-pause", dispatched: false, retryAfterSeconds: seconds, cause: cause?.kind === "local-pause" ? cause.cause : cause?.kind, endpoint: cause?.endpoint } as SpotifyFailure,
  });
}
/** Do not dispatch removed/restricted Web API capabilities with desktop credentials. */
export function assertSpotifyEndpoint(key: string, method = "GET"): void {
  const match = key.match(/https:\/\/api\.spotify\.com(?=\/)[^\s"\\]*/)?.[0];
  if (!match) return;
  const path = new URL(match).pathname.replace(/\/$/, ""), verb = method.toUpperCase();
  const removedRead = verb === "GET" && /^\/v1\/(?:tracks|albums|artists|episodes|shows|audiobooks|chapters|markets|recommendations|audio-features(?:\/[^/]+)?|audio-analysis\/[^/]+|artists\/[^/]+\/(?:top-tracks|related-artists)|browse\/(?:new-releases|featured-playlists|categories(?:\/[^/]+(?:\/playlists)?)?)|users\/[^/]+(?:\/playlists)?)$/.test(path);
  const removedPlaylist = /^(GET|POST|PUT|DELETE)$/.test(verb) && /^\/v1\/playlists\/[^/]+\/tracks$/.test(path);
  const removedCreate = verb === "POST" && /^\/v1\/users\/[^/]+\/playlists$/.test(path);
  const removedLibrary = /^(PUT|DELETE)$/.test(verb) && /^\/v1\/(?:me\/(?:tracks|albums|episodes|shows|audiobooks|following)|playlists\/[^/]+\/followers)$/.test(path);
  const removedContains = verb === "GET" && /^\/v1\/(?:me\/(?:tracks|albums|episodes|shows|audiobooks|following)|playlists\/[^/]+\/followers)\/contains$/.test(path);
  if (removedRead || removedPlaylist || removedCreate || removedLibrary || removedContains) throw Object.assign(new Error("This Spotify lookup is no longer supported. Your saved data is unchanged."), {
    spotifyRequestStopped: true, spotifyFailure: { kind: "unsupported-endpoint", dispatched: false, endpoint: spotifyEndpointLabel(match, verb) } as SpotifyFailure,
  });
}

/** A tiny error body is useful evidence, but must never hold the request open. */
export async function spotifyQuotaReason(response: Response): Promise<string | undefined> {
  if (!response.body?.getReader) return;
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const decoder = new TextDecoder(); let text = "", size = 0, chunks = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (++chunks > 128) return;
      size += chunk.value.byteLength;
      if (size > 8192) return;
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text)?.error?.reason === "QUOTA_EXCEEDED" ? "QUOTA_EXCEEDED" : undefined;
  };
  try { return await Promise.race([read(), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 250); })]); }
  catch { return undefined; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
