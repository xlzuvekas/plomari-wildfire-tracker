import type { Metadata } from "next";

import PlomariIncidentClient from "./PlomariIncidentClient";

export const metadata: Metadata = {
  title: "Plomari · 29 July 2026 Incident Archive | Firewatch",
  description:
    "Historical, source-labeled Plomari wildfire evidence through 29 July 2026 at 20:50 Europe/Athens. This archive does not assert containment, resolution, or an all-clear.",
};

export default function PlomariIncidentArchivePage() {
  return <PlomariIncidentClient />;
}
