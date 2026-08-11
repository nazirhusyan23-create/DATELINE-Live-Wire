/* =========================================================
   DATELINE — Live Wire
   Frontend: HTML + Tailwind + vanilla JS.
   "Backend": one tiny Vercel Serverless Function (/api/news.js)
   that fetches Google News RSS server-side, where CORS doesn't
   apply — no database, no auth, no state. Deploys automatically
   with the rest of the project on Vercel's free tier.

   Weather: Open-Meteo (free, no API key) + browser geolocation
   with an IP-based fallback.

   Financial ticker: USD/PKR is pulled live from a free, keyless
   FX endpoint. Gold (oz) and the market index are simulated with
   a small random walk each refresh — real gold/index feeds
   require a paid API key, so swap fetchGoldAndIndex() for a real
   provider (e.g. metals-api.com, a stock-data API) in production.
   ========================================================= */

const CATEGORIES = [
  { id: "top",           label: "Top Headlines", icon: "◆" },
  { id: "world",         label: "World",         icon: "◈" },
  { id: "pakistan",      label: "Pakistan",      icon: "★" },
  { id: "business",      label: "Business",      icon: "◉" },
  { id: "technology",    label: "Technology",    icon: "◇" },
  { id: "science",       label: "Science",       icon: "◎" },
  { id: "health",        label: "Health",        icon: "✚" },
  { id: "entertainment", label: "Entertainment", icon: "♫" },
  { id: "sports",        label: "Sports",        icon: "●" },
  { id: "tools",         label: "Tools",         icon: "🧮" },
];

const state = {
  category: "top",
  query: "",
  articles: [],
  loading: false,
};

// ---------- DOM refs ----------
const navRail       = document.querySelector("nav.cat-rail");
const sectionTitle  = document.getElementById("sectionTitle");
const resultCount   = document.getElementById("resultCount");
const featuredEl    = document.getElementById("featured");
const gridEl        = document.getElementById("grid");
const skeletonsEl   = document.getElementById("skeletons");
const emptyStateEl  = document.getElementById("emptyState");
const errorBanner   = document.getElementById("errorBanner");
const errorText     = document.getElementById("errorText");
const tickerTrack   = document.getElementById("tickerTrack");
const finTickerTrack= document.getElementById("finTickerTrack");
const searchForm    = document.getElementById("searchForm");
const searchInput   = document.getElementById("searchInput");
const refreshBtn    = document.getElementById("refreshBtn");
const refreshIcon   = document.getElementById("refreshIcon");
const clockEl       = document.getElementById("clock");
const savedBtn      = document.getElementById("savedBtn");
const notifyBtn     = document.getElementById("notifyBtn");

const modalOverlay  = document.getElementById("modalOverlay");
const modalClose    = document.getElementById("modalClose");
const modalCategory = document.getElementById("modalCategory");
const modalImageWrap= document.getElementById("modalImageWrap");
const modalTitle    = document.getElementById("modalTitle");
const modalMeta     = document.getElementById("modalMeta");
const modalDesc     = document.getElementById("modalDesc");
const modalLink     = document.getElementById("modalLink");
const modalListenBtn   = document.getElementById("modalListenBtn");
const modalBookmarkBtn = document.getElementById("modalBookmarkBtn");

const weatherBody    = document.getElementById("weatherBody");
const weatherCityForm = document.getElementById("weatherCityForm");
const weatherCityInput = document.getElementById("weatherCityInput");

// ---------- tools (calculators) DOM refs ----------
const toolsSection   = document.getElementById("toolsSection");
const toolsRatesLine = document.getElementById("toolsRatesLine");

const goldKarat  = document.getElementById("goldKarat");
const goldUnit   = document.getElementById("goldUnit");
const goldQty    = document.getElementById("goldQty");
const goldResult = document.getElementById("goldResult");
const goldBreakdown = document.getElementById("goldBreakdown");

const zakatGoldGrams  = document.getElementById("zakatGoldGrams");
const zakatGoldKarat  = document.getElementById("zakatGoldKarat");
const zakatSilverGrams = document.getElementById("zakatSilverGrams");
const zakatCash       = document.getElementById("zakatCash");
const zakatOther      = document.getElementById("zakatOther");
const zakatNisabBasis = document.getElementById("zakatNisabBasis");
const zakatResult     = document.getElementById("zakatResult");
const zakatBreakdown  = document.getElementById("zakatBreakdown");

const fxAmount  = document.getElementById("fxAmount");
const fxFrom    = document.getElementById("fxFrom");
const fxTo      = document.getElementById("fxTo");
const fxSwapBtn = document.getElementById("fxSwapBtn");
const fxResult  = document.getElementById("fxResult");
const fxBreakdown = document.getElementById("fxBreakdown");

const emiPrincipal = document.getElementById("emiPrincipal");
const emiRate       = document.getElementById("emiRate");
const emiMonths     = document.getElementById("emiMonths");
const emiResult     = document.getElementById("emiResult");
const emiBreakdown  = document.getElementById("emiBreakdown");

// ---------- text helpers ----------

// Google News (and many RSS feeds) double-encode entities, so the raw text
// node itself can contain literal characters like "&#x27;" instead of a
// real apostrophe. Round-tripping through a <textarea> decodes any level
// of HTML-entity encoding using the browser's own parser — safer and more
// complete than a hand-rolled regex table.
function decodeEntities(str) {
  if (!str) return "";
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
}

// Escapes plain text for safe insertion into innerHTML templates. Applied
// at render time to every RSS-derived string (headline, source, desc) so
// decoded content can never be interpreted as markup.
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ---------- helpers ----------

// Ask our own /api/news serverless function for a feed's raw RSS/XML.
// (No CORS proxies needed — the function runs server-side on Vercel.)
async function fetchRssXml({ category, q }) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  else params.set("category", category || "top");

  const res = await fetch(`/api/news?${params.toString()}`);
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch { /* ignore */ }
    throw new Error(detail || `Feed request failed (${res.status})`);
  }
  const text = await res.text();
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror") || !xml.querySelector("item")) {
    throw new Error("Feed XML could not be parsed");
  }
  return xml;
}

// Turn a parsed RSS <channel> document into our article objects
function parseRssItems(xmlDoc) {
  return Array.from(xmlDoc.querySelectorAll("item")).map((item) => {
    const rawTitle = decodeEntities((item.querySelector("title")?.textContent || "").trim());
    const link     = (item.querySelector("link")?.textContent || "#").trim();
    const pubDate  = (item.querySelector("pubDate")?.textContent || "").trim();
    const descHtml = item.querySelector("description")?.textContent || "";
    const sourceTag = decodeEntities((item.querySelector("source")?.textContent || "").trim());

    const { headline, source } = splitSourceFromTitle(rawTitle, sourceTag);
    let desc = decodeEntities(stripHtml(descHtml));
    // Google News descriptions are usually just the headline again — drop if redundant
    if (!desc || desc.toLowerCase().includes(headline.toLowerCase().slice(0, 20))) desc = "";
    desc = desc.slice(0, 220);

    return {
      title: rawTitle,
      link,
      pubDate,
      _headline: headline,
      _source: source || "Google News",
      _desc: desc,
      _timeAgo: timeAgo(pubDate),
      _minutesAgo: minutesSince(pubDate),
      _readMins: calcReadTime(headline, desc),
      thumbnail: null,
      description: descHtml,
    };
  });
}

function stripHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return (tmp.textContent || tmp.innerText || "").trim();
}

function minutesSince(dateStr) {
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return Infinity;
  return Math.max(0, Math.round((Date.now() - then) / 60000));
}

function timeAgo(dateStr) {
  const diffMin = minutesSince(dateStr);
  if (!Number.isFinite(diffMin)) return "";
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

// Rough reading time from word count at ~200 wpm, always at least 1 minute.
function calcReadTime(headline, desc) {
  const words = `${headline} ${desc}`.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// A headline counts as "breaking" if it's one of the top few stories in an
// unfiltered feed AND was published within the last hour.
function isBreakingArticle(article, positionIdx) {
  return positionIdx < 6 && article._minutesAgo <= 60;
}

// Google News RSS wraps source name into the title as " - Source".
// A real <source> tag (when present) is more reliable than the regex split.
function splitSourceFromTitle(title, sourceTag) {
  if (sourceTag && title.endsWith(sourceTag)) {
    return { headline: title.slice(0, title.length - sourceTag.length).replace(/\s-\s$/, "").trim(), source: sourceTag };
  }
  const m = title.match(/^(.*)\s-\s([^-]+)$/);
  if (m) return { headline: m[1].trim(), source: sourceTag || m[2].trim() };
  return { headline: title, source: sourceTag || "" };
}

// Try to pull an image out of the RSS item's description/content, if any.
// Google News descriptions basically never contain one, but this is free
// to check and other RSS sources sometimes do embed one.
function extractImage(item) {
  if (item.thumbnail) return item.thumbnail;
  const html = item.description || item.content || "";
  const m = html.match(/<img[^>]+src="([^">]+)"/i);
  return m ? m[1] : null;
}

// A styled monogram tile used while a thumbnail is loading, or as the
// permanent fallback when /api/thumb can't find a real image for a story.
function placeholderThumb(source) {
  const initial = (source || "?").trim().charAt(0).toUpperCase() || "?";
  return `<div class="thumb-placeholder w-full h-full grid place-items-center"><span class="font-display text-3xl text-brass/30 select-none">${initial}</span></div>`;
}

function breakingBadgeHtml(size) {
  const isSmall = size === "sm";
  return `<span class="breaking-badge absolute top-${isSmall ? "2" : "3"} right-${isSmall ? "2" : "3"} bg-wire text-brass font-mono ${isSmall ? "text-[9px] px-2 py-0.5" : "text-[10px] px-2.5 py-1"} font-bold uppercase tracking-[0.12em] rounded-full border border-brass/60">● Breaking</span>`;
}

function readBadgeHtml(mins, size) {
  const isSmall = size === "sm";
  return `<span class="font-mono ${isSmall ? "text-[9px] px-1.5" : "text-[10px] px-2"} uppercase tracking-wider text-mute border border-hair rounded-full py-0.5">${mins} min read</span>`;
}

// ---------- enrichment (best-effort real image + summary, via /api/thumb) ----------
const enrichCache = new Map();     // link -> { image, description } | null (tried, nothing found)
const enrichInFlight = new Map();  // link -> in-progress promise

async function getEnrichment(link) {
  if (!link) return null;
  if (enrichCache.has(link)) return enrichCache.get(link);
  if (enrichInFlight.has(link)) return enrichInFlight.get(link);

  const promise = fetch(`/api/thumb?url=${encodeURIComponent(link)}`)
    .then(r => (r.ok ? r.json() : { image: null, description: null }))
    .then(d => {
      const result = { image: d.image || null, description: d.description ? decodeEntities(d.description) : null };
      enrichCache.set(link, result);
      return result;
    })
    .catch(() => { enrichCache.set(link, null); return null; })
    .finally(() => enrichInFlight.delete(link));

  enrichInFlight.set(link, promise);
  return promise;
}

// Runs `worker` over `items` with at most `limit` requests in flight at
// once — lets us enrich every card on the page (not just visible ones, so
// crawlers that don't scroll still see real summaries) without firing 30-40
// requests simultaneously.
async function runWithConcurrency(items, limit, worker) {
  let i = 0;
  const lanes = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item).catch(() => {});
    }
  });
  await Promise.all(lanes);
}

// Fills in a rendered card's thumbnail and/or description once real data
// is available. Leaves the placeholder image / fallback line in place if
// nothing could be found for that particular story.
async function enrichCard(cardEl) {
  const link = cardEl.dataset.link;
  if (!link || !cardEl.isConnected) return;

  const result = await getEnrichment(link);
  if (!result || !cardEl.isConnected) return;

  if (result.image) {
    const thumbSlot = cardEl.querySelector(".thumb-slot");
    if (thumbSlot) {
      const img = new Image();
      img.alt = "";
      img.className = thumbSlot.dataset.imgClass || "w-full h-full object-cover";
      img.onload = () => {
        // Preserve any badge overlays (Featured / Breaking) already in the slot
        const badges = Array.from(thumbSlot.children).filter(c => c.tagName === "SPAN");
        thumbSlot.innerHTML = "";
        thumbSlot.appendChild(img);
        badges.forEach(b => thumbSlot.appendChild(b));
      };
      img.onerror = () => {};
      img.src = result.image;
    }
  }

  if (result.description) {
    const descSlot = cardEl.querySelector(".desc-slot");
    if (descSlot && descSlot.dataset.hasLocalDesc !== "true") {
      descSlot.textContent = result.description;
    }
  }
}

// Kicks off enrichment for every card currently in the grid/featured
// section. Called right after render — not gated on scroll — so summaries
// are populated whether or not a visitor (or a crawler) scrolls the page.
function enrichVisibleCards(container) {
  const cards = Array.from(container.querySelectorAll("[data-link]"));
  runWithConcurrency(cards, 5, enrichCard);
}

function categoryMeta(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[0];
}

// ---------- text-to-speech ("Listen" button) ----------
const ttsState = { link: null, button: null };

function setListenBtnLabel(btn, mode) {
  if (!btn) return;
  btn.innerHTML = mode === "playing" ? "⏸️ Pause" : "▶️ Listen";
}

function resetTts() {
  setListenBtnLabel(ttsState.button, "idle");
  ttsState.link = null;
  ttsState.button = null;
}

function toggleListen(article, btn) {
  if (!("speechSynthesis" in window)) {
    alert("Text-to-speech isn't supported in this browser.");
    return;
  }
  const synth = window.speechSynthesis;

  // Clicking the article that's already loaded — toggle pause/resume
  if (ttsState.link === article.link) {
    if (synth.speaking && !synth.paused) {
      synth.pause();
      setListenBtnLabel(btn, "idle");
    } else if (synth.paused) {
      synth.resume();
      setListenBtnLabel(btn, "playing");
    }
    return;
  }

  // Switching articles — stop whatever was playing and start fresh
  synth.cancel();
  resetTts();

  const text = `${article._headline}. ${article._desc || ""}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.onend = () => { if (ttsState.link === article.link) resetTts(); };
  utterance.onerror = () => { if (ttsState.link === article.link) resetTts(); };

  ttsState.link = article.link;
  ttsState.button = btn;
  setListenBtnLabel(btn, "playing");
  synth.speak(utterance);
}

// ---------- bookmarks ("Save for Later") ----------
const BOOKMARKS_KEY = "dateline_bookmarks_v1";

function getBookmarks() {
  try {
    const raw = JSON.parse(localStorage.getItem(BOOKMARKS_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function isBookmarked(link) {
  return getBookmarks().some(b => b.link === link);
}

function toggleBookmark(article, btn) {
  let bookmarks = getBookmarks();
  const exists = bookmarks.some(b => b.link === article.link);

  if (exists) {
    bookmarks = bookmarks.filter(b => b.link !== article.link);
  } else {
    bookmarks.push({
      link: article.link,
      title: article._headline,
      source: article._source,
      readMins: article._readMins,
      savedAt: Date.now(),
    });
  }

  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch {
    // localStorage unavailable (private mode / quota) — fail silently, UI just won't persist
  }

  setBookmarkBtnState(btn, !exists);
  updateSavedBtnLabel();

  // If we're currently viewing the Saved list, remove the un-saved card immediately
  if (state.category === "saved" && exists) loadFeed();
}

function setBookmarkBtnState(btn, saved) {
  if (!btn) return;
  btn.innerHTML = saved ? "🔖 Saved" : "🔖 Save";
  btn.classList.toggle("text-brass", saved);
  btn.classList.toggle("border-brass/50", saved);
  btn.classList.toggle("text-mute", !saved);
}

function updateSavedBtnLabel() {
  if (!savedBtn) return;
  const count = getBookmarks().length;
  savedBtn.innerHTML = `🔖 Saved${count ? ` (${count})` : ""}`;
  const active = state.category === "saved";
  savedBtn.classList.toggle("text-brass", active);
  savedBtn.classList.toggle("border-brass/50", active);
}

// Wires up the Listen + Save buttons inside a rendered card, and stops
// their clicks from also opening the article modal.
function attachCardControls(cardEl, article) {
  const listenBtn = cardEl.querySelector(".listen-btn");
  if (listenBtn) {
    listenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleListen(article, listenBtn);
    });
  }
  const bookmarkBtn = cardEl.querySelector(".bookmark-btn");
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleBookmark(article, bookmarkBtn);
    });
  }
}

function cardControlsHtml(article) {
  const saved = isBookmarked(article.link);
  return `
    <div class="flex items-center gap-2 mt-3 pt-1">
      <button type="button" class="listen-btn inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider border border-hair rounded-full px-2.5 py-1 text-mute hover:text-brass hover:border-brass/50 transition-colors" data-link="${escapeAttr(article.link)}">▶️ Listen</button>
      <button type="button" class="bookmark-btn inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider border border-hair rounded-full px-2.5 py-1 ${saved ? "text-brass border-brass/50" : "text-mute"} hover:text-brass hover:border-brass/50 transition-colors" data-link="${escapeAttr(article.link)}">${saved ? "🔖 Saved" : "🔖 Save"}</button>
    </div>
  `;
}

// ---------- live alerts (Notification API) ----------
// Works whenever this site is open in a browser tab — including backgrounded
// tabs — on a device connected to the internet. It notifies on new breaking
// headlines, meaningful weather changes, and gold price moves.
//
// It does NOT fire once the browser/tab is fully closed. True "closed app"
// push requires a Service Worker + the Push API + a backend that stores
// subscriptions and sends pushes (e.g. via VAPID keys and a scheduled job) —
// that's a separate backend feature, not something pure client-side JS can do.
const NOTIFY_PREF_KEY = "dateline_notify_pref_v1";
let notifyEnabled = localStorage.getItem(NOTIFY_PREF_KEY) === "1";
let notifySwRegistration = null;

function notificationsSupported() {
  return "Notification" in window;
}

// Mobile Chrome (Android) throws on `new Notification()` — it only allows
// notifications fired through a registered Service Worker's
// showNotification(). Desktop browsers support both, so registering this
// unconditionally makes notifications work the same way everywhere.
// Requires a secure context (https:// or localhost) — file:// won't work.
async function rahJ91ZuNL8Y2px8iYciYeHN8sfSh5eXH8() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    notifySwRegistration = reg;
    return reg;
  } catch (err) {
    console.error("Service worker registration failed (notifications need https:// or localhost):", err);
    return null;
  }
}

function updateNotifyBtn() {
  if (!notifyBtn) return;
  if (!notificationsSupported()) { notifyBtn.classList.add("hidden"); return; }
  const active = notifyEnabled && Notification.permission === "granted";
  notifyBtn.innerHTML = active ? "🔔 Notifying" : "🔕 Notify me";
  notifyBtn.classList.toggle("text-brass", active);
  notifyBtn.classList.toggle("border-brass/50", active);
  notifyBtn.classList.toggle("text-mute", !active);
}

async function enableNotifications() {
  if (!notificationsSupported()) {
    alert("This browser doesn't support notifications.");
    return;
  }
  if (Notification.permission === "denied") {
    alert("Notifications are blocked for this site. Enable them from your browser's site settings (the padlock icon next to the address bar) to receive live alerts.");
    return;
  }
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  notifyEnabled = perm === "granted";
  localStorage.setItem(NOTIFY_PREF_KEY, notifyEnabled ? "1" : "0");
  if (notifyEnabled) {
    if (!notifySwRegistration) await rahJ91ZuNL8Y2px8iYciYeHN8sfSh5eXH8();
    pushNotification("DATELINE — Live Wire", "You're set. Keep this site open (even in a background tab) and you'll get alerts here for breaking news, weather changes, and market moves.");
  }
  updateNotifyBtn();
}

async function pushNotification(title, body) {
  if (!notificationsSupported() || !notifyEnabled || Notification.permission !== "granted") return;
  try {
    if (notifySwRegistration) {
      // Works on both desktop and mobile Chrome — the only reliable path on Android.
      await notifySwRegistration.showNotification(title, { body });
      return;
    }
    if (typeof Notification === "function") {
      // Desktop fallback if the service worker isn't ready yet.
      const n = new Notification(title, { body });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch (err) {
    console.error("Notification failed to display:", err);
  }
}

if (notifyBtn) {
  notifyBtn.classList.remove("hidden");
  notifyBtn.addEventListener("click", () => {
    if (notifyEnabled && Notification.permission === "granted") {
      notifyEnabled = false;
      localStorage.setItem(NOTIFY_PREF_KEY, "0");
      updateNotifyBtn();
    } else {
      enableNotifications();
    }
  });
}

// Background watcher for new breaking headlines — runs independently of
// whatever category/search the user currently has open, so it can alert
// even while they're reading a different section.
let lastSeenTopLink = null;
async function backgroundCheckBreakingNews() {
  if (!notifyEnabled || Notification.permission !== "granted") return;
  try {
    const xmlDoc = await fetchRssXml({ category: "top" });
    const items = parseRssItems(xmlDoc);
    if (items.length === 0) return;
    const top = items[0];
    if (lastSeenTopLink && top.link !== lastSeenTopLink && top._minutesAgo <= 30) {
      pushNotification("🔴 Breaking on DATELINE", top._headline);
    }
    lastSeenTopLink = top.link;
  } catch {
    // Silent — this is a background check, not user-initiated, so we don't
    // want to surface network errors as an alert.
  }
}

// ---------- tools: shared unit constants ----------
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const GRAMS_PER_TOLA = 11.6638;
const GOLD_NISAB_GRAMS = 87.48;   // ~7.5 tola
const SILVER_NISAB_GRAMS = 612.36; // ~52.5 tola
const KARAT_PURITY = { 24: 1, 22: 22 / 24, 21: 21 / 24, 18: 18 / 24 };
const PKR_FMT = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

function pkr(n) {
  return Number.isFinite(n) ? `Rs ${PKR_FMT.format(n)}` : "—";
}

// USD-per-gram spot price for pure (24K) gold/silver — the base every
// calculator below converts from. Returns null until the ticker has fetched
// real data at least once.
function goldUsdPerGram() {
  return financeData.gold != null ? financeData.gold / GRAMS_PER_TROY_OUNCE : null;
}
function silverUsdPerGram() {
  return financeData.silver != null ? financeData.silver / GRAMS_PER_TROY_OUNCE : null;
}

// PKR-per-gram at a given karat purity (24K = pure). Null if live rates
// (gold price or USD/PKR) aren't loaded yet.
function goldPkrPerGram(karat = 24) {
  const usdGram = goldUsdPerGram();
  if (usdGram == null || financeData.usdPkr == null) return null;
  return usdGram * financeData.usdPkr * (KARAT_PURITY[karat] ?? 1);
}
function silverPkrPerGram() {
  const usdGram = silverUsdPerGram();
  if (usdGram == null || financeData.usdPkr == null) return null;
  return usdGram * financeData.usdPkr;
}

const GOLD_UNIT_GRAMS = { gram: 1, tola: GRAMS_PER_TOLA, "10gram": 10, ounce: GRAMS_PER_TROY_OUNCE };

// ---------- tools: header rates line ----------
function refreshToolsRates() {
  if (!toolsRatesLine) return;
  const parts = [];
  parts.push(financeData.gold != null ? `Gold $${financeData.gold.toFixed(2)}/oz` : "Gold —");
  parts.push(financeData.silver != null ? `Silver $${financeData.silver.toFixed(2)}/oz` : "Silver —");
  parts.push(financeData.usdPkr != null ? `USD/PKR ${financeData.usdPkr.toFixed(2)}` : "USD/PKR —");
  toolsRatesLine.textContent = `Live rates · ${parts.join(" · ")} · refreshes every 60s`;

  populateFxSelects();
}

// Populates the From/To currency dropdowns from whatever pairs the FX
// table actually returned — avoids hardcoding a currency list that could
// drift out of sync with the live data.
let fxSelectsPopulated = false;
function populateFxSelects() {
  if (fxSelectsPopulated || !financeData.fxRates || !fxFrom || !fxTo) return;
  const preferred = ["PKR", "USD", "GBP", "EUR", "SAR", "AED", "AUD", "CAD", "CNY", "INR"];
  const available = Object.keys(financeData.fxRates);
  const ordered = [...preferred.filter(c => c === "USD" || available.includes(c)), ...available.filter(c => !preferred.includes(c))];

  const optionsHtml = ordered.map(c => `<option value="${c}">${c}</option>`).join("");
  fxFrom.innerHTML = optionsHtml;
  fxTo.innerHTML = optionsHtml;
  fxFrom.value = "USD";
  fxTo.value = "PKR";
  fxSelectsPopulated = true;
}

// ---------- tools: Gold Rate Calculator ----------
function calcGoldRate() {
  if (!goldResult) return;
  const karat = Number(goldKarat.value);
  const unitGrams = GOLD_UNIT_GRAMS[goldUnit.value] ?? 1;
  const qty = Number(goldQty.value) || 0;

  const perGram = goldPkrPerGram(karat);
  if (perGram == null) {
    goldResult.textContent = "Waiting for live rate…";
    goldBreakdown.textContent = "";
    return;
  }
  const total = perGram * unitGrams * qty;
  goldResult.textContent = pkr(total);
  goldBreakdown.textContent = `${pkr(perGram)}/gram · ${pkr(perGram * GRAMS_PER_TOLA)}/tola at ${karat}K`;
}

// ---------- tools: Zakat Calculator ----------
function calcZakat() {
  if (!zakatResult) return;
  const goldGrams = Number(zakatGoldGrams.value) || 0;
  const goldKaratVal = Number(zakatGoldKarat.value);
  const silverGrams = Number(zakatSilverGrams.value) || 0;
  const cash = Number(zakatCash.value) || 0;
  const other = Number(zakatOther.value) || 0;
  const basis = zakatNisabBasis.value;

  const goldGramPkr = goldPkrPerGram(goldKaratVal);
  const silverGramPkr = silverPkrPerGram();
  const goldNisabGramPkr = goldPkrPerGram(24);

  if (goldGramPkr == null || silverGramPkr == null || goldNisabGramPkr == null) {
    zakatResult.textContent = "Waiting for live rate…";
    zakatBreakdown.textContent = "";
    return;
  }

  const goldValue = goldGrams * goldGramPkr;
  const silverValue = silverGrams * silverGramPkr;
  const totalWealth = goldValue + silverValue + cash + other;

  const nisabValue = basis === "gold"
    ? GOLD_NISAB_GRAMS * goldNisabGramPkr
    : SILVER_NISAB_GRAMS * silverGramPkr;

  const meetsNisab = totalWealth >= nisabValue;
  const zakatDue = meetsNisab ? totalWealth * 0.025 : 0;

  zakatResult.textContent = meetsNisab ? pkr(zakatDue) : "No zakat due";
  zakatBreakdown.textContent = meetsNisab
    ? `Total wealth ${pkr(totalWealth)} · Nisab ${pkr(nisabValue)}`
    : `Total wealth ${pkr(totalWealth)} is below the nisab threshold of ${pkr(nisabValue)}`;
}

// ---------- tools: Currency Converter ----------
function calcFx() {
  if (!fxResult) return;
  if (!financeData.fxRates) {
    fxResult.textContent = "Waiting for live rates…";
    fxBreakdown.textContent = "";
    return;
  }
  const amount = Number(fxAmount.value) || 0;
  const from = fxFrom.value;
  const to = fxTo.value;
  const rates = financeData.fxRates;

  const fromRate = from === "USD" ? 1 : rates[from];
  const toRate = to === "USD" ? 1 : rates[to];
  if (fromRate == null || toRate == null) {
    fxResult.textContent = "Rate unavailable";
    fxBreakdown.textContent = "";
    return;
  }

  const valueInUsd = amount / fromRate;
  const converted = valueInUsd * toRate;
  const impliedRate = toRate / fromRate;

  fxResult.textContent = `${converted.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${to}`;
  fxBreakdown.textContent = `1 ${from} = ${impliedRate.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${to}`;
}

// ---------- tools: Loan / EMI Calculator ----------
// Pure math — no market data involved, included as it fits naturally
// alongside the other financial tools.
function calcEmi() {
  if (!emiResult) return;
  const principal = Number(emiPrincipal.value) || 0;
  const annualRate = Number(emiRate.value) || 0;
  const months = Math.max(1, Number(emiMonths.value) || 1);

  const monthlyRate = annualRate / 12 / 100;
  let emi;
  if (monthlyRate === 0) {
    emi = principal / months;
  } else {
    const factor = Math.pow(1 + monthlyRate, months);
    emi = (principal * monthlyRate * factor) / (factor - 1);
  }
  const totalPayment = emi * months;
  const totalInterest = totalPayment - principal;

  emiResult.textContent = pkr(emi);
  emiBreakdown.textContent = `Total payment ${pkr(totalPayment)} · Total interest ${pkr(totalInterest)}`;
}

function recalcAllTools() {
  calcGoldRate();
  calcZakat();
  calcFx();
  calcEmi();
}

function initToolsListeners() {
  [goldKarat, goldUnit, goldQty].forEach(el => el && el.addEventListener("input", calcGoldRate));
  [zakatGoldGrams, zakatGoldKarat, zakatSilverGrams, zakatCash, zakatOther, zakatNisabBasis]
    .forEach(el => el && el.addEventListener("input", calcZakat));
  [fxAmount, fxFrom, fxTo].forEach(el => el && el.addEventListener("input", calcFx));
  [emiPrincipal, emiRate, emiMonths].forEach(el => el && el.addEventListener("input", calcEmi));

  if (fxSwapBtn) {
    fxSwapBtn.addEventListener("click", () => {
      const tmp = fxFrom.value;
      fxFrom.value = fxTo.value;
      fxTo.value = tmp;
      calcFx();
    });
  }
}

// ---------- rendering: categories ----------
function renderCategories() {
  navRail.innerHTML = CATEGORIES.map(cat => `
    <button
      data-cat="${cat.id}"
      class="cat-btn shrink-0 font-mono text-xs uppercase tracking-wider px-4 py-2 rounded-full border transition-colors whitespace-nowrap
        ${cat.id === state.category
          ? "bg-brass text-ink border-brass font-semibold"
          : "border-hair text-mute hover:text-paper hover:border-paper/30"}"
    >${cat.icon} ${cat.label}</button>
  `).join("");

  navRail.querySelectorAll(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.category = btn.dataset.cat;
      state.query = "";
      searchInput.value = "";
      loadFeed();
    });
  });
}

// ---------- rendering: skeletons ----------
function showSkeletons(show) {
  if (!show) { skeletonsEl.classList.add("hidden"); skeletonsEl.innerHTML = ""; return; }
  skeletonsEl.classList.remove("hidden");
  gridEl.classList.add("hidden");
  featuredEl.classList.add("hidden");
  emptyStateEl.classList.add("hidden");
  skeletonsEl.innerHTML = Array.from({ length: 6 }).map(() => `
    <div class="rounded-xl border border-hair overflow-hidden bg-panel">
      <div class="skeleton h-40 w-full"></div>
      <div class="p-4 space-y-2">
        <div class="skeleton h-3 w-1/3 rounded"></div>
        <div class="skeleton h-4 w-full rounded"></div>
        <div class="skeleton h-4 w-2/3 rounded"></div>
      </div>
    </div>
  `).join("");
}

// ---------- rendering: featured + grid ----------
function renderArticles() {
  showSkeletons(false);
  gridEl.classList.remove("hidden");

  if (state.articles.length === 0) {
    featuredEl.classList.add("hidden");
    gridEl.innerHTML = "";
    emptyStateEl.classList.remove("hidden");
    resultCount.textContent = "";
    return;
  }
  emptyStateEl.classList.add("hidden");

  const showFeatured = !state.query && state.category !== "saved";
  const [first, ...rest] = state.articles;
  resultCount.textContent = `${state.articles.length} ${state.category === "saved" ? "saved" : "stories"}`;

  // Featured (only for non-search, first load, non-saved view)
  if (showFeatured) {
    featuredEl.classList.remove("hidden");
    const hasDesc = Boolean(first._desc);
    const breaking = isBreakingArticle(first, 0);
    featuredEl.innerHTML = `
      <article data-idx="0" data-link="${escapeAttr(first.link)}" class="article-card group cursor-pointer grid md:grid-cols-2 gap-0 rounded-xl overflow-hidden border border-hair bg-panel hover:border-brass/40 transition-colors">
        <div class="relative h-56 md:h-full bg-panel2 overflow-hidden thumb-slot" data-img-class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
          ${placeholderThumb(first._source)}
          <span class="absolute top-3 left-3 bg-ink/90 text-brass font-mono text-[10px] uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border border-brass/30">Featured</span>
          ${breaking ? breakingBadgeHtml("lg") : ""}
        </div>
        <div class="p-6 flex flex-col justify-center">
          <div class="flex items-center flex-wrap gap-x-3 gap-y-1.5 mb-3">
            <span class="font-mono text-[11px] uppercase tracking-[0.2em] text-brass">${escapeHtml(first._source)} · ${first._timeAgo}</span>
            ${readBadgeHtml(first._readMins, "lg")}
          </div>
          <h2 class="font-display text-2xl sm:text-3xl font-medium text-paper leading-snug mb-3 group-hover:text-brass transition-colors">${escapeHtml(first._headline)}</h2>
          <p class="desc-slot text-paper/70 text-sm leading-relaxed clamp-3" data-has-local-desc="${hasDesc}">${hasDesc ? escapeHtml(first._desc) : fallbackDesc(first)}</p>
          ${cardControlsHtml(first)}
        </div>
      </article>
    `;
    const featCard = featuredEl.querySelector(".article-card");
    featCard.addEventListener("click", () => openModal(first));
    attachCardControls(featCard, first);
  } else {
    featuredEl.classList.add("hidden");
  }

  const items = showFeatured ? rest : state.articles;
  gridEl.innerHTML = items.map((a, i) => {
    const realIdx = showFeatured ? i + 1 : i;
    const hasDesc = Boolean(a._desc);
    const breaking = isBreakingArticle(a, realIdx);
    return `
      <article data-idx="${realIdx}" data-link="${escapeAttr(a.link)}" class="article-card group cursor-pointer rounded-xl overflow-hidden border border-hair bg-panel hover:border-brass/40 transition-colors flex flex-col">
        <div class="relative h-40 bg-panel2 overflow-hidden thumb-slot" data-img-class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
          ${placeholderThumb(a._source)}
          ${breaking ? breakingBadgeHtml("sm") : ""}
        </div>
        <div class="p-4 flex flex-col flex-1">
          <div class="flex items-center flex-wrap gap-x-2 gap-y-1 mb-2">
            <span class="font-mono text-[10px] uppercase tracking-[0.15em] text-brass">${escapeHtml(a._source)} · ${a._timeAgo}</span>
            ${readBadgeHtml(a._readMins, "sm")}
          </div>
          <h3 class="font-display text-base font-medium text-paper leading-snug mb-2 clamp-2 group-hover:text-brass transition-colors">${escapeHtml(a._headline)}</h3>
          <p class="desc-slot text-paper/60 text-xs leading-relaxed clamp-2" data-has-local-desc="${hasDesc}">${hasDesc ? escapeHtml(a._desc) : fallbackDesc(a)}</p>
          <div class="mt-auto">${cardControlsHtml(a)}</div>
        </div>
      </article>
    `;
  }).join("");

  gridEl.querySelectorAll(".article-card").forEach(card => {
    const idx = Number(card.dataset.idx);
    const article = state.articles[idx];
    card.addEventListener("click", () => openModal(article));
    attachCardControls(card, article);
  });

  enrichVisibleCards(featuredEl);
  enrichVisibleCards(gridEl);
}

// Used only until a real summary loads (or if none is ever found) — varies
// by source/category instead of a static "No summary available" line
// repeated on every card, which reads as thin/templated content.
function fallbackDesc(article) {
  return `Reported by ${escapeHtml(article._source)}. Open the full story for details.`;
}

// ---------- news ticker ----------
function renderTicker(articles) {
  const headlines = articles.slice(0, 12).map(a => a._headline);
  if (headlines.length === 0) return;
  const strip = headlines.map(h => `<span class="px-6 font-mono text-xs whitespace-nowrap">${escapeHtml(h)}</span>`).join("<span class='text-ink/40'>/</span>");
  tickerTrack.innerHTML = strip + strip; // duplicate for seamless loop
}

// ---------- financial ticker ----------
// LIVE:      USD/PKR + full FX table (open.er-api.com), Gold/oz and
//            Silver/oz (gold-api.com) — all free, keyless, CORS-enabled
//            endpoints, no simulation involved. The Tools tab calculators
//            (Gold Rate, Zakat, Currency Converter) read straight out of
//            `financeData` below — no extra API calls of their own.
// SIMULATED: the market index. There is no free, keyless, real-time index
//            feed (KSE-100 / Nasdaq / etc. all require a paid or signup-gated
//            API key). Swap fetchMarketIndex() for a real provider (e.g. a
//            free-tier FCS API / Twelve Data key called through your own
//            /api endpoint, so the key stays server-side) to make it live.
const financeData = {
  usdPkr: null,
  fxRates: null, // full { CCY: rate } table, base USD — powers the Currency Converter
  gold: null,    // USD per troy ounce (XAU)
  silver: null,  // USD per troy ounce (XAG)
  index: 78250,  // simulated baseline
};
let financeInitialized = false;

// Full FX table, base USD. A single call gives us every pair the Currency
// Converter needs (PKR included) — no separate per-pair requests.
async function fetchFxRates() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) return null;
    const data = await res.json();
    return data?.rates || null;
  } catch {
    return null;
  }
}

// Live XAU/USD spot price — free, no API key, CORS-enabled.
async function fetchGoldPrice() {
  try {
    const res = await fetch("https://api.gold-api.com/price/XAU");
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.price === "number" ? data.price : null;
  } catch {
    return null;
  }
}

// Live XAG/USD (silver) spot price — same free, keyless provider as gold.
async function fetchSilverPrice() {
  try {
    const res = await fetch("https://api.gold-api.com/price/XAG");
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.price === "number" ? data.price : null;
  } catch {
    return null;
  }
}

function changeChip(delta, opts = {}) {
  const up = delta >= 0;
  const decimals = opts.decimals ?? 2;
  return `
    <span class="inline-flex items-center gap-0.5 ${up ? "text-green-400" : "text-wire"} font-mono font-semibold">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-2.5 h-2.5 ${up ? "" : "rotate-180"}">
        <path d="M12 4l7 8h-5v8h-4v-8H5z"/>
      </svg>
      ${Math.abs(delta).toFixed(decimals)}
    </span>
  `;
}

// Each ticker item renders as a self-contained pill: icon + label + value +
// change chip, on its own rounded/bordered card — rather than plain text
// separated by dividers, so it reads as a proper market widget at a glance.
function tickerPill({ icon, label, value, chip, muted }) {
  return `
    <span class="inline-flex items-center gap-2.5 mx-1.5 px-3.5 py-1 rounded-full border border-hair bg-panel/70 whitespace-nowrap">
      <span class="text-sm leading-none">${icon}</span>
      <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-mute">${label}</span>
      ${muted
        ? `<span class="font-mono text-xs text-mute/70">${value}</span>`
        : `<span class="font-mono text-xs font-semibold text-brass">${value}</span>`}
      ${chip ? `<span class="font-mono text-[11px]">${chip}</span>` : ""}
    </span>
  `;
}

async function renderFinancialTicker() {
  const [rates, gold, silver] = await Promise.all([fetchFxRates(), fetchGoldPrice(), fetchSilverPrice()]);

  const prevGold = financeData.gold;
  if (rates) { financeData.fxRates = rates; financeData.usdPkr = rates.PKR || financeData.usdPkr; }
  if (gold) financeData.gold = gold;
  if (silver) financeData.silver = silver;
  const goldDelta = financeInitialized && prevGold != null && financeData.gold != null ? financeData.gold - prevGold : 0;

  // Simulated tick for the index only (see note above fetchGoldPrice).
  const indexDelta = (Math.random() - 0.48) * 120;
  financeData.index = Math.max(0, financeData.index + indexDelta);

  const items = [
    financeData.usdPkr
      ? tickerPill({ icon: "💵", label: "USD/PKR", value: financeData.usdPkr.toFixed(2) })
      : tickerPill({ icon: "💵", label: "USD/PKR", value: "unavailable", muted: true }),
    financeData.gold != null
      ? tickerPill({ icon: "🥇", label: "Gold (oz)", value: `$${financeData.gold.toFixed(2)}`, chip: changeChip(goldDelta) })
      : tickerPill({ icon: "🥇", label: "Gold (oz)", value: "unavailable", muted: true }),
    financeData.silver != null
      ? tickerPill({ icon: "🥈", label: "Silver (oz)", value: `$${financeData.silver.toFixed(2)}` })
      : tickerPill({ icon: "🥈", label: "Silver (oz)", value: "unavailable", muted: true }),
    tickerPill({ icon: "📊", label: "Market Index*", value: financeData.index.toFixed(0), chip: changeChip(indexDelta, { decimals: 0 }) }),
  ];
  const strip = items.join("");
  finTickerTrack.innerHTML = strip + strip; // duplicate for seamless loop

  // Notify on a meaningful gold move once we have a real previous value to compare against.
  if (financeInitialized && prevGold != null && financeData.gold != null) {
    const pctMove = Math.abs(financeData.gold - prevGold) / prevGold;
    if (pctMove >= 0.003) {
      pushNotification("💰 Gold price move", `Gold is now $${financeData.gold.toFixed(2)}/oz (${goldDelta >= 0 ? "+" : ""}${goldDelta.toFixed(2)})`);
    }
  }
  financeInitialized = true;

  // Keep the Tools tab calculators (Gold Rate / Zakat / Currency Converter)
  // in sync with the same data the ticker just fetched — no separate poll.
  refreshToolsRates();
  recalcAllTools();
}

// ---------- modal ----------
let currentModalArticle = null;

async function openModal(article) {
  currentModalArticle = article;

  modalCategory.textContent = state.category === "saved" ? "Saved" : categoryMeta(state.category).label;
  modalImageWrap.innerHTML = "";
  modalTitle.textContent = article._headline;
  modalMeta.textContent = `${article._source} · ${timeAgo(article.pubDate)} · ${article._readMins} min read`;
  modalDesc.textContent = article._desc || fallbackDescPlain(article);
  modalLink.href = article.link || "#";

  const playing = ttsState.link === article.link && window.speechSynthesis?.speaking && !window.speechSynthesis?.paused;
  setListenBtnLabel(modalListenBtn, playing ? "playing" : "idle");
  setBookmarkBtnState(modalBookmarkBtn, isBookmarked(article.link));

  modalOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  const staticImg = extractImage(article);
  const result = await getEnrichment(article.link);
  if (modalOverlay.classList.contains("hidden")) return; // closed before it resolved

  const image = staticImg || result?.image;
  if (image) {
    modalImageWrap.innerHTML = `<img src="${image}" alt="" class="w-full h-56 object-cover" onerror="this.parentElement.innerHTML=''"/>`;
  }
  if (!article._desc && result?.description) {
    modalDesc.textContent = result.description;
  }
}

function fallbackDescPlain(article) {
  return `Reported by ${article._source}. Open the full story for details.`;
}

function closeModal() {
  modalOverlay.classList.add("hidden");
  document.body.style.overflow = "";
  currentModalArticle = null;
}
modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

modalListenBtn.addEventListener("click", () => {
  if (currentModalArticle) toggleListen(currentModalArticle, modalListenBtn);
});
modalBookmarkBtn.addEventListener("click", () => {
  if (currentModalArticle) toggleBookmark(currentModalArticle, modalBookmarkBtn);
});

// ---------- data loading ----------
async function loadFeed() {
  state.loading = true;
  errorBanner.classList.add("hidden");

  // Stop any narration in progress when navigating away from its article
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  resetTts();

  const isSearch = !!state.query;
  const isSaved = state.category === "saved";
  const isTools = state.category === "tools";

  sectionTitle.textContent = isTools
    ? "Financial Tools"
    : isSaved
      ? "Saved for Later"
      : isSearch
        ? `Results for "${state.query}"`
        : categoryMeta(state.category).label;

  updateSavedBtnLabel();

  if (isTools) {
    showSkeletons(false);
    gridEl.classList.add("hidden");
    featuredEl.classList.add("hidden");
    emptyStateEl.classList.add("hidden");
    errorBanner.classList.add("hidden");
    toolsSection.classList.remove("hidden");
    resultCount.textContent = "";
    refreshToolsRates();
    recalcAllTools();
    state.loading = false;
    return;
  }
  toolsSection.classList.add("hidden");

  if (isSaved) {
    showSkeletons(false);
    const bookmarks = getBookmarks().slice().reverse();
    state.articles = bookmarks.map(b => ({
      title: b.title,
      link: b.link,
      pubDate: new Date(b.savedAt).toISOString(),
      _headline: b.title,
      _source: b.source || "Google News",
      _desc: "",
      _timeAgo: `saved ${timeAgo(new Date(b.savedAt).toISOString())}`,
      _minutesAgo: Infinity,
      _readMins: b.readMins || 1,
      thumbnail: null,
      description: "",
    }));
    renderArticles();
    state.loading = false;
    return;
  }

  showSkeletons(true);

  try {
    const xmlDoc = await fetchRssXml({ category: state.category, q: isSearch ? state.query : undefined });
    state.articles = parseRssItems(xmlDoc).slice(0, 40);

    renderArticles();
    if (!isSearch) renderTicker(state.articles);
  } catch (err) {
    console.error(err);
    showSkeletons(false);
    gridEl.classList.add("hidden");
    featuredEl.classList.add("hidden");
    emptyStateEl.classList.add("hidden");
    errorBanner.classList.remove("hidden");
    errorText.textContent =
      "Couldn't reach the live wire right now. This only works once deployed on Vercel (or run locally with `vercel dev`) — the /api/news function needs a server to run on. Wait a moment and hit refresh.";
  } finally {
    state.loading = false;
  }
}

// ---------- events ----------
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  state.query = searchInput.value.trim();
  loadFeed();
});

let debounceTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const val = searchInput.value.trim();
    if (val === "" && state.query !== "") { state.query = ""; loadFeed(); }
  }, 400);
});

refreshBtn.addEventListener("click", () => {
  refreshIcon.style.transform = "rotate(360deg)";
  setTimeout(() => { refreshIcon.style.transform = "rotate(0deg)"; }, 500);
  loadFeed();
  renderFinancialTicker();
});

if (savedBtn) {
  savedBtn.addEventListener("click", () => {
    state.query = "";
    searchInput.value = "";
    state.category = state.category === "saved" ? "top" : "saved";
    loadFeed();
  });
}

function tickClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
tickClock();
setInterval(tickClock, 1000 * 30);

// ---------- weather ----------
const WEATHER_CODES = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"], 48: ["Rime fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Dense drizzle", "🌧️"],
  56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"],
  61: ["Light rain", "🌧️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "❄️"],
  80: ["Rain showers", "🌦️"], 81: ["Rain showers", "🌧️"], 82: ["Violent showers", "⛈️"],
  85: ["Snow showers", "🌨️"], 86: ["Snow showers", "❄️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm w/ hail", "⛈️"], 99: ["Thunderstorm w/ hail", "⛈️"],
};

function weatherIcon(code) { return (WEATHER_CODES[code] || ["Unknown", "🌡️"])[1]; }
function weatherLabel(code) { return (WEATHER_CODES[code] || ["Unknown", "🌡️"])[0]; }

function weatherLoadingState() {
  weatherBody.innerHTML = `<span class="font-mono text-xs text-mute">Finding your location…</span>`;
}
function weatherErrorState() {
  weatherBody.innerHTML = `<span class="font-mono text-xs text-mute">Couldn't load weather. Try searching a city above.</span>`;
}

let lastWeatherSnapshot = null; // { temp, code }

function renderWeather(label, current) {
  const temp = Math.round(current.temperature_2m);
  const feels = Math.round(current.apparent_temperature);

  if (lastWeatherSnapshot) {
    const tempJump = Math.abs(temp - lastWeatherSnapshot.temp) >= 3;
    const conditionChanged = current.weathercode !== lastWeatherSnapshot.code;
    if (tempJump || conditionChanged) {
      pushNotification("🌤️ Weather update", `${label}: now ${temp}°C, ${weatherLabel(current.weathercode)}`);
    }
  }
  lastWeatherSnapshot = { temp, code: current.weathercode };

  weatherBody.innerHTML = `
    <div class="flex items-center gap-4">
      <span class="text-4xl leading-none">${weatherIcon(current.weathercode)}</span>
      <div>
        <div class="flex items-baseline gap-2">
          <span class="font-display text-3xl text-paper">${temp}°C</span>
          <span class="font-mono text-[11px] text-mute uppercase tracking-wider">${weatherLabel(current.weathercode)}</span>
        </div>
        <p class="font-mono text-[11px] text-mute mt-0.5">${escapeHtml(label)} · feels ${feels}°C · ${Math.round(current.relative_humidity_2m)}% humidity · wind ${Math.round(current.wind_speed_10m)} km/h</p>
      </div>
    </div>
  `;
}

async function fetchWeatherFor(lat, lon, label) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weathercode,wind_speed_10m&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather request failed");
  const data = await res.json();
  renderWeather(label, data.current);
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const data = await res.json();
    return data.city || data.locality || data.principalSubdivision || "Your location";
  } catch {
    return "Your location";
  }
}

async function detectLocationAndLoadWeather() {
  weatherLoadingState();

  // 1) Try browser geolocation (most accurate, needs user permission)
  if (navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000 })
      );
      const { latitude, longitude } = pos.coords;
      const label = await reverseGeocode(latitude, longitude);
      await fetchWeatherFor(latitude, longitude, label);
      return;
    } catch {
      // permission denied or timed out — fall through to IP-based lookup
    }
  }

  // 2) Fallback: rough location from IP address
  try {
    const res = await fetch("https://ipwho.is/");
    const data = await res.json();
    if (data.success !== false && data.latitude && data.longitude) {
      await fetchWeatherFor(data.latitude, data.longitude, `${data.city || ""}${data.city ? ", " : ""}${data.country || ""}`);
      return;
    }
    throw new Error("No coordinates from IP lookup");
  } catch {
    weatherErrorState();
  }
}

async function loadWeatherForCityName(name) {
  weatherLoadingState();
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);
    const data = await res.json();
    const hit = data.results && data.results[0];
    if (!hit) { weatherBody.innerHTML = `<span class="font-mono text-xs text-mute">No city found for "${escapeHtml(name)}".</span>`; return; }
    await fetchWeatherFor(hit.latitude, hit.longitude, `${hit.name}${hit.country ? ", " + hit.country : ""}`);
  } catch {
    weatherErrorState();
  }
}

if (weatherCityForm) {
  weatherCityForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = weatherCityInput.value.trim();
    if (val) loadWeatherForCityName(val);
  });
}

// ---------- header shadow on scroll ----------
const siteHeader = document.getElementById("siteHeader");
if (siteHeader) {
  const toggleHeaderShadow = () => {
    siteHeader.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", toggleHeaderShadow, { passive: true });
  toggleHeaderShadow();
}

// ---------- footer year ----------
const footerYearEl = document.getElementById("footerYear");
if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

// ---------- init ----------
renderCategories();
updateSavedBtnLabel();
updateNotifyBtn();
initToolsListeners();
rahJ91ZuNL8Y2px8iYciYeHN8sfSh5eXH8();
loadFeed();
detectLocationAndLoadWeather();
renderFinancialTicker();

// Background refresh cadence:
// - financial ticker every 60s (also drives the gold-move alert)
// - weather every 10 min (also drives the weather-change alert)
// - breaking-news watcher every 4 min (independent of the visible category)
setInterval(renderFinancialTicker, 60 * 1000);
setInterval(detectLocationAndLoadWeather, 10 * 60 * 1000);
setInterval(backgroundCheckBreakingNews, 4 * 60 * 1000);
// Prime lastSeenTopLink shortly after load so the very first background
// check doesn't fire a notification for a headline the user already saw.
setTimeout(backgroundCheckBreakingNews, 15 * 1000);
