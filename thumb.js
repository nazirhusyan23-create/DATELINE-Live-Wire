// /api/thumb.js
// Best-effort article thumbnail fetcher.
//
// Google News RSS does not include images in the feed data at all, so for
// each article we try to follow its link server-side (no CORS issues here)
// and read the publisher page's <meta property="og:image"> tag — the same
// tag Facebook/Twitter/Slack use to generate link previews.
//
// This works for most publishers. Some Google News redirect links resolve
// to a page that needs JavaScript to reach the real article, so those will
// come back empty — the frontend falls back to a plain placeholder card in
// that case, it does not error out.

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) {
    res.status(400).json({ error: "Missing url" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const upstream = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      res.setHeader("Cache-Control", "s-maxage=3600");
      res.status(200).json({ image: null });
      return;
    }

    // og:image lives in <head>, so we only need to read the first chunk of
    // the page — no point downloading the entire article body/scripts.
    const html = await readPartial(upstream, 200_000);

    const image =
      matchMeta(html, "og:image:secure_url") ||
      matchMeta(html, "og:image") ||
      matchMeta(html, "twitter:image");

    // Cache aggressively — thumbnails don't change once an article is published.
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    res.status(200).json({ image: image || null });
  } catch (err) {
    clearTimeout(timeout);
    // Any failure (timeout, no og:image, blocked, etc.) — fail soft.
    res.setHeader("Cache-Control", "s-maxage=1800");
    res.status(200).json({ image: null });
  }
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
