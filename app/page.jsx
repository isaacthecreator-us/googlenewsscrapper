"use client";

import { useMemo, useState } from "react";

function toISODate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

function fmtDateTime(iso) {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCSV(rows) {
  const headers = [
    "title",
    "publisher",
    "publishedDateTime",
    "publisherUrl",
    "googleNewsUrl",
    "summary",
    "relevanceScore"
  ];
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h])).join(","));
  }
  return lines.join("\n");
}

export default function Page() {
  const [keywords, setKeywords] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deepResearch, setDeepResearch] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState({ articles: [], searchSummary: "", totalSources: 0 });

  const articles = useMemo(() => (Array.isArray(data.articles) ? data.articles : []), [data.articles]);

  async function runSearch() {
    setErr("");
    setLoading(true);
    setData({ articles: [], searchSummary: "", totalSources: 0 });

    try {
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, dateFrom, dateTo, deepResearch })
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `Request failed (${res.status})`);

      setData({
        articles: Array.isArray(payload.articles) ? payload.articles : [],
        searchSummary: payload.searchSummary || "",
        totalSources: payload.totalSources ?? 0
      });
    } catch (e) {
      setErr(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const canSearch = keywords.trim().length >= 2 && !loading;

  async function exportPDF() {
    try {
      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meta: {
            keywords,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            deepResearch
          },
          articles
        })
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p?.error || `PDF export failed (${res.status})`);
      }
      const blob = await res.blob();
      downloadBlob(`news-results-${toISODate(new Date())}.pdf`, blob);
    } catch (e) {
      setErr(e?.message || "PDF export failed.");
    }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ meta: { keywords, dateFrom, dateTo, deepResearch }, ...data }, null, 2)], {
      type: "application/json"
    });
    downloadBlob(`news-results-${toISODate(new Date())}.json`, blob);
  }

  function exportCSV() {
    const csv = toCSV(articles);
    const blob = new Blob([csv], { type: "text/csv" });
    downloadBlob(`news-results-${toISODate(new Date())}.csv`, blob);
  }

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logo" />
          <div>
            <h1 className="h1">Google News Scraper</h1>
            <p className="sub">Keywords + date range • Deep research • CSV/JSON/PDF exports</p>
          </div>
        </div>
        <span className="badge">Vercel-ready</span>
      </div>

      <div className="grid">
        <div className="card">
          <div className="cardPad">
            <div className="label">Keywords</div>
            <input
              className="input"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Search: e.g. 'AI regulation', 'Tesla earnings', 'construction safety'"
            />

            <div style={{ height: 12 }} />

            <div className="row">
              <div>
                <div className="label">From</div>
                <input className="smallInput" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <div className="label">To</div>
                <input className="smallInput" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>

            <div style={{ height: 12 }} />

            <label className="switchRow">
              <input type="checkbox" checked={deepResearch} onChange={(e) => setDeepResearch(e.target.checked)} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Deep research</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  More sources + Gemini summaries + relevance scoring.
                </div>
              </div>
            </label>

            <div className="btnRow">
              <button className="btn btnPrimary" onClick={runSearch} disabled={!canSearch}>
                {loading ? "Searching…" : "Search"}
              </button>
              <button
                className="btn"
                disabled={loading}
                onClick={() => {
                  setKeywords("");
                  setDateFrom("");
                  setDateTo("");
                  setDeepResearch(false);
                  setErr("");
                  setData({ articles: [], searchSummary: "", totalSources: 0 });
                }}
              >
                Clear
              </button>
            </div>

            <div className="helper">
              Date range filters Google News results using query operators (<code>after:</code> and <code>before:</code>).
              If you leave dates empty, it prioritizes recency.
            </div>

            {err ? <div className="error">Error: {err}</div> : null}
          </div>
        </div>

        <div className="card">
          <div className="cardPad">
            <div className="resultsHeader">
              <h2 className="h2">Results</h2>
              <div className="chips">
                <span className="chip">Articles: {articles.length}</span>
                <span className="chip">Sources: {Number(data.totalSources || 0)}</span>
              </div>
            </div>

            {data.searchSummary ? <p className="summary">{data.searchSummary}</p> : <p className="summary">Run a search to see results.</p>}

            <div className="exportRow">
              <button className="btn" onClick={exportCSV} disabled={!articles.length || loading}>Download CSV</button>
              <button className="btn" onClick={exportJSON} disabled={!articles.length || loading}>Download JSON</button>
              <button className="btn" onClick={exportPDF} disabled={!articles.length || loading}>Download PDF</button>
            </div>

            <div style={{ height: 10 }} />

            <div className="list">
              {articles.map((a, idx) => (
                <div className="item" key={a.publisherUrl || a.googleNewsUrl || idx}>
                  <a href={a.publisherUrl || a.googleNewsUrl} target="_blank" rel="noreferrer">
                    <h3 className="title">{a.title || "Untitled"}</h3>
                  </a>

                  <div className="meta">
                    <span><b>{a.publisher || "Unknown publisher"}</b></span>
                    <span>•</span>
                    <span>{fmtDateTime(a.publishedDateTime)}</span>
                    {Number.isFinite(Number(a.relevanceScore)) ? <span className="badge">Relevance {Number(a.relevanceScore)}</span> : null}
                    {a.googleNewsUrl ? (
                      <a href={a.googleNewsUrl} target="_blank" rel="noreferrer" className="badge" style={{ color: "var(--blue2)" }}>
                        View on Google News
                      </a>
                    ) : null}
                  </div>

                  {a.summary ? <div className="snippet">{a.summary}</div> : a.snippet ? <div className="snippet">{a.snippet}</div> : null}
                </div>
              ))}
            </div>

            {!articles.length && !loading ? <div className="footerNote">No results yet.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
