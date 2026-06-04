import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export type GmailFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
};

export type GmailFetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<GmailFetchResponse>;

export function createGmailFetchImpl(): GmailFetchLike {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) {
    return globalThis.fetch.bind(globalThis) as GmailFetchLike;
  }

  return (url, init = {}) => proxyFetch(url, init, proxyUrl);
}

function resolveProxyUrl() {
  const explicit =
    process.env.GMAIL_PROXY_URL ??
    process.env.GOOGLE_API_PROXY_URL ??
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

function proxyFetch(
  targetUrl: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  proxyUrl: string
): Promise<GmailFetchResponse> {
  const target = new URL(targetUrl);
  const proxy = new URL(proxyUrl);

  if (target.protocol !== "https:") {
    return Promise.reject(new Error("Gmail proxy fetch currently supports HTTPS targets only."));
  }

  if (proxy.protocol === "http:") {
    return httpProxyFetch(target, init, proxy);
  }

  if (proxy.protocol === "socks5:" || proxy.protocol === "socks5h:") {
    return socks5ProxyFetch(target, init, proxy);
  }

  return Promise.reject(new Error(`Unsupported Gmail proxy protocol: ${proxy.protocol}`));
}

function httpProxyFetch(
  target: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  proxy: URL
): Promise<GmailFetchResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleReject = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const settleResolve = (response: GmailFetchResponse) => {
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
  init: { method?: string; headers?: Record<string, string>; body?: string },
  proxy: URL
): Promise<GmailFetchResponse> {
  const socket = await connectSocks5(proxy, target);
  return fetchThroughTlsSocket(target, socket, init);
}

function fetchThroughTlsSocket(
  target: URL,
  socket: Socket,
  init: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<GmailFetchResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleReject = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const settleResolve = (response: GmailFetchResponse) => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    const secureSocket = tlsConnect({
      socket,
      servername: target.hostname,
      ALPNProtocols: ["http/1.1"]
    });
    const chunks: Buffer[] = [];

    secureSocket.setTimeout(20_000, () => secureSocket.destroy(new Error("Gmail HTTPS request timed out")));
    secureSocket.once("secureConnect", () => {
      const body = init.body ? Buffer.from(init.body, "utf8") : undefined;
      const requestHeaders = {
        Host: target.host,
        "Accept-Encoding": "identity",
        Connection: "close",
        ...(init.headers ?? {}),
        ...(body ? { "Content-Length": String(body.length) } : {})
      };
      const requestHead = [
        `${init.method ?? "GET"} ${target.pathname}${target.search} HTTP/1.1`,
        ...Object.entries(requestHeaders).map(([key, value]) => `${key}: ${value}`),
        "",
        ""
      ].join("\r\n");
      secureSocket.write(requestHead);
      if (body) {
        secureSocket.write(body);
      }
    });
    secureSocket.on("data", (chunk) => {
      chunks.push(chunk);
      const response = parseCompleteProxyHttpResponse(Buffer.concat(chunks));
      if (response) {
        settleResolve(response);
        secureSocket.destroy();
      }
    });
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
          socket.write(Buffer.from(hasAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]));
          const methodResponse = await readSocketBytes(socket, 2);
          if (methodResponse[0] !== 0x05 || methodResponse[1] === 0xff) {
            throw new Error("SOCKS5 proxy did not accept an authentication method.");
          }

          if (methodResponse[1] === 0x02) {
            await authenticateSocks5(proxy, socket);
          }

          await requestSocks5Connect(target, socket);
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
  socket.write(request);
  const responseHead = await readSocketBytes(socket, 4);
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

function parseProxyHttpResponse(buffer: Buffer): GmailFetchResponse {
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

function parseCompleteProxyHttpResponse(buffer: Buffer) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    return null;
  }

  const headerText = buffer.subarray(0, headerEnd).toString("latin1");
  const headers = parseHeaders(headerText);
  const body = buffer.subarray(headerEnd + 4);
  const contentLength = Number(headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength >= 0) {
    return body.length >= contentLength ? parseProxyHttpResponse(buffer) : null;
  }

  if (headers.get("transfer-encoding")?.toLowerCase().includes("chunked")) {
    return hasCompleteChunkedBody(body) ? parseProxyHttpResponse(buffer) : null;
  }

  return null;
}

function parseHeaders(headerText: string) {
  const [, ...headerLines] = headerText.split("\r\n");
  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function hasCompleteChunkedBody(body: Buffer) {
  let offset = 0;
  while (offset < body.length) {
    const lineEnd = body.indexOf("\r\n", offset);
    if (lineEnd === -1) return false;
    const sizeText = body.subarray(offset, lineEnd).toString("ascii").split(";")[0]?.trim() ?? "";
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) return false;
    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + size;
    if (body.length < chunkEnd + 2) return false;
    if (size === 0) {
      return body.indexOf("\r\n\r\n", lineEnd) !== -1 || body.length >= lineEnd + 4;
    }
    offset = chunkEnd + 2;
  }
  return false;
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
