# Google News Scraper (RSS) + Deep Research (Gemini) — Next.js + Vercel

This app fetches results from **Google News RSS** based on keywords and date range, optionally does **deep research** using Gemini (summaries + relevance scoring), and exports results to **CSV / JSON / PDF**.

## Local setup
```bash
npm install
```

Create `.env.local`:
```bash
GEMINI_API_KEY=YOUR_KEY_HERE
```

Run:
```bash
npm run dev
```

## Deploy (Vercel)
- Push to GitHub
- Import repo in Vercel
- Add env var: `GEMINI_API_KEY`
- Deploy

## Notes
- "Scraping" is done via Google News **RSS feeds** (stable and public).
- Deep research uses Gemini server-side. If you don't want LLM summaries, just turn off "Deep research".
