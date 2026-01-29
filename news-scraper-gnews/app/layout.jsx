import "./globals.css";

export const metadata = {
  title: "Google News Scraper",
  description: "Keyword + date-range Google News scraper with exports"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
