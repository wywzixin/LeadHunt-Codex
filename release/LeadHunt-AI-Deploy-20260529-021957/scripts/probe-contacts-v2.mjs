// scripts/probe-contacts-v2.mjs
// 在 Codex 修复（Sucuri 307 cookie 重试）之上，再独立验证两个 Codex 没动的可能性：
//   A. 真实 Chrome UA + 完整 accept-language / sec-fetch-* / upgrade-insecure-requests
//      能不能让 Winncom 这种纯 Bot Fight 的 Cloudflare 站直接放行
//   B. 把 contact probe 超时从 8s 拉到 20s，看 Kalaam 是真的中东路由阻断
//      还是只是 8s 太紧
// 同时把 Sucuri 307 cookie 重试也复刻进来确认 NeoData 的修复对外能拿到邮箱
// 不修业务代码，只跑只读 fetch
//
// 用法：
//   node scripts/probe-contacts-v2.mjs

const TIMEOUT_FAST = 8000;
const TIMEOUT_LONG = 20000;

const BOT_UA = "Mozilla/5.0 (compatible; LeadHuntAI/0.1 contact enrichment)";
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const headerPresets = {
  bot: {
    accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
    "user-agent": BOT_UA
  },
  realChrome: {
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": REAL_UA,
    "upgrade-insecure-requests": "1",
    "sec-ch-ua":
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1"
  }
};

const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

async function fetchOnce(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers
    });
    const setCookie = resp.headers.get("set-cookie");
    const ct = resp.headers.get("content-type") || "";
    const html = await resp.text();
    return {
      ok: resp.ok,
      status: resp.status,
      contentType: ct,
      finalUrl: resp.url,
      ms: Date.now() - t0,
      setCookie,
      html
    };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, err: String(e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

// 复刻 Codex 的 extractSucuriChallengeCookie 逻辑（抓 sucuri_cloudproxy + redirect 页面里的 cookie）
function extractSucuriChallengeCookie(html) {
  if (!html) return null;
  if (!/sucuri_cloud(?:proxy|flare)?/i.test(html) && !/You are being redirected/i.test(html)) {
    return null;
  }
  // Sucuri 把 cookie 写在内联 JS 里，例如：
  //   document.cookie='sucuri_cloudproxy_uuid_xxx=yyyy;path=/;...';
  const m = html.match(/document\.cookie\s*=\s*['"]([^'";]+)['"]/i);
  return m ? m[1] : null;
}

async function probeRich(url, presetName, timeoutMs) {
  const headers = { ...headerPresets[presetName] };
  const first = await fetchOnce(url, headers, timeoutMs);
  let secondTried = false, secondStatus = null, secondHtmlLen = 0, secondEmails = [];
  let cookieFromBody = null;

  // Sucuri 307 二次重试（仿 Codex 实现）
  if (first.html && first.status >= 300 && first.status < 400) {
    cookieFromBody = extractSucuriChallengeCookie(first.html);
    if (cookieFromBody) {
      secondTried = true;
      const second = await fetchOnce(
        url,
        { ...headers, cookie: cookieFromBody },
        timeoutMs
      );
      secondStatus = second.status;
      const html = second.html || "";
      secondHtmlLen = html.length;
      secondEmails = Array.from(
        new Set((html.match(emailRe) || []).map((s) => s.toLowerCase()))
      ).slice(0, 8);
    }
  }

  return {
    url,
    preset: presetName,
    timeoutMs,
    first: {
      status: first.status,
      ms: first.ms,
      contentType: first.contentType,
      htmlLen: (first.html || "").length,
      title: first.html
        ? (first.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1].slice(0, 80)
        : "",
      emailsCount: first.html ? (first.html.match(emailRe) || []).length : 0,
      err: first.err,
      finalUrl: first.finalUrl !== url ? first.finalUrl : undefined
    },
    sucuriRetry: secondTried
      ? {
          cookie: cookieFromBody ? cookieFromBody.split(";")[0] : null,
          status: secondStatus,
          htmlLen: secondHtmlLen,
          emails: secondEmails
        }
      : null
  };
}

const tests = [
  // Cloudflare WAF — 只有 UA 升级能救
  { url: "https://www.winncom.com/en/contacts", preset: "bot", timeout: TIMEOUT_FAST },
  { url: "https://www.winncom.com/en/contacts", preset: "realChrome", timeout: TIMEOUT_FAST },

  // Sucuri 307 — Codex 的修复目标
  { url: "https://neodatatechnologies.com/contact-us/", preset: "bot", timeout: TIMEOUT_FAST },
  { url: "https://neodatatechnologies.com/contact-us/", preset: "realChrome", timeout: TIMEOUT_FAST },

  // Kalaam — 国内→中东超时
  { url: "https://kalaam-telecom.com/", preset: "realChrome", timeout: TIMEOUT_FAST },
  { url: "https://kalaam-telecom.com/", preset: "realChrome", timeout: TIMEOUT_LONG }
];

const out = [];
for (const t of tests) {
  // eslint-disable-next-line no-await-in-loop
  out.push(await probeRich(t.url, t.preset, t.timeout));
}
console.log(JSON.stringify(out, null, 2));
