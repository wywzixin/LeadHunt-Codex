// scripts/probe-contacts.mjs
// 不改业务代码。用与 LeadQualificationService 完全一致的 fetch 配置
// (8s timeout、机器人 UA、accept: text/html, text/plain) 复测下面几个站点
// 看真实情况下 API 能拿到什么 HTML、能解析出哪些邮箱/电话/混淆/mailto。
// 同时探测一组备选 contact 页路径，输出 status / contentType / 长度 / 邮箱样本。
//
// 用法：
//   node scripts/probe-contacts.mjs

const TIMEOUT_MS = 8000;
const UA = "Mozilla/5.0 (compatible; LeadHuntAI/0.1 contact enrichment)";

const targets = [
  "https://www.winncom.com/en/contacts",
  "https://www.winncom.com/contacts",
  "https://www.winncom.com/",
  "https://nesicsa.com/about.php?lang=en",
  "https://nesicsa.com/contact.php?lang=en",
  "https://nesicsa.com/",
  "https://neodatatechnologies.com/contact-us/",
  "https://neodatatechnologies.com/contact",
  "https://neodatatechnologies.com/",
  "https://www.gbiinc.com/contact-us-gbi/",
  "https://www.gbiinc.com/contact",
  "https://www.gbiinc.com/",
  "https://kalaam-telecom.com/",
  "https://www.kalaam-telecom.com/",
  "https://kalaam-telecom.com/contact",
  "https://kalaam-telecom.com/contact-us"
];

const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const phoneRe = /\+?\d[\d\s().-]{7,}\d/g;

function maskHtml(html) {
  return {
    htmlLen: html.length,
    titleMatch: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1].slice(0, 200),
    cfObf: (html.match(/data-cfemail="[a-f0-9]+"/g) || []).length,
    cfEmailProtection: (html.match(/email-protection/gi) || []).length,
    mailtoCount: (html.match(/mailto:/gi) || []).length,
    telLinks: (html.match(/href=["']tel:[^"']+["']/gi) || []).length,
    iframeCount: (html.match(/<iframe\b/gi) || []).length,
    scriptCount: (html.match(/<script\b/gi) || []).length,
    formCount: (html.match(/<form\b/gi) || []).length,
    emailsRaw: Array.from(new Set((html.match(emailRe) || []).map((s) => s.toLowerCase()))).slice(0, 12),
    phonesRaw: Array.from(new Set((html.match(phoneRe) || []).map((s) => s.replace(/\s+/g, " ").trim()))).slice(0, 8)
  };
}

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": UA
      }
    });
    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url;
    let body = {};
    if (
      resp.ok &&
      (contentType.includes("text/html") || contentType.includes("text/plain"))
    ) {
      const html = await resp.text();
      body = maskHtml(html);
    } else {
      // 内容类型不匹配，直接像 API 当前实现一样返回空
      try {
        const html = await resp.text();
        body = { ...maskHtml(html), note: "non-html content-type, would be dropped by fetchText" };
      } catch (e) {
        body = { note: "no body", err: String(e).slice(0, 120) };
      }
    }
    return {
      url,
      ms: Date.now() - t0,
      status: resp.status,
      contentType,
      finalUrl: finalUrl !== url ? finalUrl : undefined,
      ...body
    };
  } catch (e) {
    return {
      url,
      ms: Date.now() - t0,
      status: 0,
      err: String(e).slice(0, 200)
    };
  } finally {
    clearTimeout(timer);
  }
}

const out = [];
for (const url of targets) {
  // eslint-disable-next-line no-await-in-loop
  out.push(await probe(url));
}
console.log(JSON.stringify(out, null, 2));
