import type { MetadataRoute } from "next";

// sitemap.xml: the public site's pages (dinerai.co.uk).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://dinerai.co.uk";
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
