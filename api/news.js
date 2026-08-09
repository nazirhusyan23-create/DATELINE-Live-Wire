// /api/news.js
// A tiny Vercel Serverless Function — this is the ONLY "backend" this app has.
// It just fetches Google News RSS server-side (where CORS doesn't apply) and
// hands the raw XML back to the browser. No database, no state, no auth.

const FEEDS = {
  top:           "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
  world:         "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en",
  pakistan:      "https://news.google.com/rss?hl=en-PK&gl=PK&ceid=PK:en",
  business:      "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en",
  technology:    "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en",
  science:       "https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en",
  health:        "https://news.google.com/rss/headlines/section/topic/HEALTH?hl=en-US&gl=US&ceid=US:en",
  entertainment: "https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en",
  sports:        "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en",
};

export default async function handler(req, res) {
  const { category, q } = req.query;

  const rssUrl = q
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
    : FEEDS[category] || FEEDS.top;

  try {
    const upstream = await fetch(rssUrl, {
      headers: {
        // Google News is picky about default fetch UAs — pretend to be a normal browser
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });

    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream feed responded ${upstream.status}` });
      return;
    }

    const xml = await upstream.text();

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    // Cache each feed for 5 minutes at the edge, serve stale for another 10 while revalidating
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).send(xml);
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch upstream feed", detail: String(err) });
  }
}
