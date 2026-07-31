import type { Metadata } from "next";

import { ExplorePageClient } from "./ExplorePageClient";
import {
  resolveExplorePageOptions,
  type ExploreSearchParameters,
} from "./explore-page-options";

export const metadata: Metadata = {
  title: "Global Wildfire Discovery | Firewatch",
  description:
    "Bounded global wildfire candidate discovery and coarse-area incident reads with explicit coverage and time semantics.",
  robots: { index: false, follow: false },
};

export default async function ExplorePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<ExploreSearchParameters>;
}>) {
  const parameters = await searchParams;
  const options = resolveExplorePageOptions(
    parameters,
    process.env.NODE_ENV,
    process.env.FIREWATCH_THERMAL_V3_UI_ENABLED,
  );
  return <ExplorePageClient {...options} />;
}
