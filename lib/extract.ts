import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const MAX_BYTES = 2_000_000;
const MAX_CHARS = 30_000;

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Guards against SSRF: only public http(s) hosts may be fetched. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https links are supported.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("That link points to a private address.");
  }
  return url;
}

export async function extractArticle(raw: string): Promise<{ title: string; text: string }> {
  let url = await assertPublicUrl(raw);
  let res: Response | undefined;
  // Follow redirects manually so every hop is checked.
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "AI-Podcast-Studio/1.0 (+portfolio project)", accept: "text/html,text/plain" },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`Couldn't open that page (status ${res?.status ?? "unknown"}).`);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("That page is too large to read.");
  const html = (await res.text()).slice(0, MAX_BYTES);

  if (!(res.headers.get("content-type") ?? "").includes("html")) {
    return { title: url.hostname, text: html.slice(0, MAX_CHARS) };
  }

  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as Document).parse();
  const text = (article?.textContent ?? "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 200) throw new Error("Couldn't find readable article text on that page. Try pasting the text instead.");
  return { title: article?.title ?? url.hostname, text: text.slice(0, MAX_CHARS) };
}
