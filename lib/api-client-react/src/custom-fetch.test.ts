import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customFetch,
  setAuthTokenGetter,
  setBaseUrl,
  setDefaultHeaders,
  setOfflineAdapter,
} from "./custom-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthTokenGetter(null);
  setBaseUrl(null);
  setDefaultHeaders({});
  setOfflineAdapter(null);
});

describe("assistant API connectivity", () => {
  it("reports Gemini 503 responses as application errors without marking CareTrack offline", async () => {
    const onReachable = vi.fn();
    setOfflineAdapter({ onReachable });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Gemini AI is not available. Try again." }),
      { status: 503, headers: { "content-type": "application/json" } },
    )));

    await expect(customFetch("/api/assistant", {
      method: "POST",
      body: JSON.stringify({ message: "How am I doing?" }),
    })).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      data: { error: "Gemini AI is not available. Try again." },
    });

    expect(onReachable).toHaveBeenLastCalledWith(true);
  });

  it("keeps gateway failures for other API endpoints in offline mode", async () => {
    const onReachable = vi.fn();
    setOfflineAdapter({ onReachable });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Unavailable" }),
      { status: 503, headers: { "content-type": "application/json" } },
    )));

    await expect(customFetch("/api/patients")).rejects.toMatchObject({
      name: "OfflineError",
    });

    expect(onReachable).toHaveBeenLastCalledWith(false);
  });
});
