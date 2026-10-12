import { spotifyRead } from "./SpotifyRequests";
import type { RequestOptions } from "@/utils/RateLimiter";
import { getSpotifyRetryAfterMs } from "@/utils/spotifyRateLimit";

type GraphQLDefinition = Record<string, unknown>;
type GraphQLVariables = Record<string, unknown>;

function getGraphQLRequestFunction(): ((
  definition: GraphQLDefinition,
  variables?: GraphQLVariables,
  context?: GraphQLVariables,
) => Promise<unknown>) | null {
  if (!Spicetify.GraphQL) {
    return null;
  }

  const graphQL = Spicetify.GraphQL as typeof Spicetify.GraphQL & {
    request?: typeof Spicetify.GraphQL.Request;
  };

  if (typeof graphQL.Request === "function") {
    return graphQL.Request.bind(graphQL);
  }

  if (typeof graphQL.request === "function") {
    return graphQL.request.bind(graphQL);
  }

  if (typeof graphQL.Handler === "function") {
    return graphQL.Handler(graphQL.Context || {});
  }

  return null;
}

export async function requestSpicetifyGraphQL<TResponse = unknown>(
  definition: GraphQLDefinition | undefined,
  variables?: GraphQLVariables,
  context?: GraphQLVariables,
  options?: RequestOptions,
): Promise<TResponse> {
  if (!definition) {
    throw new Error("Spicetify GraphQL definition is unavailable");
  }

  const request = getGraphQLRequestFunction();
  if (!request) {
    throw new TypeError("Spicetify GraphQL request function is unavailable");
  }

  return spotifyRead(`graphql:${JSON.stringify([definition, variables, context])}`, async () => {
    const response = await request(definition, variables, context);
    const errors = (response as { errors?: unknown[] } | null)?.errors;
    const throttled = errors?.find((error) => getSpotifyRetryAfterMs(error) !== null);
    if (throttled) throw throttled;
    return response as TResponse;
  }, { ...options, transport: "graphql" });
}
