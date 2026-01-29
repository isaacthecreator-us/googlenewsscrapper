import PDFDocument from "pdfkit";

export const runtime = "nodejs";

function safe(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

export async function POST(req) {
  try {
    const { meta, articles } = await req.json();

    if (!Array.isArray(articles) || articles.length === 0) {
      return Response.json({ error: "No articles to export." }, { status: 400 });
    }

    const doc = new PDFDocument({ size: "LETTER", margin: 50 });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));

    const finished = new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    // Header
    doc.fontSize(18).text("News Results", { align: "left" });
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor("#444").text(`Keywords: ${safe(meta?.keywords)}`);
    doc.text(`Date range: ${safe(meta?.dateFrom) || "—"} to ${safe(meta?.dateTo) || "—"}`);
    doc.text(`Deep research: ${meta?.deepResearch ? "Yes" : "No"}`);
    doc.moveDown(0.75);
    doc.fillColor("#000");

    // Articles
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      const title = safe(a?.title) || "Untitled";
      const pub = safe(a?.publisher) || "Unknown publisher";
      const dt = safe(a?.publishedDateTime) || "Unknown date";
      const url = safe(a?.publisherUrl) || safe(a?.googleNewsUrl) || "";

      doc.fontSize(12).fillColor("#000").text(`${i + 1}. ${title}`, { underline: false });
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor("#444").text(`${pub} • ${dt}`);
      if (url) {
        doc.fillColor("#1a73e8").text(url, { link: url, underline: true });
        doc.fillColor("#000");
      }
      const summary = safe(a?.summary) || safe(a?.snippet) || "";
      if (summary) {
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor("#111").text(summary);
      }
      doc.moveDown(0.8);

      if (doc.y > 720 && i < articles.length - 1) {
        doc.addPage();
      }
    }

    doc.end();
    const pdfBuffer = await finished;

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="news-results.pdf"'
      }
    });
  } catch (e) {
    return Response.json({ error: e?.message || "PDF export error" }, { status: 500 });
  }
}
