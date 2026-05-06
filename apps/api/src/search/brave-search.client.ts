import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export type BraveSearchParams = {
  query: string;
  country?: string;
  language?: string;
  count?: number;
};

export type BraveLlmContextParams = BraveSearchParams & {
  maximumNumberOfUrls?: number;
  maximumNumberOfTokens?: number;
  contextThresholdMode?: "low" | "balanced" | "high";
};

export type BraveSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: "web" | "llm_context";
};

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
};

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<FetchResponse>;

type CacheEntry = {
  expiresAt: number;
  results: BraveSearchResult[];
};

export type BraveSearchClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  minIntervalMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
  cacheTtlMs?: number;
};

export class BraveSearchError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export class BraveSearchClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly minIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private lastRequestAt = 0;

  constructor(options: BraveSearchClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.BRAVE_SEARCH_API_KEY;
    this.baseUrl =
      options.baseUrl ?? process.env.BRAVE_SEARCH_BASE_URL ?? "https://api.search.brave.com/res/v1";
    this.fetchImpl = options.fetchImpl ?? createFetchImpl();
    this.minIntervalMs = options.minIntervalMs ?? readDurationEnv("BRAVE_SEARCH_MIN_INTERVAL_MS", 1000);
    this.retryDelayMs = options.retryDelayMs ?? readDurationEnv("BRAVE_SEARCH_RETRY_DELAY_MS", 1000);
    this.maxRetries = options.maxRetries ?? 2;
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  }

  async searchWeb(params: BraveSearchParams) {
    return this.request("web/search", buildWebParams(params), parseWebResults);
  }

  async searchLlmContext(params: BraveLlmContextParams) {
    return this.request("llm/context", buildLlmContextParams(params), parseLlmContextResults);
  }

  private async request(
    endpoint: "web/search" | "llm/context",
    params: URLSearchParams,
    parseResults: (payload: unknown) => BraveSearchResult[]
  ) {
    if (!this.apiKey) {
      throw new BraveSearchError("BRAVE_SEARCH_API_KEY is required before running Brave search.");
    }

    const cacheKey = `${endpoint}?${params.toString()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.results;
    }

    const url = `${this.baseUrl}/${endpoint}?${params.toString()}`;
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      try {
        await this.waitForRateLimit();
        const response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": this.apiKey
          }
        });

        if (response.ok) {
          const results = dedupeByUrl(parseResults(await response.json()));
          this.cache.set(cacheKey, {
            expiresAt: Date.now() + this.cacheTtlMs,
            results
          });
          return results;
        }

        if (!shouldRetryStatus(response.status) || attempt === this.maxRetries) {
          const body = response.text ? await response.text() : "";
          throw new BraveSearchError(
            `Brave search failed with HTTP ${response.status}${body ? `: ${body}` : ""}`,
            response.status
          );
        }
      } catch (error) {
        lastError = error;
        if (error instanceof BraveSearchError || attempt === this.maxRetries) {
          throw error;
        }
      }

      attempt += 1;
      await sleep(this.retryDelayMs);
    }

    throw new BraveSearchError(`Brave search failed: ${String(lastError)}`);
  }

  private async waitForRateLimit() {
    const elapsed = Date.now() - this.lastRequestAt;
    const waitMs = Math.max(0, this.minIntervalMs - elapsed);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    this.lastRequestAt = Date.now();
  }
}

function buildWebParams(params: BraveSearchParams) {
  const searchParams = new URLSearchParams({
    q: params.query,
    country: params.country ?? "US",
    search_lang: params.language ?? "en",
    count: String(params.count ?? 20),
    extra_snippets: "true"
  });

  return searchParams;
}

function buildLlmContextParams(params: BraveLlmContextParams) {
  const searchParams = new URLSearchParams({
    q: params.query,
    country: params.country ?? "US",
    search_lang: params.language ?? "en",
    count: String(params.count ?? 20),
    maximum_number_of_urls: String(params.maximumNumberOfUrls ?? 10),
    maximum_number_of_tokens: String(params.maximumNumberOfTokens ?? 8192),
    context_threshold_mode: params.contextThresholdMode ?? "balanced"
  });

  return searchParams;
}

function parseWebResults(payload: unknown): BraveSearchResult[] {
  const data = payload as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        extra_snippets?: string[];
      }>;
    };
  };

  return (data.web?.results ?? [])
    .filter((item) => item.url)
    .map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: [item.description, ...(item.extra_snippets ?? [])].filter(Boolean).join("\n"),
      source: "web" as const
    }));
}

function parseLlmContextResults(payload: unknown): BraveSearchResult[] {
  const data = payload as {
    grounding?: {
      generic?: Array<{
        title?: string;
        url?: string;
        snippets?: string[];
      }>;
    };
  };

  return (data.grounding?.generic ?? [])
    .filter((item) => item.url)
    .map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: (item.snippets ?? []).join("\n"),
      source: "llm_context" as const
    }));
}

function dedupeByUrl(results: BraveSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const normalized = normalizeUrl(result.url);
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function normalizeUrl(url: string) {
  return url.replace(/\/$/, "").toLowerCase();
}

function shouldRetryStatus(status: number) {
  return status === 429 || status >= 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDurationEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function createFetchImpl(): FetchLike {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) {
    return globalThis.fetch.bind(globalThis) as FetchLike;
  }

  return (url, init) => proxyFetch(url, init, proxyUrl);
}

function resolveProxyUrl() {
  const explicit =
    process.env.BRAVE_SEARCH_PROXY_URL ??
    process.env.HTTPS_PROXY ??
    process.env.HTTP_PROXY ??
    process.env.ALL_PROXY;
  if (explicit) {
    return normalizeProxyUrl(explicit);
  }

  return readWindowsSystemProxy();
}

function readWindowsSystemProxy() {
  if (process.platform !== "win32" || process.env.LEADHUNT_USE_SYSTEM_PROXY === "false") {
    return undefined;
  }

  try {
    const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    const enableOutput = execFileSync("reg", ["query", key, "/v", "ProxyEnable"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (!/\bProxyEnable\b[\s\S]*0x1\b/i.test(enableOutput)) {
      return undefined;
    }

    const serverOutput = execFileSync("reg", ["query", key, "/v", "ProxyServer"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const match = serverOutput.match(/\bProxyServer\b\s+REG_SZ\s+(.+)$/im);
    return match?.[1] ? normalizeProxyUrl(selectProxyServer(match[1].trim())) : undefined;
  } catch {
    return undefined;
  }
}

function selectProxyServer(value: string) {
  if (!value.includes("=")) {
    return value;
  }

  const entries = Object.fromEntries(
    value
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((entry): entry is [string, string] => entry.length === 2 && Boolean(entry[0]) && Boolean(entry[1]))
  );

  return entries.https ?? entries.http;
}

function normalizeProxyUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  if (/^(https?|socks5h?):\/\//i.test(value)) {
    return value;
  }

  const port = Number(value.match(/:(\d+)\s*$/)?.[1]);
  const protocol = port === 1080 || port === 10808 ? "socks5h" : "http";
  return `${protocol}://${value}`;
}

function proxyFetch(targetUrl: string, init: { headers: Record<string, string> }, proxyUrl: string): Promise<FetchResponse> {
  const target = new URL(targetUrl);
  const proxy = new URL(proxyUrl);
  debugProxy(`Using ${proxy.protocol}//${proxy.hostname}:${proxy.port || "(default)"} for ${target.hostname}`);

  if (target.protocol !== "https:") {
    return Promise.reject(new Error("Brave proxy fetch currently supports HTTPS targets only."));
  }

  if (proxy.protocol === "http:") {
    return httpProxyFetch(target, init, proxy);
  }

  if (proxy.protocol === "socks5:" || proxy.protocol === "socks5h:") {
    return socks5ProxyFetch(target, init, proxy);
  }

  return Promise.reject(new Error(`Unsupported Brave proxy protocol: ${proxy.protocol}`));
}

function httpProxyFetch(
  target: URL,
  init: { headers: Record<string, string> },
  proxy: URL
): Promise<FetchResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleReject = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const settleResolve = (response: FetchResponse) => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    const targetPort = target.port || "443";
    const connectRequest = httpRequest({
      hostname: proxy.hostname,
      port: Number(proxy.port || 80),
      method: "CONNECT",
      path: `${target.hostname}:${targetPort}`,
      headers: {
        Host: `${target.hostname}:${targetPort}`,
        "Proxy-Connection": "Keep-Alive",
        ...proxyAuthorizationHeader(proxy)
      },
      timeout: 20_000
    });

    connectRequest.once("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        settleReject(new Error(`Proxy CONNECT failed with HTTP ${response.statusCode ?? "unknown"}`));
        return;
      }

      fetchThroughTlsSocket(target, socket, init).then(settleResolve, settleReject);
    });
    connectRequest.once("timeout", () => connectRequest.destroy(new Error("Proxy CONNECT timed out")));
    connectRequest.once("error", settleReject);
    connectRequest.end();
  });
}

async function socks5ProxyFetch(
  target: URL,
  init: { headers: Record<string, string> },
  proxy: URL
): Promise<FetchResponse> {
  const socket = await connectSocks5(proxy, target);
  return fetchThroughTlsSocket(target, socket, init);
}

function fetchThroughTlsSocket(
  target: URL,
  socket: Socket,
  init: { headers: Record<string, string> }
): Promise<FetchResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleReject = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const settleResolve = (response: FetchResponse) => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    const secureSocket = tlsConnect({
      socket,
      servername: target.hostname
    });
    const chunks: Buffer[] = [];

    secureSocket.setTimeout(20_000, () => secureSocket.destroy(new Error("Brave HTTPS request timed out")));
    secureSocket.once("secureConnect", () => {
      const requestHeaders = {
        ...init.headers,
        Host: target.host,
        "Accept-Encoding": "identity",
        Connection: "close"
      };
      const requestHead = [
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        ...Object.entries(requestHeaders).map(([key, value]) => `${key}: ${value}`),
        "",
        ""
      ].join("\r\n");
      secureSocket.write(requestHead);
    });
    secureSocket.on("data", (chunk) => chunks.push(chunk));
    secureSocket.once("error", settleReject);
    secureSocket.once("end", () => {
      try {
        settleResolve(parseProxyHttpResponse(Buffer.concat(chunks)));
      } catch (error) {
        settleReject(error);
      }
    });
  });
}

function connectSocks5(proxy: URL, target: URL): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = netConnect({
      host: proxy.hostname,
      port: Number(proxy.port || 1080),
      timeout: 20_000
    });
    const settleReject = (error: unknown) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(error);
      }
    };
    const settleResolve = () => {
      if (!settled) {
        settled = true;
        socket.setTimeout(0);
        resolve(socket);
      }
    };

    socket.once("connect", () => {
      void (async () => {
        try {
          const hasAuth = Boolean(proxy.username);
          debugProxy("SOCKS5 connected to proxy");
          socket.write(Buffer.from(hasAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]));
          const methodResponse = await readSocketBytes(socket, 2);
          debugProxy(`SOCKS5 method response ${methodResponse.toString("hex")}`);
          if (methodResponse[0] !== 0x05 || methodResponse[1] === 0xff) {
            throw new Error("SOCKS5 proxy did not accept an authentication method.");
          }

          if (methodResponse[1] === 0x02) {
            await authenticateSocks5(proxy, socket);
          }

          await requestSocks5Connect(target, socket);
          debugProxy("SOCKS5 target connected");
          settleResolve();
        } catch (error) {
          settleReject(error);
        }
      })();
    });
    socket.once("timeout", () => settleReject(new Error("SOCKS5 proxy timed out")));
    socket.once("error", settleReject);
  });
}

function debugProxy(message: string) {
  if (process.env.BRAVE_SEARCH_PROXY_DEBUG === "true") {
    console.warn(`[BraveSearchProxy] ${message}`);
  }
}

async function authenticateSocks5(proxy: URL, socket: Socket) {
  const username = Buffer.from(decodeURIComponent(proxy.username));
  const password = Buffer.from(decodeURIComponent(proxy.password));
  if (username.length > 255 || password.length > 255) {
    throw new Error("SOCKS5 proxy credentials are too long.");
  }

  socket.write(Buffer.concat([Buffer.from([0x01, username.length]), username, Buffer.from([password.length]), password]));
  const authResponse = await readSocketBytes(socket, 2);
  if (authResponse[0] !== 0x01 || authResponse[1] !== 0x00) {
    throw new Error("SOCKS5 proxy authentication failed.");
  }
}

async function requestSocks5Connect(target: URL, socket: Socket) {
  const hostname = Buffer.from(target.hostname);
  if (hostname.length > 255) {
    throw new Error("SOCKS5 target host is too long.");
  }

  const port = Number(target.port || 443);
  const request = Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, hostname.length]),
    hostname,
    Buffer.from([(port >> 8) & 0xff, port & 0xff])
  ]);
  debugProxy(`SOCKS5 connect request ${request.toString("hex")}`);
  socket.write(request);
  const responseHead = await readSocketBytes(socket, 4);
  debugProxy(`SOCKS5 connect response head ${responseHead.toString("hex")}`);
  if (responseHead[0] !== 0x05 || responseHead[1] !== 0x00) {
    throw new Error(`SOCKS5 proxy connect failed with code ${responseHead[1] ?? "unknown"}.`);
  }

  if (responseHead[3] === 0x01) {
    await readSocketBytes(socket, 6);
  } else if (responseHead[3] === 0x04) {
    await readSocketBytes(socket, 18);
  } else if (responseHead[3] === 0x03) {
    const length = (await readSocketBytes(socket, 1))[0] ?? 0;
    await readSocketBytes(socket, length + 2);
  } else {
    throw new Error("SOCKS5 proxy returned an unsupported address type.");
  }
}

function readSocketBytes(socket: Socket, byteLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = socketReadBuffers.get(socket) ?? Buffer.alloc(0);
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };
    const finishIfReady = () => {
      if (buffer.length < byteLength) {
        return false;
      }

      cleanup();
      const wanted = buffer.subarray(0, byteLength);
      socketReadBuffers.set(socket, buffer.subarray(byteLength));
      resolve(wanted);
      return true;
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      finishIfReady();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("SOCKS5 proxy closed the connection."));
    };

    if (finishIfReady()) {
      return;
    }
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
  });
}

const socketReadBuffers = new WeakMap<Socket, Buffer>();

function proxyAuthorizationHeader(proxy: URL) {
  if (!proxy.username) {
    return {};
  }

  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return {
    "Proxy-Authorization": `Basic ${Buffer.from(credentials).toString("base64")}`
  };
}

function parseProxyHttpResponse(buffer: Buffer): FetchResponse {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    throw new Error("Invalid proxy HTTP response");
  }

  const headerText = buffer.subarray(0, headerEnd).toString("latin1");
  const [statusLine = "", ...headerLines] = headerText.split("\r\n");
  const status = Number(statusLine.split(" ")[1]);
  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }

  let body = buffer.subarray(headerEnd + 4);
  if (headers.get("transfer-encoding")?.toLowerCase().includes("chunked")) {
    body = decodeChunkedBody(body);
  }
  const encoding = headers.get("content-encoding")?.toLowerCase();
  if (encoding === "gzip") {
    body = gunzipSync(body);
  } else if (encoding === "deflate") {
    body = inflateSync(body);
  } else if (encoding === "br") {
    body = brotliDecompressSync(body);
  }

  const textBody = body.toString("utf8");
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(textBody) as unknown,
    text: async () => textBody
  };
}

function decodeChunkedBody(body: Buffer) {
  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < body.length) {
    const lineEnd = body.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const sizeText = body.subarray(offset, lineEnd).toString("ascii").split(";")[0]?.trim() ?? "0";
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const start = lineEnd + 2;
    chunks.push(body.subarray(start, start + size));
    offset = start + size + 2;
  }

  return Buffer.concat(chunks);
}
