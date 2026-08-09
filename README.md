DATELINE — Live Wire 📰
Ek free, modern, dark-themed Live News, Weather & Current Affairs web app. Frontend HTML + Tailwind CSS + vanilla JavaScript, aur ek chhota sa Vercel Serverless Function (koi database, koi alag server nahi) jo sirf news feed fetch karta hai. GitHub par upload karke seedha Vercel par free host ho jaati hai.
Features
Live headlines — Google News RSS feeds se, ek apni chhoti Vercel serverless function (`/api/news`) ke zariye — koi third-party proxy nahi, koi rate-limit ki tension nahi
9 categories — Top Headlines, World, Pakistan, Business, Technology, Science, Health, Entertainment, Sports
Live weather — aapki location (ya IP-based fallback) ka current temperature, condition, humidity aur wind — Open-Meteo (free, koi API key nahi) se; kisi bhi doosre city ka weather manually search bhi kar sakte hain
Live search — kisi bhi topic par wire search karein (e.g. "elections", "cricket", "markets")
Scrolling news ticker — top headlines ka live ticker tape
Article modal — summary + "Read full story" link jo original publisher ke page par le jaata hai
Fully responsive — mobile, tablet aur desktop sab par perfect
Dark, distinctive UI — press/wire-service inspired design, brass accent, serif headlines
Files
```
news-app/
├── index.html      ← poora markup + Tailwind config (CDN, no build step)
├── app.js          ← saara frontend logic: fetch, render, search, weather, ticker, modal
├── api/
│   └── news.js     ← ek chhoti Vercel serverless function (news feed fetch karti hai)
├── package.json     ← minimal manifest, Vercel ko function ka module type batati hai
└── README.md        ← yeh file
```
Weather seedha browser se Open-Meteo ko call karta hai (usay CORS proxy ki zarurat nahi). Sirf news feed ke liye ek function chahiye kyunke Google News browser se direct fetch nahi hone deta.
Kaise chalayein (local)
Kyunke ab is app mein ek serverless function bhi hai, sirf `index.html` ko double-click karke kholna kaam nahi karega (news load nahi hogi — weather phir bhi chalegi). Local par poori app (news + weather dono) test karne ke liye Vercel CLI use karein:
```bash
npm install -g vercel
vercel dev
```
Yeh terminal mein ek local URL degi (usually `http://localhost:3000`) jahan `/api/news` bhi kaam karega, bilkul jaise production mein karega.
GitHub par upload
GitHub par ek naya empty repository banayein (e.g. `dateline-news-app`) — README/`.gitignore` add na karein.
Apne computer par is folder mein terminal kholein aur yeh commands chalayein:
```bash
git init
git add .
git commit -m "Initial commit: DATELINE live news + weather app"
git branch -M main
git remote add origin https://github.com/<your-username>/dateline-news-app.git
git push -u origin main
```
Vercel par deploy (free)
Option A — Dashboard se (sabse aasan):
vercel.com par jaakar GitHub account se sign in karein.
"Add New… → Project" click karein.
Apni `dateline-news-app` repository select karein aur Import karein.
Framework preset "Other" rehne dein — koi build command ki zarurat nahi, "Build Command" aur "Output Directory" fields khali/default hi rehne dein. Vercel `api/news.js` ko automatically ek serverless function ke tor par detect kar legi.
Deploy dabayein. 30-60 seconds mein aapki app live ho jayegi — news, weather, sab kaam karega — Vercel ek `.vercel.app` URL de dega.
Option B — Vercel CLI se:
```bash
npm install -g vercel
vercel login
vercel        # project folder ke andar chalayein, sawalon ke defaults accept kar lein
vercel --prod # production deploy
```
Dono options mein koi environment variable ya API key set karna zaroori nahi hai — na news ke liye, na weather ke liye.
Yeh ab zyada reliable kyun hai
Pehle wala version third-party CORS proxies (allorigins, corsproxy.io) par depend karta tha — yeh free services khud hi bohot flaky hain aur random 429/downtime deti hain. Ab `api/news.js` ek proper Vercel serverless function hai jo Google News RSS ko server-side fetch karti hai, jahan CORS lagta hi nahi. Yeh function khud Vercel ke free tier par hi chalti hai, is liye koi extra cost ya setup nahi.
Data source badalna chahein toh
`api/news.js` ke andar `FEEDS` object mein har category ka RSS URL hai. Chahen toh koi bhi doosri public RSS feed (BBC, Al Jazeera, Dawn, etc.) ka URL wahan daal dein aur `app.js` ke `CATEGORIES` array mein matching `id`/`label` add kar dein — baaki app automatically kaam karti rahegi.
Weather ka source badalna ho toh `app.js` mein `fetchWeatherFor()` function ke andar Open-Meteo ka URL hai — koi bhi doosra free weather API us jagah swap kiya ja sakta hai.
Tech stack
Tailwind CSS (CDN — no build step)
Vanilla JavaScript (no framework, no bundler)
Google Fonts: Fraunces (display), Inter (body), IBM Plex Mono (utility/ticker)
Vercel Serverless Function (`api/news.js`) — sirf news RSS fetch karne ke liye
Open-Meteo — free weather + geocoding API, koi key nahi
ipwho.is aur bigdatacloud.net — free location fallback/reverse-geocoding
---
Made to be deployed in minutes on Vercel's free tier — no database, no paid API keys required to get started.
