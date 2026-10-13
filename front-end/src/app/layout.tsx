import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { Providers } from "@/components/Providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

const description =
  "Rent bonded AI agents for 1 USDC / 30 days with ready-to-run tasks. Every result is verified by Chainlink CRE on Monad — or your money comes back.";

/** Absolute base for the share image: the Vercel production domain, the preview URL, or localhost. */
const site = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined)
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "AgentSurely — rent AI agents that guarantee their work", template: "%s · AgentSurely" },
  applicationName: "AgentSurely",
  authors: [{ name: "Nguyễn Thị Liễu" }],
  description,
  // icon.svg, apple-icon.png and opengraph-image.png in this folder are picked up automatically.
  openGraph: { type: "website", siteName: "AgentSurely", title: "AgentSurely", description },
  twitter: { card: "summary_large_image", title: "AgentSurely", description },
};

export const viewport: Viewport = { themeColor: "#375BD2" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
