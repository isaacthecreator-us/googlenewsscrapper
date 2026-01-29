import Parser from "rss-parser";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

const parser = new Parser({
  customFields: {
    item: ["source", "media:content", "media:thumbnail"]
  }
});

function buildGoogleNewsQuery(keywords, dateFrom, dateTo) {
  // Google News RSS supports Google-style query operators.
  // We use after: and before: for date boundaries when provided.
  // before: is exclusive-ish; still good enough for practical filtering.
  const parts = [keywords.trim()];
  if (dateFrom) parts.push(`after:${dateFrom}`);
  if (dateTo) parts.push(`before:${dateTo}`);
  return parts.join(" ");
}

function rssUrlForQuery(q) {
  const encoded = encodeURIComponent(q);
  // hl/en-US/gl/US/ceid can be customized
  return `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
}

function normalizePublisher(item) {
  // RSS often gives "Title - Publisher". We'll split if possible.
  const title = String(item?.title || "");
  const parts = title.split(" - ");
  if (parts.length >= 2) return parts[parts.length - 1].trim();
  // sometimes item.source is present
  if (item?.source?.$?.value) return String(item.source.$.value);
  if (item?.source?.value) return String(item.source.value);
  return "";
}

function normalizeTitle(item) {
  const title = String(item?.title || "");
  const parts = title.split(" - ");
  if (parts.length >= 2) return parts.slice(0, -1).join(" - ").trim();
  return title.trim();
}

function pickSnippet(item) {
  // RSS contentSnippet exists via rss-parser
  return String(item?.contentSnippet || "").trim();
}

async function resolveFinalUrl(maybeGoogleUrl) {
  if (!maybeGoogleUrl) return "";
  try {
    const res = await fetch(maybeGoogleUrl, { redirect: "follow" });
    // After redirects, res.url should be final.
    return res?.url || maybeGoogleUrl;
  } catch {
    return maybeGoogleUrl;
  }
}

function uniqueByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.publisherUrl || it.googleNewsUrl || it.title;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function deepSummarizeAndScore({ keywords, articles }) {
  if (!process.env.GEMINI_API_KEY) return { articles, searchSummary: "" };

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Keep it cheap: summarize top 12 only.
  const top = articles.slice(0, 12);

  const prompt = `
You are a news research assistant.
Given the user's keywords and a list of articles (title, publisher, datetime, snippet, url), produce:
1) A relevanceScore 0-100 for each item based on the user's keywords.
2) A 1-2 sentence summary for each item.

Return ONLY JSON:
{
  "searchSummary": "string",
  "items": [
    {"url":"string","relevanceScore":number,"summary":"string"}
  ]
}
Rules:
- JSON only.
- Keep summaries factual and short.
- If snippet is weak, infer carefully from title and publisher only.
`.trim();

  const user = {
    keywords,
    articles: top.map((a) => ({
      title: a.title,
      publisher: a.publisher,
      publishedDateTime: a.publishedDateTime,
      url: a.publisherUrl || a.googleNewsUrl,
      snippet: a.snippet || ""
    }))
  };

  const resp = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: `${prompt}\n\nINPUT:\n${JSON.stringify(user)}` }] }]
  });

  const text = resp?.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { articles, searchSummary: "" };

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { articles, searchSummary: "" };
  }

  const map = new Map();
  for (const it of parsed.items || []) {
    if (it?.url) map.set(String(it.url), it);
  }

  const enriched = articles.map((a) => {
    const key = a.publisherUrl || a.googleNewsUrl;
    const extra = key ? map.get(String(key)) : null;
    return {
      ...a,
      relevanceScore: Number.isFinite(Number(extra?.relevanceScore)) ? Number(extra.relevanceScore) : a.relevanceScore,
      summary: typeof extra?.summary === "string" ? extra.summary : a.summary
    };
  });

  // Sort by relevance if available
  enriched.sort((a, b) => (Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0)));

  return { articles: enriched, searchSummary: String(parsed.searchSummary || "") };
}

export async function POST(req) {
  try {
    const { keywords, dateFrom, dateTo, deepResearch } = await req.json();

    if (!keywords || typeof keywords !== "string" || keywords.trim().length < 2) {
      return Response.json({ error: "Please enter keywords (2+ chars)." }, { status: 400 });
    }

    const q = buildGoogleNewsQuery(keywords, dateFrom || "", dateTo || "");
    const url = rssUrlForQuery(q);

    // Standard fetch
    const feed = await parser.parseURL(url);

    const items = Array.isArray(feed?.items) ? feed.items : [];

    // Normalize
    let articles = items.map((it) => ({
      title: normalizeTitle(it),
      publisher: normalizePublisher(it),
      publishedDateTime: it?.isoDate || it?.pubDate || "",
      googleNewsUrl: String(it?.link || ""),
      publisherUrl: "",
      snippet: pickSnippet(it),
      summary: "",
      relevanceScore: null
    }));

    // Resolve final URLs for top N (faster + avoids doing it for everything)
    const resolveN = deepResearch ? 12 : 8;
    const slice = articles.slice(0, resolveN);
    const resolved = await Promise.all(slice.map(async (a) => ({
      ...a,
      publisherUrl: await resolveFinalUrl(a.googleNewsUrl)
    })));
    articles = [...resolved, ...articles.slice(resolveN)];

    // Basic cleanup + dedupe
    articles = uniqueByUrl(articles).slice(0, deepResearch ? 20 : 12);

    // Deep research = Gemini enrichment (optional)
    let searchSummary = `Showing results for "${keywords.trim()}"${dateFrom || dateTo ? " within your date range." : " (recent-first)."}`
    let totalSources = new Set(articles.map((a) => (a.publisher || "").toLowerCase()).filter(Boolean)).size;

    if (deepResearch) {
      const enriched = await deepSummarizeAndScore({ keywords, articles });
      articles = enriched.articles;
      if (enriched.searchSummary) searchSummary = enriched.searchSummary;
      totalSources = new Set(articles.map((a) => (a.publisher || "").toLowerCase()).filter(Boolean)).size;
    }

    // Ensure required fields
    const cleaned = articles.map((a) => ({
      title: String(a.title || ""),
      publisher: String(a.publisher || ""),
      publishedDateTime: String(a.publishedDateTime || ""),
      publisherUrl: String(a.publisherUrl || ""),
      googleNewsUrl: String(a.googleNewsUrl || ""),
      snippet: String(a.snippet || ""),
      summary: String(a.summary || ""),
      relevanceScore: a.relevanceScore === null ? null : Number(a.relevanceScore)
    }));

    return Response.json(
      {
        articles: cleaned,
        searchSummary,
        totalSources
      },
      { status: 200 }
    );
  } catch (e) {
    return Response.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
