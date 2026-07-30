// Fire-watch regions for the EU expansion (issue #18). Lesvos keeps the
// full single-incident treatment; France and Spain get the pan-EU baseline
// (EFFIS fire picture + Meteoalarm fire-weather warnings) as viewports.

import type { AlertCountry } from "../api/alerts/meteoalarm";

export type FireRegionId = "lesvos" | "france" | "spain";

export type FireRegion = {
  id: FireRegionId;
  country: AlertCountry;
  center: [number, number];
  zoom: number;
  // south, west, north, east — EFFIS WFS bbox order
  bbox: [number, number, number, number];
  timeZone: string;
};

export const FIRE_REGIONS: FireRegion[] = [
  {
    id: "lesvos",
    country: "gr",
    center: [38.988, 26.383],
    zoom: 13,
    bbox: [38.7, 25.8, 39.5, 26.8],
    timeZone: "Europe/Athens",
  },
  {
    // Mediterranean arc: Pyrénées-Orientales through Provence and Corsica.
    id: "france",
    country: "fr",
    center: [43.5, 4.8],
    zoom: 7,
    bbox: [41.2, -1.5, 45.5, 9.7],
    timeZone: "Europe/Paris",
  },
  {
    id: "spain",
    country: "es",
    center: [40.2, -3.9],
    zoom: 6,
    bbox: [35.8, -9.8, 43.9, 3.5],
    timeZone: "Europe/Madrid",
  },
];

export function regionById(id: string | null): FireRegion | null {
  return FIRE_REGIONS.find((region) => region.id === id) ?? null;
}
