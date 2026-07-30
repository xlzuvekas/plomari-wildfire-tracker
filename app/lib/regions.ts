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

// Verified official follow-up sources per region (issue #18 research).
// X handles listed there as unconfirmed (e.g. Valencia's) are deliberately
// excluded. `kind` is an English translation key resolved by localize().
export type RegionLink = { label: string; href: string; kind: string };

export const REGION_LINKS: Record<FireRegionId, RegionLink[]> = {
  lesvos: [],
  france: [
    {
      label: "Sécurité Civile",
      href: "https://x.com/SecCivileFrance",
      kind: "Official X account",
    },
    {
      label: "Préfecture du Var",
      href: "https://x.com/Prefet83",
      kind: "Official X account",
    },
    {
      label: "Météo des Forêts",
      href: "https://meteofrance.com/meteo-des-forets",
      kind: "Official fire-weather outlook",
    },
    {
      label: "franceinfo · incendies",
      href: "https://www.franceinfo.fr/monde/environnement/incendies-et-feux-de-foret/",
      kind: "Curated national coverage",
    },
  ],
  spain: [
    {
      label: "UME",
      href: "https://x.com/UMEgob",
      kind: "Official X account",
    },
    {
      label: "Plan INFOCA",
      href: "https://x.com/Plan_INFOCA",
      kind: "Official X account",
    },
    {
      label: "112 Castilla y León",
      href: "https://x.com/112cyl",
      kind: "Official X account",
    },
    {
      label: "Junta de Andalucía · noticias",
      href: "https://www.juntadeandalucia.es/noticias",
      kind: "Official government news",
    },
    {
      label: "INFORCYL open data",
      href: "https://datosabiertos.jcyl.es/web/jcyl/set/es/medio-ambiente/incendios-forestales/1284941252651",
      kind: "Official incident data",
    },
  ],
};
