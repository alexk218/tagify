import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSpicetifyGraphQL } from "@/services/spicetifyGraphQL";

const originalGraphQL = Spicetify.GraphQL;

describe("requestSpicetifyGraphQL", () => {
  afterEach(() => {
    Object.defineProperty(Spicetify, "GraphQL", {
      value: originalGraphQL,
      configurable: true,
    });
  });

  it("does not treat a GraphQL rate-limit answer as successful data", async () => {
    const error = { message: "Too many requests", extensions: { http: { status: 429 } } };
    Object.defineProperty(Spicetify, "GraphQL", { value: { Request: vi.fn().mockResolvedValue({ errors: [error] }) }, configurable: true });
    await expect(requestSpicetifyGraphQL({ name: "getTrack" })).rejects.toEqual(error);
  });

  it("falls back to GraphQL.Handler when GraphQL.Request is unavailable", async () => {
    const handler = vi.fn().mockResolvedValue({ data: { ok: true } });
    const handlerFactory = vi.fn(() => handler);
    const definition = { name: "getTrack" };
    const variables = { uri: "spotify:track:123" };
    const context = { locale: "en" };

    Object.defineProperty(Spicetify, "GraphQL", {
      value: {
        Context: context,
        Definitions: { getTrack: definition },
        Handler: handlerFactory,
      },
      configurable: true,
    });

    await expect(requestSpicetifyGraphQL(definition, variables)).resolves.toEqual({
      data: { ok: true },
    });
    expect(handlerFactory).toHaveBeenCalledWith(context);
    expect(handler).toHaveBeenCalledWith(definition, variables, undefined);
  });
});
