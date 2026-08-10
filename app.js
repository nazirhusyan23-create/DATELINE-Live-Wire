/* =========================================================
   DATELINE — Live Wire
   Frontend: HTML + Tailwind + vanilla JS.
   "Backend": one tiny Vercel Serverless Function (/api/news.js)
   that fetches Google News RSS server-side, where CORS doesn't
   apply — no database, no auth, no state. Deploys automatically
   with the rest of the project on Vercel's free tier.

   Weather: Open-Meteo (free, no API key) + browser geolocation
   with an IP-based fallback.
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
const searchForm    = document.getElementById("searchForm");
const searchInput   = document.getElementById("searchInput");
const refreshBtn    = document.getElementById("refreshBtn");
const refreshIcon   = document.getElementById("refreshIcon");
const clockEl       = document.getElementById("clock");

const modalOverlay  = document.getElementById("modalOverlay");
const modalClose    = document.getElementById("modalClose");
const modalCategory = document.getElementById("modalCategory");
const modalImageWrap= document.getElementById("modalImageWrap");
const modalTitle    = document.getElementById("modalTitle");
const modalMeta     = document.getElementById("modalMeta");
const modalDesc     = document.getElementById("modalDesc");
const modalLink     = document.getElementById("modalLink");

const weatherBody    = document.getElementById("weatherBody");
const weatherCityForm = document.getElementById("weatherCityForm");
const weatherCityInput = document.getElementById("weatherCityInput");

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
    const rawTitle = (item.querySelector("title")?.textContent || "").trim();
    const link     = (item.querySelector("link")?.textContent || "#").trim();
    const pubDate  = (item.querySelector("pubDate")?.textContent || "").trim();
    const descHtml = item.querySelector("description")?.textContent || "";
    const sourceTag = (item.querySelector("source")?.textContent || "").trim();

    const { headline, source } = splitSourceFromTitle(rawTitle, sourceTag);
    let desc = stripHtml(descHtml);
    // Google News descriptions are usually just the headline again — drop if redundant
    if (!desc || desc.toLowerCase().includes(headline.toLowerCase().slice(0, 20))) desc = "";

    return {
      title: rawTitle,
      link,
      pubDate,
      _headline: headline,
      _source: source || "Google News",
      _desc: desc.slice(0, 220),
      _timeAgo: timeAgo(pubDate),
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

function timeAgo(dateStr) {
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
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

function escapeAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// A styled monogram tile used while a thumbnail is loading, or as the
// permanent fallback when /api/thumb can't find a real image for a story.
function placeholderThumb(source) {
  const initial = (source || "?").trim().charAt(0).toUpperCase() || "?";
  return `<div class="thumb-placeholder w-full h-full grid place-items-center"><span class="font-display text-3xl text-brass/30 select-none">${initial}</span></div>`;
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
      const result = { image: d.image || null, description: d.description || null };
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
      img.onload = () => { thumbSlot.innerHTML = ""; thumbSlot.appendChild(img); };
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

  const [first, ...rest] = state.articles;
  resultCount.textContent = `${state.articles.length} stories`;

  // Featured (only for non-search, first load)
  if (!state.query) {
    featuredEl.classList.remove("hidden");
    const hasDesc = Boolean(first._desc);
    featuredEl.innerHTML = `
      <article data-idx="0" data-link="${escapeAttr(first.link)}" class="article-card group cursor-pointer grid md:grid-cols-2 gap-0 rounded-xl overflow-hidden border border-hair bg-panel hover:border-brass/40 transition-colors">
        <div class="relative h-56 md:h-full bg-panel2 overflow-hidden thumb-slot" data-img-class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
          ${placeholderThumb(first._source)}
          <span class="absolute top-3 left-3 bg-ink/90 text-brass font-mono text-[10px] uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border border-brass/30">Featured</span>
        </div>
        <div class="p-6 flex flex-col justify-center">
          <span class="font-mono text-[11px] uppercase tracking-[0.2em] text-brass mb-3">${first._source} · ${first._timeAgo}</span>
          <h2 class="font-display text-2xl sm:text-3xl font-medium text-paper leading-snug mb-3 group-hover:text-brass transition-colors">${first._headline}</h2>
          <p class="desc-slot text-paper/70 text-sm leading-relaxed clamp-3" data-has-local-desc="${hasDesc}">${hasDesc ? first._desc : fallbackDesc(first)}</p>
        </div>
      </article>
    `;
    featuredEl.querySelector(".article-card").addEventListener("click", () => openModal(first));
  } else {
    featuredEl.classList.add("hidden");
  }

  const items = state.query ? state.articles : rest;
  gridEl.innerHTML = items.map((a, i) => {
    const realIdx = state.query ? i : i + 1;
    const hasDesc = Boolean(a._desc);
    return `
      <article data-idx="${realIdx}" data-link="${escapeAttr(a.link)}" class="article-card group cursor-pointer rounded-xl overflow-hidden border border-hair bg-panel hover:border-brass/40 transition-colors flex flex-col">
        <div class="relative h-40 bg-panel2 overflow-hidden thumb-slot" data-img-class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
          ${placeholderThumb(a._source)}
        </div>
        <div class="p-4 flex flex-col flex-1">
          <span class="font-mono text-[10px] uppercase tracking-[0.15em] text-brass mb-2">${a._source} · ${a._timeAgo}</span>
          <h3 class="font-display text-base font-medium text-paper leading-snug mb-2 clamp-2 group-hover:text-brass transition-colors">${a._headline}</h3>
          <p class="desc-slot text-paper/60 text-xs leading-relaxed clamp-2 mt-auto" data-has-local-desc="${hasDesc}">${hasDesc ? a._desc : fallbackDesc(a)}</p>
        </div>
      </article>
    `;
  }).join("");

  gridEl.querySelectorAll(".article-card").forEach(card => {
    const idx = Number(card.dataset.idx);
    card.addEventListener("click", () => openModal(state.articles[idx]));
  });

  enrichVisibleCards(featuredEl);
  enrichVisibleCards(gridEl);
}

// Used only until a real summary loads (or if none is ever found) — varies
// by source/category instead of a static "No summary available" line
// repeated on every card, which reads as thin/templated content.
function fallbackDesc(article) {
  return `Reported by ${article._source}. Open the full story for details.`;
}

// ---------- ticker ----------
function renderTicker(articles) {
  const headlines = articles.slice(0, 12).map(a => a._headline);
  if (headlines.length === 0) return;
  const strip = headlines.map(h => `<span class="px-6 font-mono text-xs whitespace-nowrap">${h}</span>`).join("<span class='text-ink/40'>/</span>");
  tickerTrack.innerHTML = strip + strip; // duplicate for seamless loop
}

// ---------- modal ----------
async function openModal(article) {
  modalCategory.textContent = categoryMeta(state.category).label;
  modalImageWrap.innerHTML = "";
  modalTitle.textContent = article._headline;
  modalMeta.textContent = `${article._source} · ${timeAgo(article.pubDate)}`;
  modalDesc.textContent = article._desc || fallbackDesc(article);
  modalLink.href = article.link || "#";
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
function closeModal() {
  modalOverlay.classList.add("hidden");
  document.body.style.overflow = "";
}
modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// ---------- data loading ----------
async function loadFeed() {
  state.loading = true;
  errorBanner.classList.add("hidden");
  showSkeletons(true);

  const isSearch = !!state.query;
  sectionTitle.textContent = isSearch ? `Results for “${state.query}”` : categoryMeta(state.category).label;

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
});

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

function renderWeather(label, current) {
  const temp = Math.round(current.temperature_2m);
  const feels = Math.round(current.apparent_temperature);
  weatherBody.innerHTML = `
    <div class="flex items-center gap-4">
      <span class="text-4xl leading-none">${weatherIcon(current.weathercode)}</span>
      <div>
        <div class="flex items-baseline gap-2">
          <span class="font-display text-3xl text-paper">${temp}°C</span>
          <span class="font-mono text-[11px] text-mute uppercase tracking-wider">${weatherLabel(current.weathercode)}</span>
        </div>
        <p class="font-mono text-[11px] text-mute mt-0.5">${label} · feels ${feels}°C · ${Math.round(current.relative_humidity_2m)}% humidity · wind ${Math.round(current.wind_speed_10m)} km/h</p>
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
    if (!hit) { weatherBody.innerHTML = `<span class="font-mono text-xs text-mute">No city found for “${name}”.</span>`; return; }
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

// ---------- init ----------
renderCategories();
loadFeed();
detectLocationAndLoadWeather();
