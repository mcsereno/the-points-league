import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.svg`;
  const description = "A private NFL and college football virtual-points pool.";
  return {
    title: "Gridiron Ledger | Office Football Pool",
    description,
    icons: { icon: "/favicon.svg" },
    openGraph: { title: "Gridiron Ledger | Office Football Pool", description, images: [{ url: image, width: 1200, height: 630, alt: "Gridiron Ledger football pool" }] },
    twitter: { card: "summary_large_image", title: "Gridiron Ledger | Office Football Pool", description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
