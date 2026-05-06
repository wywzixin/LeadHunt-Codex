import { describe, expect, it, vi } from "vitest";
import { Gpt55Client, Gpt55Error } from "./gpt55.client.js";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue(JSON.stringify(payload))
  };
}

describe("Gpt55Client", () => {
  it("calls an OpenAI-compatible chat completions endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "{\"ok\":true}" } }]
      })
    );
    const client = new Gpt55Client({
      apiKey: "test-key",
      baseUrl: "http://localhost:8080/v1/",
      model: "gpt-5.5",
      fetchImpl,
      retryDelayMs: 0
    });

    const result = await client.complete(
      [
        { role: "system", content: "Return JSON" },
        { role: "user", content: "hello" }
      ],
      { responseFormat: "json_object", maxTokens: 512 }
    );

    expect(result).toBe("{\"ok\":true}");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:8080/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json"
        })
      })
    );
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1].body as string) as {
      model: string;
      stream: boolean;
      response_format?: { type: string };
    };
    expect(body.model).toBe("gpt-5.5");
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("returns readable configuration errors", async () => {
    await expect(new Gpt55Client({ apiKey: "key", baseUrl: "" }).complete([])).rejects.toThrow(
      "OPENAI_BASE_URL is required"
    );

    await expect(new Gpt55Client({ apiKey: "", baseUrl: "http://localhost/v1" }).complete([]))
      .rejects.toThrow("OPENAI_API_KEY is required");
  });

  it("retries transient failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "busy" } }, 500))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "done" } }] }));
    const client = new Gpt55Client({
      apiKey: "test-key",
      baseUrl: "http://localhost:8080/v1",
      fetchImpl,
      retryDelayMs: 0,
      maxRetries: 1
    });

    await expect(client.complete([{ role: "user", content: "hello" }])).resolves.toBe("done");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws a typed error on non-retryable HTTP failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "invalid key" } }, 401));
    const client = new Gpt55Client({
      apiKey: "bad-key",
      baseUrl: "http://localhost:8080/v1",
      fetchImpl
    });

    await expect(client.complete([{ role: "user", content: "hello" }])).rejects.toThrow(
      Gpt55Error
    );
    await expect(client.complete([{ role: "user", content: "hello" }])).rejects.toThrow(
      "invalid key"
    );
  });
});
