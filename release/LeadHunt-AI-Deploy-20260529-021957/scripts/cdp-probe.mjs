// Minimal CDP probe over built-in WebSocket (Node >= 22).
// Usage: node scripts/cdp-probe.mjs [tabId] [url]
// Defaults: connect to the LeadHunt page on localhost:3000.

import { writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

const HOST = "127.0.0.1";
const PORT = 9222;
const TARGET_URL = process.argv[3] ?? "http://localhost:3000/";
const PREFERRED_ID = process.argv[2];
const VIEWPORT = { width: 1707, height: 932, dsf: 1 };

async function listTargets() {
  const res = await fetch(`http://${HOST}:${PORT}/json/list`);
  if (!res.ok) throw new Error(`json/list ${res.status}`);
  return res.json();
}

async function pickTarget() {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === "page");
  if (PREFERRED_ID) {
    const found = pages.find((p) => p.id === PREFERRED_ID);
    if (found) return found;
  }
  const local = pages.find((p) => p.url.startsWith("http://localhost:3000"));
  if (local) return local;
  return pages[0];
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.eventHandlers = new Map();
    ws.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : event.data.toString();
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.code} ${msg.error.message}`));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        const handlers = this.eventHandlers.get(msg.method) ?? [];
        for (const h of handlers) h(msg.params);
      }
    });
  }

  on(method, handler) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, []);
    this.eventHandlers.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function main() {
  const target = await pickTarget();
  if (!target) throw new Error("no page target");
  console.error(`target: ${target.id} ${target.title} ${target.url}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", (e) => rej(e));
  });
  const cdp = new CDP(ws);

  const consoleErrors = [];
  const requestFailures = [];
  const networkResponses = new Map();

  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error" || p.type === "warning") {
      consoleErrors.push({
        type: p.type,
        text: (p.args ?? [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
          .join(" ")
      });
    }
  });
  cdp.on("Runtime.exceptionThrown", (p) => {
    consoleErrors.push({
      type: "exception",
      text: p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text
    });
  });
  cdp.on("Network.responseReceived", (p) => {
    networkResponses.set(p.requestId, { url: p.response.url, status: p.response.status });
  });
  cdp.on("Network.loadingFailed", (p) => {
    const meta = networkResponses.get(p.requestId);
    requestFailures.push({ url: meta?.url ?? "(unknown)", error: p.errorText, status: meta?.status });
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: VIEWPORT.dsf,
    mobile: false
  });

  // Only navigate if URL differs; otherwise just probe current state.
  const currentUrl = target.url;
  if (currentUrl !== TARGET_URL) {
    console.error(`navigate -> ${TARGET_URL}`);
    const navResult = await cdp.send("Page.navigate", { url: TARGET_URL });
    if (navResult.errorText) throw new Error(`navigate failed: ${navResult.errorText}`);
    await Promise.race([
      new Promise((resolve) => cdp.on("Page.loadEventFired", () => resolve())),
      wait(8000)
    ]);
  }

  // Let SPA settle.
  await wait(1500);

  const summary = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const html = document.documentElement;
      const body = document.body;
      return JSON.stringify({
        title: document.title,
        url: location.href,
        readyState: document.readyState,
        viewport: { iw: window.innerWidth, ih: window.innerHeight },
        scroll: {
          docW: html.scrollWidth, docH: html.scrollHeight,
          clientW: html.clientWidth, clientH: html.clientHeight,
          hasHorizontalScroll: html.scrollWidth > html.clientWidth + 1,
          hasVerticalScroll: html.scrollHeight > html.clientHeight + 1
        },
        headerText: (document.querySelector('header')?.innerText || '').slice(0, 400),
        navText: (document.querySelector('nav')?.innerText || '').slice(0, 800),
        mainText: (document.querySelector('main')?.innerText || '').slice(0, 1200),
        bodySnippet: (body?.innerText || '').slice(0, 1500)
      });
    })()`,
    returnByValue: true,
    awaitPromise: false,
    timeout: 5000
  });

  let parsed = null;
  try {
    parsed = JSON.parse(summary.result.value);
  } catch {
    parsed = { raw: summary.result };
  }

  const screenshotResp = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  mkdirSync(".logs", { recursive: true });
  const shotPath = `.logs/cdp-probe-${Date.now()}.png`;
  writeFileSync(shotPath, Buffer.from(screenshotResp.data, "base64"));

  ws.close();

  const result = {
    target: { id: target.id, title: target.title, url: target.url },
    page: parsed,
    consoleErrors,
    requestFailures,
    screenshot: shotPath
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
