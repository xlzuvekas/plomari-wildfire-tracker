import type { Metadata } from "next";

import { ExplorePageClient } from "./explore/ExplorePageClient";
import {
  resolveExplorePageOptions,
  type ExploreSearchParameters,
} from "./explore/explore-page-options";

export const metadata: Metadata = {
  title: "Global Wildfire Discovery | Firewatch",
  description:
    "Evidence-aware global wildfire discovery centered on the viewer's chosen area, with explicit coverage and time uncertainty.",
  robots: { index: false, follow: false },
};

export default async function GlobalFirewatchPage({
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
