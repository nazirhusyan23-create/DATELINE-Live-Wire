// /api/thumb.js
// Best-effort article thumbnail + summary fetcher.
//
// Google News RSS gives us neither a real image nor a real summary — its
// <description> field is just the headline again. And the RSS <link> is a
// Google redirect page that only resolves to the real publisher URL via
// client-side JavaScript in a real browser — a plain server-side fetch just
// gets Google's redirect shell, not the article.
//
// To get real data we have to:
//   1) Scrape a signature/timestamp/id triple out of that redirect page
//   2) POST it to Google News' internal (undocumented) batchexecute
//      endpoint to get back the real publisher URL
//   3) Fetch THAT page once and read its og:image AND meta description —
//      the same tags Facebook/Twitter/Google Search use for link previews.
//
// This mirrors Google's own internal decoding and is not officially
// documented or supported — it can break if Google changes the mechanism.
// Every step fails soft: any failure just returns nulls and the frontend
// falls back to a placeholder image / a plain "read the source" line,
// never an error.

const UA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

// Vercel Hobby allows up to 300s per function — the default without this
// export is much lower, which was cutting us off mid-request (the initial
// Google redirect page alone can be 500KB+ and slow to fetch in full).
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const { url, debug } = req.query;
  if (!url) {
    res.status(400).json({ error: "Missing url" });
    return;
  }

  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const trace = [];
  const mark = (entry) => trace.push({ ...entry, elapsedMs: Date.now() - t0 });

  try {
    const resolved = await resolveGoogleNewsUrl(url, controller.signal, trace, t0);
    const targetUrl = resolved || url;

    const upstream = await fetch(targetUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: UA_HEADERS,
    });
    mark({ step: "fetch-target", url: targetUrl, status: upstream.status });

    if (!upstream.ok) {
      clearTimeout(timeout);
      res.setHeader("Cache-Control", "s-maxage=3600");
      res.status(200).json({ image: null, description: null, ...(debug ? { trace } : {}) });
      return;
    }

    const html = await readPartial(upstream, 250_000);
    mark({ step: "read-target-body", length: html.length });

    const image =
      matchMeta(html, "og:image:secure_url") ||
      matchMeta(html, "og:image") ||
      matchMeta(html, "twitter:image");

    const description = cleanSummary(
      matchMeta(html, "og:description") ||
      matchMeta(html, "twitter:description") ||
      matchMeta(html, "description")
    );
    mark({ step: "extract", foundImage: Boolean(image), foundDescription: Boolean(description) });

    clearTimeout(timeout);
    res.setHeader("Cache-Control", debug ? "no-store" : "s-maxage=21600, stale-while-revalidate=86400");
    res.status(200).json({ image: image || null, description: description || null, ...(debug ? { trace } : {}) });
  } catch (err) {
    clearTimeout(timeout);
    mark({ step: "error", message: String(err) });
    res.setHeader("Cache-Control", "s-maxage=1800");
    res.status(200).json({ image: null, description: null, ...(debug ? { trace } : {}) });
  }
}

// Resolves a news.google.com/rss/articles/... link to the real publisher
// URL. Tries a few strategies, cheapest/most-likely-to-work first, and
// falls through on any failure — never throws.
async function resolveGoogleNewsUrl(url, signal, trace, t0) {
  const mark = (entry) => trace.push({ ...entry, elapsedMs: Date.now() - t0 });

  if (!url.includes("news.google.com")) {
    mark({ step: "resolve", note: "not a google news link, using as-is" });
    return url;
  }

  let html;
  try {
    const pageRes = await fetch(url, { signal, headers: UA_HEADERS });
    html = await pageRes.text();
    mark({ step: "fetch-redirect-page", status: pageRes.status, length: html.length });
  } catch (err) {
    mark({ step: "fetch-redirect-page", error: String(err) });
    return null;
  }

  // Strategy 1: a plain <link rel="canonical"> or meta-refresh sometimes
  // points straight at the real article — cheap to check, no extra request.
  const canonical =
    firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
    firstMatch(html, /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"'>]+)["']/i);
  if (canonical && !canonical.includes("news.google.com")) {
    mark({ step: "resolve-canonical", found: canonical });
    return canonical;
  }

  // Strategy 2: Google's internal signature-based decode endpoint.
  const signature = firstMatch(html, /data-n-a-sg="([^"]+)"/);
  const timestamp = firstMatch(html, /data-n-a-ts="([^"]+)"/);
  const articleId = firstMatch(html, /data-n-a-id="([^"]+)"/);
  mark({ step: "resolve-signature-markers", hasSignature: Boolean(signature), hasTimestamp: Boolean(timestamp), hasArticleId: Boolean(articleId) });
  if (!signature || !timestamp || !articleId) return null;

  const innerParams = [
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
      "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    articleId,
    timestamp,
    signature,
  ];
  const fReq = JSON.stringify([[["Fbv4je", JSON.stringify(innerParams)]]]);

  let text;
  try {
    const decodeRes = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      signal,
      headers: {
        ...UA_HEADERS,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "referer": "https://news.google.com/",
      },
      body: new URLSearchParams({ "f.req": fReq }).toString(),
    });
    text = await decodeRes.text();
    mark({ step: "batchexecute", status: decodeRes.status, length: text.length });
  } catch (err) {
    mark({ step: "batchexecute", error: String(err) });
    return null;
  }

  const line = text.split("\n").find((l) => l.trim().startsWith('[["wrb.fr"'));
  if (!line) {
    mark({ step: "batchexecute-parse", note: "no wrb.fr line found", sample: text.slice(0, 200) });
    return null;
  }

  try {
    const outer = JSON.parse(line);
    const inner = JSON.parse(outer[0][2]);
    mark({ step: "batchexecute-parse", found: Boolean(inner[1]) });
    return inner[1] || null;
  } catch (err) {
    mark({ step: "batchexecute-parse", error: String(err) });
    return null;
  }
}

function firstMatch(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

async function readPartial(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  while (bytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    html += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return html;
}

function matchMeta(html, prop) {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? m[1] : null;
}

function cleanSummary(raw) {
  if (!raw) return null;
  const decoded = raw
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!decoded || decoded.length < 20) return null; // too short to be a real summary
  return decoded.length > 280 ? decoded.slice(0, 277).trimEnd() + "…" : decoded;
}
