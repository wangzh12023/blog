import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: config.site.title,
  description: config.site.description,
  keywords: config.site.keywords,
  metadataBase: config.seo.metadataBase,
  alternates: config.seo.alternates,
  icons: [
    { rel: "icon", url: config.site.favicon.png, sizes: "48x48", type: "image/png" },
    { rel: "apple-touch-icon", url: config.site.favicon.appleTouchIcon, sizes: "180x180" },
  ],
  openGraph: {
    url: config.site.url,
    type: config.seo.openGraph.type,
    title: config.site.title,
    description: config.site.description,
    images: [
      { url: config.site.image }
    ]
  },
  twitter: {
    site: config.site.url,
    card: config.seo.twitter.card,
    title: config.site.title,
    description: config.site.description,
    images: [
      { url: config.site.image }
    ]
  },
  manifest: config.site.manifest,
  appleWebApp: {
    title: config.site.title,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-lite-webfont@1.1.0/style.css" />
        <style>
          {`
            body {
              font-family: "LXGW WenKai Lite", sans-serif;
            }
          `}
        </style>
        <link rel="alternate" type="application/rss+xml" title="RSS" href={`${config.site.basePath}/rss.xml`} />
        <link rel="alternate" type="application/atom+xml" title="Atom" href={`${config.site.basePath}/atom.xml`} />
        <link rel="alternate" type="application/json" title="JSON" href={`${config.site.basePath}/feed.json`} />
        <link rel="icon" href={`${config.site.basePath}/favicon.png`} sizes="any" />
      </head>
      <body className="min-w-0 overflow-x-hidden">
        <Header />
        {children}
      </body>
    </html>
  );
}
