import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Plomari Firewatch | Πυροφύλαξη Πλωμαρίου",
    short_name: "Firewatch",
    description:
      "Bilingual public situational-awareness map for the Plomari wildfire.",
    start_url: "/",
    display: "standalone",
    background_color: "#03070a",
    theme_color: "#03070a",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
