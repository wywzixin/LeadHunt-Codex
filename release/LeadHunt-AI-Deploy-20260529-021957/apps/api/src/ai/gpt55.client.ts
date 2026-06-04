import { Injectable } from "@nestjs/common";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type Gpt55ChatOptions = {
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "text" | "json_object";
};

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
};

type FetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<FetchResponse>;

export type Gpt55ClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: FetchLike;
  retryDelayMs?: number;
  maxRetries?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

export class Gpt55Error extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

@Injectable()
export class Gpt55Client {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;

  constructor(options: Gpt55ClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPENAI_BASE_URL);
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.5";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async complete(messages: ChatMessage[], options: Gpt55ChatOptions = {}) {
    if (!this.baseUrl) {
      throw new Gpt55Error("OPENAI_BASE_URL is required before calling GPT-5.5.");
    }

    if (!this.apiKey) {
      throw new Gpt55Error("OPENAI_API_KEY is required before calling GPT-5.5.");
    }

    const payload = {
      model: this.model,
      messages,
      stream: false,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.2,
      ...(options.responseFormat === "json_object"
        ? { response_format: { type: "json_object" } }
        : {})
    };
    const url = `${this.baseUrl}/chat/completions`;
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          return parseChatCompletion(await response.json());
        }

        if (!shouldRetryStatus(response.status) || attempt === this.maxRetries) {
          const body = response.text ? await response.text() : "";
          throw new Gpt55Error(formatHttpError(response.status, body), response.status);
        }
      } catch (error) {
        lastError = error;
        if (error instanceof Gpt55Error || attempt === this.maxRetries) {
          throw error;
        }
      }

      attempt += 1;
      await sleep(this.retryDelayMs);
    }

    throw new Gpt55Error(`GPT-5.5 request failed: ${String(lastError)}`);
  }
}

function parseChatCompletion(payload: unknown) {
  const data = payload as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  throw new Gpt55Error(data.error?.message ?? "GPT-5.5 response did not include message content.");
}

function formatHttpError(status: number, body: string) {
  if (!body) {
    return `GPT-5.5 request failed with HTTP ${status}.`;
  }

  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return `GPT-5.5 request failed with HTTP ${status}: ${parsed.error?.message ?? body}`;
  } catch {
    return `GPT-5.5 request failed with HTTP ${status}: ${body}`;
  }
}

function normalizeBaseUrl(baseUrl: string | undefined) {
  return baseUrl?.replace(/\/+$/, "");
}

function shouldRetryStatus(status: number) {
  return status === 429 || status >= 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
