"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DE, ES, FR, IT } from "./translations";
import type { GeocodeResult } from "./api/geocode/nominatim";
import { assessProximity } from "./lib/proximity";
import type { BurntArea } from "./api/effis/effis";
import type { AlertSummary } from "./api/alerts/meteoalarm";
import type { SpainIncident } from "./api/spain-incidents/inforcyl";
import type { NewsItem } from "./api/regionnews/feeds";
import type { NormalizedAirQuality } from "./api/wind/airquality";
import {
  FIRE_REGIONS,
  REGION_LINKS,
  type FireRegionId,
} from "./lib/regions";
import type {
  LayerGroup,
  Map as LeafletMap,
  TileLayer,
  WMSOptions,
} from "leaflet";
import "leaflet/dist/leaflet.css";

type LatLngTuple = [number, number];
type Confidence = "official" | "observed" | "reported" | "modeled";
type Language = "en" | "el" | "es" | "fr" | "de" | "it";

const LANGUAGES: Language[] = ["en", "el", "es", "fr", "de", "it"];

const LOCALES: Record<Language, string> = {
  en: "en-GB",
  el: "el-GR",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
};

const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  el: "Ελληνικά",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
};

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}
type LayerKey =
  | "official"
  | "satellite"
  | "satelliteRaster"
  | "effis"
  | "inforcyl"
  | "local"
  | "wind"
  | "smokeObserved"
  | "smoke"
  | "simulation";
type BaseMode = "dark" | "satellite" | "terrain";
type ThermalWindow = "latest" | "6h" | "24h";

type WindVector = {
  speedKmh: number;
  directionDeg: number;
};

type WindCurrent = {
  time: string;
  tempC: number;
  rhPct: number;
  dewpointC: number;
  pressureHpa: number;
  pblM: number;
  wind10: WindVector;
  gustKmh: number;
  wind80: WindVector;
  wind120: WindVector;
  wind180: WindVector;
};

type WindPayload = {
  generatedAt: string;
  locations: Array<{
    id: string;
    label: string;
    lat: number;
    lon: number;
    provider: string;
    current: WindCurrent;
  }>;
  metar: {
    station: string;
    observedAt: string;
    raw: string;
    directionDeg: number;
    speedKt: number;
    gustKt: number | null;
    variableFromDeg?: number;
    variableToDeg?: number;
    tempC: number;
    dewpointC: number;
    pressureHpa: number;
  } | null;
  airQuality?: Array<{
    id: string;
    label: string;
    time: string | null;
    pm25: number | null;
    pm10: number | null;
    europeanAqi: number | null;
  }>;
  errors: string[];
};

type IntelItem = {
  id: string;
  time: string;
  label: string;
  detail: string;
  confidence: Confidence;
  sourceUrl?: string;
  sourceLabel?: string;
  category?: LiveUpdateItem["category"];
  severity?: LiveUpdateItem["severity"];
  actionRequired?: boolean;
  live?: boolean;
  archived?: boolean;
};

type LiveThermalDetection = {
  id: string;
  passId: string;
  lat: number;
  lon: number;
  sensor: string;
  satellite: string;
  product: string;
  version: string | null;
  observedAt: string;
  ageMinutes: number;
  confidence: string;
  confidenceCode: "h" | "n" | "l" | "u";
  frpMw: number | null;
  scanKm: number | null;
  trackKm: number | null;
  daynight: string | null;
  distanceFromIncidentKm: number;
  bearingFromIncidentDeg: number;
  scope: "incident" | "regional";
};

type ThermalPayload = {
  schemaVersion: 2;
  status: "ok" | "partial" | "unconfigured" | "upstream-error";
  requestStartedAt: string;
  retrievedAt: string;
  query: {
    bounds: { west: number; south: number; east: number; north: number };
    incidentCenter: { lat: number; lon: number };
    incidentRadiusKm: number;
    from: string;
    to: string;
    maxAgeHours: number;
  };
  credential: {
    env: "FIRMS_MAP_KEY";
    configured: boolean;
  };
  latestObservedAt: string | null;
  latestIncidentObservedAt: string | null;
  observationAgeMinutes: number | null;
  complete: boolean;
  datasets: Array<{
    id: string;
    label: string;
    status: "ok" | "error" | "unconfigured";
    records: number;
    latestObservedAt: string | null;
    errorCode: string | null;
  }>;
  summary: {
    incidentRecords: number;
    regionalRecords: number;
    passCount: number;
    byConfidence: { h: number; n: number; l: number; u: number };
  };
  passes: Array<{
    id: string;
    platform: string;
    satellite: string;
    product: string;
    observedAt: string;
    ageMinutes: number;
    recordCount: number;
    incidentRecordCount: number;
    byConfidence: { h: number; n: number; l: number; u: number };
    maxFrpMw: number | null;
    medianFrpMw: number | null;
    dayNight: string | null;
  }>;
  detections: LiveThermalDetection[];
  errors: Array<{
    code: string | null;
    dataset: string | null;
    message: string;
  }>;
  source: {
    name: string;
    docs: string;
    semantics: string;
    appPollSeconds: number;
    upstreamRefreshMinutes: number;
    globalNrtLatencyMaxHours: number;
    observationCadenceNote: string;
  };
};

type LiveUpdateItem = {
  id: string;
  title: string;
  summaryEn: string;
  summaryEl: string;
  url: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind:
    | "official-alert"
    | "official-status"
    | "official-context"
    | "local-reporting"
    | "public-broadcaster";
  sourceTier: "official" | "publisher";
  publishedAt: string | null;
  modifiedAt: string | null;
  timeQuality: "exact" | "date-only" | "feed-order-only";
  latestUpdateLabel: string | null;
  ageMinutes: number | null;
  category:
    | "evacuation"
    | "readiness"
    | "road"
    | "smoke"
    | "rekindling"
    | "containment"
    | "response"
    | "incident";
  severity: "critical" | "high" | "medium" | "low";
  actionRequired: boolean;
};

type UpdatesPayload = {
  schemaVersion: 2;
  requestStartedAt: string;
  retrievedAt: string;
  localTimeZone: "Europe/Athens";
  refreshSeconds: number;
  officialAlert: {
    issuedAt: string;
    lastManuallyVerifiedAt: string;
    lastAutomaticallyCheckedAt: string | null;
    automaticOfficialFeedConfigured: boolean;
    status: string;
    manual: true;
    action: string;
    sourceUrl: string;
  };
  fireServiceIncident: {
    status: "in-progress" | "partial-control" | "full-control" | "ended";
    statusLabel: string;
    municipality: string;
    incidentType: string;
    sourceAge: string | null;
    fetchedAt: string;
    sourceUrl: string;
    official: true;
  } | null;
  sources: Array<{
    id: string;
    label: string;
    url: string;
    kind:
      | "official-alert"
      | "official-status"
      | "official-context"
      | "local-reporting"
      | "public-broadcaster";
    tier: "official" | "publisher";
    timeQuality: string;
    fetchedAt: string | null;
    channelUpdatedAt: string | null;
    latestItemAt: string | null;
    status: "ok" | "error" | "unconfigured";
    itemCount: number;
    errorCode: string | null;
  }>;
  sourceSummary: {
    total: number;
    online: number;
    failed: number;
    unconfigured: number;
  };
  items: LiveUpdateItem[];
  errors: Array<{
    sourceId: string;
    code: string | null;
    message: string;
  }>;
};

const INCIDENT: LatLngTuple = [38.989013, 26.382489];
const PLOMARI_BEACH: LatLngTuple = [38.9752, 26.3714];
const AGIOS_ISIDOROS: LatLngTuple = [38.9702, 26.3927];
const MELINTA: LatLngTuple = [38.9875, 26.3131];
const MILIES: LatLngTuple = [38.998, 26.4109];
const PLAGIA: LatLngTuple = [38.98234, 26.39769];
const PERAMA: LatLngTuple = [39.0429, 26.50556];
const AGIOS_ANTONIOS: LatLngTuple = [38.9817634, 26.4073025];
const MEGALOCHORI: LatLngTuple = [39.0173137, 26.3687164];

const WIND_FALLBACK: WindCurrent = {
  time: "2026-07-29T22:00",
  tempC: 25.3,
  rhPct: 41,
  dewpointC: 11.1,
  pressureHpa: 1002.8,
  pblM: 950,
  wind10: { speedKmh: 39.8, directionDeg: 42 },
  gustKmh: 120.2,
  wind80: { speedKmh: 65, directionDeg: 42 },
  wind120: { speedKmh: 74, directionDeg: 41 },
  wind180: { speedKmh: 80.4, directionDeg: 41 },
};

const LANDFILL_FOOTPRINT: LatLngTuple[] = [
  [38.9895777, 26.3815427],
  [38.9896611, 26.3826692],
  [38.9894318, 26.3841981],
  [38.9890774, 26.3842678],
  [38.9887021, 26.3833129],
  [38.9879933, 26.3826156],
  [38.9881392, 26.3818645],
  [38.9887438, 26.3815963],
  [38.9895777, 26.3815427],
];

const intelEn: IntelItem[] = [
  {
    id: "overnight-hotspots",
    time: "20:50",
    label: "Aerial drops ended; scattered hotspots remain",
    detail:
      "Local field reporting says aerial operations ended for the night, with scattered active hotspots around Agios Antonios and toward Megalochori. Strong winds are hampering ground crews. This is not an official containment statement.",
    confidence: "reported",
  },
  {
    id: "no-active-front",
    time: "19:55",
    label: "No continuous front reported; rekindling risk",
    detail:
      "The deputy regional governor reported no active continuous front, but numerous scattered hotspots remained in difficult terrain. Crews stayed alert for rekindling. This was a local official statement, not a Fire Service all-clear.",
    confidence: "reported",
  },
  {
    id: "homes",
    time: "19:25",
    label: "Hotspots reported near holiday homes",
    detail:
      "Local reporting said hotspots remained above Plomari near holiday homes. Residents and volunteers reportedly prevented flames from reaching houses.",
    confidence: "reported",
  },
  {
    id: "smoke",
    time: "17:50",
    label: "Regional satellite smoke observed",
    detail:
      "Satellite imagery showed smoke from the Plomari incident and a major Turkish fire transported across Lesvos. This is a regional smoke snapshot, not a ground-level PM2.5 measurement.",
    confidence: "observed",
  },
  {
    id: "evacuation",
    time: "16:58",
    label: "Official 112 alert issued at 16:58",
    detail:
      "People in the Plomari area were instructed to move toward Plomari beach in the direction of Agios Isidoros. This reproduces the alert issued at 16:58; check the incident wire and authorities for any newer instruction.",
    confidence: "official",
  },
  {
    id: "reinforced",
    time: "16:34",
    label: "Fire Service response reinforced",
    detail:
      "Fire Service reported 50 firefighters, two 12th EMODE teams, volunteers, 13 vehicles, three aircraft and three helicopters.",
    confidence: "official",
  },
  {
    id: "modis",
    time: "16:06",
    label: "Latest satellite heat",
    detail:
      "Aqua MODIS detected active heat near Chalkelia. A satellite point is an observed hot pixel, not a fire perimeter.",
    confidence: "observed",
  },
  {
    id: "viirs",
    time: "15:17",
    label: "NOAA-20 pass",
    detail:
      "Six VIIRS hot pixels were detected near the incident, including three high-confidence detections.",
    confidence: "observed",
  },
  {
    id: "ignition",
    time: "14:00",
    label: "Fire reported",
    detail:
      "The incident was reported around the restored Chalkelia landfill, north-east of Plomari.",
    confidence: "official",
  },
];

const intelEl: IntelItem[] = [
  {
    id: "overnight-hotspots",
    time: "20:50",
    label: "Σταμάτησαν οι εναέριες ρίψεις· παραμένουν διάσπαρτες εστίες",
    detail:
      "Σύμφωνα με τοπική επιτόπια ενημέρωση, οι εναέριες επιχειρήσεις σταμάτησαν για τη νύχτα και παρέμειναν διάσπαρτες ενεργές εστίες γύρω από τον Άγιο Αντώνιο και προς το Μεγαλοχώρι. Οι ισχυροί άνεμοι δυσχεραίνουν τα πεζοπόρα τμήματα. Δεν πρόκειται για επίσημη ανακοίνωση οριοθέτησης.",
    confidence: "reported",
  },
  {
    id: "no-active-front",
    time: "19:55",
    label: "Δεν αναφέρθηκε ενιαίο μέτωπο· κίνδυνος αναζωπύρωσης",
    detail:
      "Ο αντιπεριφερειάρχης ανέφερε ότι δεν υπήρχε ενεργό ενιαίο μέτωπο, όμως παρέμεναν πολλές διάσπαρτες εστίες σε δύσβατο έδαφος. Οι δυνάμεις παρέμειναν σε επιφυλακή για αναζωπυρώσεις. Ήταν τοπική επίσημη δήλωση, όχι μήνυμα λήξης συναγερμού από την Πυροσβεστική.",
    confidence: "reported",
  },
  {
    id: "homes",
    time: "19:25",
    label: "Αναφέρθηκαν εστίες κοντά σε εξοχικές κατοικίες",
    detail:
      "Τοπικό ρεπορτάζ ανέφερε ότι παρέμεναν εστίες πάνω από το Πλωμάρι, κοντά σε εξοχικές κατοικίες. Κάτοικοι και εθελοντές φέρονται να εμπόδισαν τις φλόγες να φτάσουν σε σπίτια.",
    confidence: "reported",
  },
  {
    id: "smoke",
    time: "17:50",
    label: "Δορυφορική παρατήρηση καπνού στην περιοχή",
    detail:
      "Δορυφορική εικόνα έδειξε καπνό από το συμβάν στο Πλωμάρι και από μεγάλη πυρκαγιά στην Τουρκία να μεταφέρεται πάνω από τη Λέσβο. Πρόκειται για περιφερειακή απεικόνιση καπνού, όχι για μέτρηση PM2.5 στο έδαφος.",
    confidence: "observed",
  },
  {
    id: "evacuation",
    time: "16:58",
    label: "Επίσημη ειδοποίηση 112 που εκδόθηκε στις 16:58",
    detail:
      "Όσοι βρίσκονταν στην περιοχή Πλωμαρίου κλήθηκαν να απομακρυνθούν προς την παραλία Πλωμαρίου με κατεύθυνση τον Άγιο Ισίδωρο. Η καταχώριση αναπαράγει την ειδοποίηση των 16:58· ελέγξτε τη ροή συμβάντος και τις Αρχές για κάθε νεότερη οδηγία.",
    confidence: "official",
  },
  {
    id: "reinforced",
    time: "16:34",
    label: "Ενισχύθηκαν οι δυνάμεις της Πυροσβεστικής",
    detail:
      "Η Πυροσβεστική ανέφερε 50 πυροσβέστες, δύο ομάδες της 12ης ΕΜΟΔΕ, εθελοντές, 13 οχήματα, τρία αεροσκάφη και τρία ελικόπτερα.",
    confidence: "official",
  },
  {
    id: "modis",
    time: "16:06",
    label: "Νεότερη δορυφορική θερμική ανίχνευση",
    detail:
      "Ο Aqua MODIS ανίχνευσε ενεργή θερμότητα κοντά στα Χαλκέλια. Ένα δορυφορικό σημείο είναι θερμό εικονοστοιχείο και όχι περίμετρος πυρκαγιάς.",
    confidence: "observed",
  },
  {
    id: "viirs",
    time: "15:17",
    label: "Διέλευση NOAA-20",
    detail:
      "Ανιχνεύθηκαν έξι θερμά εικονοστοιχεία VIIRS κοντά στο συμβάν, τρία από αυτά υψηλής αξιοπιστίας.",
    confidence: "observed",
  },
  {
    id: "ignition",
    time: "14:00",
    label: "Αναφέρθηκε πυρκαγιά",
    detail:
      "Το συμβάν αναφέρθηκε γύρω από τον αποκατεστημένο ΧΑΔΑ στα Χαλκέλια, βορειοανατολικά του Πλωμαρίου.",
    confidence: "official",
  },
];

const sourcesEn = [
  {
    label: "Fire Service board",
    href: "https://www.fireservice.gr/apps/fire2019/symvanta/page.php",
    kind: "Official incident status · automatic",
  },
  {
    label: "112 Greece",
    href: "https://x.com/112Greece/status/2082468150189167080",
    kind: "Original official alert · 16:58",
  },
  {
    label: "Protective guidance",
    href: "https://civilprotection.gov.gr/112/odigies-prostasias",
    kind: "Official safety instructions",
  },
  {
    label: "Fire Service",
    href: "https://x.com/pyrosvestiki/status/2082459852350066823",
    kind: "Official response · 16:34",
  },
  {
    label: "StoNisi overnight",
    href: "https://www.stonisi.gr/post/114624/stamathsan-oi-ripseis-apo-aeros-sthn-fwtia-toy-plwmarioy",
    kind: "Local field report · 20:50",
  },
  {
    label: "Aeolos",
    href: "https://aeolos.tv/140029/kalyteri-i-eikona-sti-fotia-tou-plomariou-synechizetai-i-machi-me-tis-anazopyroseis/",
    kind: "Local reporting · repeated rekindling",
  },
  {
    label: "Satellite smoke",
    href: "https://www.stonisi.gr/post/115334/kapnos-apo-thn-toyrkia-skepazei-lesvo-kai-xio",
    kind: "Regional smoke report · 17:50",
  },
  {
    label: "NASA FIRMS",
    href: "https://firms.modaps.eosdis.nasa.gov/api/area/",
    kind: "Thermal points · server-side API",
  },
  {
    label: "NASA GIBS",
    href: "https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/#vector-visualizations",
    kind: "No-key thermal / aerosol overlay",
  },
  {
    label: "Open-Meteo",
    href: "https://open-meteo.com/en/docs",
    kind: "Detailed point wind model",
  },
  {
    label: "AviationWeather",
    href: "https://aviationweather.gov/data/api/",
    kind: "Measured LGMT airport METAR",
  },
];

const sourcesEl = [
  {
    label: "Πίνακας Πυροσβεστικής",
    href: "https://www.fireservice.gr/apps/fire2019/symvanta/page.php",
    kind: "Επίσημη κατάσταση συμβάντος · αυτόματα",
  },
  {
    label: "112 Ελλάδας",
    href: "https://x.com/112Greece/status/2082468150189167080",
    kind: "Αρχική επίσημη ειδοποίηση · 16:58",
  },
  {
    label: "Οδηγίες προστασίας",
    href: "https://civilprotection.gov.gr/112/odigies-prostasias",
    kind: "Επίσημες οδηγίες ασφάλειας",
  },
  {
    label: "Πυροσβεστικό Σώμα",
    href: "https://x.com/pyrosvestiki/status/2082459852350066823",
    kind: "Επίσημη κινητοποίηση · 16:34",
  },
  {
    label: "StoNisi · νυχτερινή ενημέρωση",
    href: "https://www.stonisi.gr/post/114624/stamathsan-oi-ripseis-apo-aeros-sthn-fwtia-toy-plwmarioy",
    kind: "Τοπική επιτόπια ενημέρωση · 20:50",
  },
  {
    label: "Aeolos",
    href: "https://aeolos.tv/140029/kalyteri-i-eikona-sti-fotia-tou-plomariou-synechizetai-i-machi-me-tis-anazopyroseis/",
    kind: "Τοπικό ρεπορτάζ · επαναλαμβανόμενες αναζωπυρώσεις",
  },
  {
    label: "Δορυφορική εικόνα καπνού",
    href: "https://www.stonisi.gr/post/115334/kapnos-apo-thn-toyrkia-skepazei-lesvo-kai-xio",
    kind: "Περιφερειακή αναφορά καπνού · 17:50",
  },
  {
    label: "NASA FIRMS",
    href: "https://firms.modaps.eosdis.nasa.gov/api/area/",
    kind: "Θερμικά σημεία · API διακομιστή",
  },
  {
    label: "NASA GIBS",
    href: "https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/#vector-visualizations",
    kind: "Θερμικό / αερολυματικό επίπεδο χωρίς κλειδί",
  },
  {
    label: "Open-Meteo",
    href: "https://open-meteo.com/en/docs",
    kind: "Λεπτομερές σημειακό μοντέλο ανέμου",
  },
  {
    label: "AviationWeather",
    href: "https://aviationweather.gov/data/api/",
    kind: "Μετρημένο METAR αεροδρομίου LGMT",
  },
];

const spreadRates: Record<number, number> = {
  3: 0.28,
  4: 0.42,
  5: 0.58,
  6: 0.78,
  7: 1.02,
};

const BASEMAPS: Record<
  BaseMode,
  { url: string; attribution: string; maxZoom: number }
> = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution:
      "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17,
    attribution:
      'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, contours &copy; OpenTopoMap',
  },
};

function destination(
  origin: LatLngTuple,
  bearingDegrees: number,
  distanceKm: number,
): LatLngTuple {
  const radius = 6371;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const angularDistance = distanceKm / radius;
  const latitude = (origin[0] * Math.PI) / 180;
  const longitude = (origin[1] * Math.PI) / 180;
  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const nextLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) -
        Math.sin(latitude) * Math.sin(nextLatitude),
    );
  return [
    (nextLatitude * 180) / Math.PI,
    (nextLongitude * 180) / Math.PI,
  ];
}

function scenarioShape(
  origin: LatLngTuple,
  heading: number,
  distanceKm: number,
  halfAngle = 58,
): LatLngTuple[] {
  if (distanceKm <= 0) return [origin, origin, origin];
  const points: LatLngTuple[] = [origin];
  const step = Math.max(4, Math.round((halfAngle * 2) / 14));
  for (let offset = -halfAngle; offset <= halfAngle; offset += step) {
    const taper =
      0.38 +
      0.62 * Math.cos((Math.abs(offset) / halfAngle) * (Math.PI / 2));
    points.push(destination(origin, heading + offset, distanceKm * taper));
  }
  points.push(origin);
  return points;
}

function markerHtml(
  kind: "fire" | "settlement" | "arrow" | "wind" | "user",
  label: string,
) {
  return `<div class="map-marker map-marker--${kind}"><span></span><b>${label}</b></div>`;
}

// Spanish/French come from the dictionaries in app/translations.ts, keyed
// by the English source string; a missing entry falls back to English.
const DICTIONARIES: Partial<Record<Language, Record<string, string>>> = {
  es: ES,
  fr: FR,
  de: DE,
  it: IT,
};

function translate(language: Language, english: string) {
  return DICTIONARIES[language]?.[english] ?? english;
}

function localize(language: Language, english: string, greek: string) {
  return language === "el" ? greek : translate(language, english);
}

// For strings built from template literals, where a dictionary keyed by the
// full English text cannot work.
function pick(language: Language, variants: Record<Language, string>) {
  return variants[language];
}

// European Air Quality Index bands (EEA scale). Boundary values belong to
// the lower band: 0-20 good, 20-40 fair, ..., 80-100 very poor, >100
// extremely poor.
function eaqiBand(language: Language, value: number) {
  if (value <= 20) return localize(language, "GOOD", "ΚΑΛΗ");
  if (value <= 40) return localize(language, "FAIR", "ΙΚΑΝΟΠΟΙΗΤΙΚΗ");
  if (value <= 60) return localize(language, "MODERATE", "ΜΕΤΡΙΑ");
  if (value <= 80) return localize(language, "POOR", "ΚΑΚΗ");
  if (value <= 100) return localize(language, "VERY POOR", "ΠΟΛΥ ΚΑΚΗ");
  return localize(language, "EXTREMELY POOR", "ΕΞΑΙΡΕΤΙΚΑ ΚΑΚΗ");
}

function confidenceLabel(confidence: Confidence, language: Language) {
  if (confidence === "official") {
    return localize(language, "OFFICIAL", "ΕΠΙΣΗΜΗ ΠΗΓΗ");
  }
  if (confidence === "observed") {
    return localize(language, "OBSERVED", "ΠΑΡΑΤΗΡΗΣΗ");
  }
  if (confidence === "reported") {
    return localize(language, "LOCAL REPORT", "ΤΟΠΙΚΗ ΑΝΑΦΟΡΑ");
  }
  return localize(language, "MODELED", "ΜΟΝΤΕΛΟ");
}

function midpoint(a: LatLngTuple, b: LatLngTuple): LatLngTuple {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function formatGreeceTime(value: string | undefined) {
  if (!value) return "—";
  if (
    value.includes("T") &&
    !value.endsWith("Z") &&
    !/[+-]\d{2}:\d{2}$/.test(value)
  ) {
    return value.split("T")[1]?.slice(0, 5) ?? value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.includes("T") ? value.split("T")[1]?.slice(0, 5) ?? value : value;
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function formatGreeceDateTime(
  value: string | null | undefined,
  language: Language = "en",
) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALES[language], {
    timeZone: "Europe/Athens",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function ageLabel(
  ageMinutes: number | null | undefined,
  language: Language,
) {
  if (ageMinutes === null || ageMinutes === undefined) {
    return localize(language, "age unknown", "άγνωστη ηλικία");
  }
  if (ageMinutes < 60) {
    return pick(language, {
      en: `${ageMinutes} min ago`,
      el: `πριν από ${ageMinutes} λεπτά`,
      es: `hace ${ageMinutes} min`,
      fr: `il y a ${ageMinutes} min`,
      de: `vor ${ageMinutes} Min.`,
      it: `${ageMinutes} min fa`,
    });
  }
  const hours = Math.floor(ageMinutes / 60);
  const minutes = ageMinutes % 60;
  if (hours < 24) {
    return pick(language, {
      en: `${hours}h${minutes ? ` ${minutes}m` : ""} ago`,
      el: `πριν από ${hours}ω${minutes ? ` ${minutes}λ` : ""}`,
      es: `hace ${hours}h${minutes ? ` ${minutes}m` : ""}`,
      fr: `il y a ${hours}h${minutes ? ` ${minutes}m` : ""}`,
      de: `vor ${hours}h${minutes ? ` ${minutes}m` : ""}`,
      it: `${hours}h${minutes ? ` ${minutes}m` : ""} fa`,
    });
  }
  const days = Math.floor(hours / 24);
  return pick(language, {
    en: `${days}d ${hours % 24}h ago`,
    el: `πριν από ${days}η ${hours % 24}ω`,
    es: `hace ${days}d ${hours % 24}h`,
    fr: `il y a ${days}j ${hours % 24}h`,
    de: `vor ${days}T ${hours % 24}h`,
    it: `${days}g ${hours % 24}h fa`,
  });
}

function ageMinutesFromTimestamp(
  value: string | null | undefined,
  nowEpoch: number,
) {
  if (!value) return null;
  const observedEpoch = new Date(value).getTime();
  if (Number.isNaN(observedEpoch)) return null;
  return Math.max(0, Math.floor((nowEpoch - observedEpoch) / 60_000));
}

function thermalConfidenceLabel(
  code: LiveThermalDetection["confidenceCode"],
  language: Language,
) {
  const labels = {
    h: localize(language, "High", "Υψηλή"),
    n: localize(language, "Nominal", "Ονομαστική"),
    l: localize(language, "Low", "Χαμηλή"),
    u: localize(language, "Unknown", "Άγνωστη"),
  };
  return labels[code];
}

function updateCategoryLabel(
  category: LiveUpdateItem["category"] | undefined,
  language: Language,
) {
  if (!category) return null;
  const labels: Record<LiveUpdateItem["category"], [string, string]> = {
    evacuation: ["Evacuation", "Απομάκρυνση"],
    readiness: ["Readiness", "Ετοιμότητα"],
    road: ["Road", "Οδικό δίκτυο"],
    smoke: ["Smoke", "Καπνός"],
    rekindling: ["Rekindling", "Αναζωπύρωση"],
    containment: ["Control", "Έλεγχος"],
    response: ["Response", "Επιχείρηση"],
    incident: ["Incident", "Συμβάν"],
  };
  return localize(language, ...labels[category]);
}

function utcDate(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function compass(degrees: number, language: Language = "en") {
  const points =
    language === "el"
      ? ["Β", "ΒΑ", "Α", "ΝΑ", "Ν", "ΝΔ", "Δ", "ΒΔ"]
      : language === "es" || language === "fr" || language === "it"
        ? ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]
        : language === "de"
          ? ["N", "NO", "O", "SO", "S", "SW", "W", "NW"]
          : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

function localizeFireStatus(
  status: NonNullable<UpdatesPayload["fireServiceIncident"]>["status"] | null,
  fallback: string | undefined,
  language: Language,
) {
  if (!status) {
    return localize(language, fallback ?? "STATUS PENDING", "ΑΝΑΜΟΝΗ ΕΝΗΜΕΡΩΣΗΣ");
  }
  const labels = {
    "in-progress": {
      en: "IN PROGRESS",
      el: "ΣΕ ΕΞΕΛΙΞΗ",
      es: "EN CURSO",
      fr: "EN COURS",
      de: "IM GANGE",
      it: "IN CORSO",
    },
    "partial-control": {
      en: "PARTIAL CONTROL",
      el: "ΜΕΡΙΚΟΣ ΕΛΕΓΧΟΣ",
      es: "CONTROL PARCIAL",
      fr: "MAÎTRISE PARTIELLE",
      de: "TEILWEISE UNTER KONTROLLE",
      it: "CONTROLLO PARZIALE",
    },
    "full-control": {
      en: "UNDER CONTROL",
      el: "ΥΠΟ ΕΛΕΓΧΟ",
      es: "BAJO CONTROL",
      fr: "SOUS CONTRÔLE",
      de: "UNTER KONTROLLE",
      it: "SOTTO CONTROLLO",
    },
    ended: {
      en: "ENDED",
      el: "ΛΗΞΗ ΣΥΜΒΑΝΤΟΣ",
      es: "FINALIZADO",
      fr: "TERMINÉ",
      de: "BEENDET",
      it: "CONCLUSO",
    },
  } as const;
  return labels[status][language];
}

function preferredLiveItemId(payload: UpdatesPayload) {
  if (payload.fireServiceIncident) return "fire-service-live-status";
  const latestOfficial = payload.items.find(
    (item) => item.sourceTier === "official",
  );
  const latestLive = latestOfficial ?? payload.items[0];
  return latestLive ? `feed-${latestLive.id}` : null;
}

export default function Home() {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const operationalGroup = useRef<LayerGroup | null>(null);
  const effisGroup = useRef<LayerGroup | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);
  const lastAutoSelectedLive = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState("");
  const [ageEpoch, setAgeEpoch] = useState(() => Date.now());
  const [baseMode, setBaseMode] = useState<BaseMode>("satellite");
  const [language, setLanguage] = useState<Language>("en");
  const [locatorOpen, setLocatorOpen] = useState(false);
  const [locatorQuery, setLocatorQuery] = useState("");
  const [locatorResults, setLocatorResults] = useState<GeocodeResult[]>([]);
  const [locatorBusy, setLocatorBusy] = useState(false);
  const [locatorError, setLocatorError] = useState<
    "search" | "empty" | "geolocation" | null
  >(null);
  const [userPoint, setUserPoint] = useState<{
    lat: number;
    lon: number;
    label: string;
  } | null>(null);
  const [compact, setCompact] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [intelOpen, setIntelOpen] = useState(true);
  const [activeIntel, setActiveIntel] = useState("");
  const [windData, setWindData] = useState<WindPayload | null>(null);
  const [windError, setWindError] = useState(false);
  const [updatesData, setUpdatesData] = useState<UpdatesPayload | null>(null);
  const [updatesError, setUpdatesError] = useState(false);
  const [thermalData, setThermalData] = useState<ThermalPayload | null>(null);
  const [thermalError, setThermalError] = useState(false);
  const [thermalWindow, setThermalWindow] =
    useState<ThermalWindow>("latest");
  const [satelliteEpoch, setSatelliteEpoch] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    official: true,
    satellite: true,
    satelliteRaster: false,
    effis: true,
    inforcyl: true,
    local: true,
    wind: true,
    smokeObserved: false,
    smoke: true,
    simulation: false,
  });
  const [region, setRegion] = useState<FireRegionId>("lesvos");
  const [effisData, setEffisData] = useState<BurntArea[] | null>(null);
  const [effisError, setEffisError] = useState(false);
  const [alertData, setAlertData] = useState<AlertSummary | null>(null);
  const [alertError, setAlertError] = useState(false);
  const [spainIncidents, setSpainIncidents] = useState<SpainIncident[] | null>(
    null,
  );
  const [regionNews, setRegionNews] = useState<NewsItem[] | null>(null);
  const [regionAq, setRegionAq] = useState<NormalizedAirQuality | null>(null);
  const [hour, setHour] = useState(2);
  const [beaufort, setBeaufort] = useState(6);
  const [heading, setHeading] = useState(218);
  const [smokeMinutes, setSmokeMinutes] = useState(15);

  const scenarioDistance = useMemo(
    () => Number(((spreadRates[beaufort] ?? 0) * hour).toFixed(1)),
    [beaufort, hour],
  );
  const staticIntel =
    language === "el"
      ? intelEl
      : intelEn.map((item) => ({
          ...item,
          label: translate(language, item.label),
          detail: translate(language, item.detail),
        }));
  const localizedSources =
    language === "el"
      ? sourcesEl
      : sourcesEn.map((item) => ({
          ...item,
          label: translate(language, item.label),
          kind: translate(language, item.kind),
        }));
  const displayIntel = useMemo<IntelItem[]>(() => {
    const liveItems =
      updatesData?.items.slice(0, 6).map((item) => {
        const timestamp = item.modifiedAt ?? item.publishedAt;
        const localizedSummary =
          language === "el"
            ? item.summaryEl
            : translate(language, item.summaryEn);
        const detailPrefix =
          item.sourceTier === "official"
            ? localize(
                language,
                item.sourceKind === "official-alert"
                  ? "Official alert feed. "
                  : "Official information feed; only 112 alerts are public protective instructions. ",
                item.sourceKind === "official-alert"
                  ? "Επίσημη ροή ειδοποιήσεων. "
                  : "Επίσημη ροή ενημέρωσης· μόνο οι ειδοποιήσεις 112 αποτελούν δημόσιες οδηγίες προστασίας. ",
              )
            : localize(
                language,
                item.timeQuality === "feed-order-only"
                  ? "Publisher feed item; publication time is unavailable, so recency is not verified. "
                  : "Near-real-time local reporting; not independently confirmed. ",
                item.timeQuality === "feed-order-only"
                  ? "Στοιχείο ροής εκδότη· η ώρα δημοσίευσης δεν είναι διαθέσιμη, επομένως η πρόσφατη έκδοση δεν έχει επαληθευτεί. "
                  : "Σχεδόν ζωντανή τοπική ενημέρωση· δεν έχει επιβεβαιωθεί ανεξάρτητα. ",
              );
        return {
          id: `feed-${item.id}`,
          time:
            item.latestUpdateLabel ??
            (timestamp ? formatGreeceTime(timestamp) : "RSS"),
          label: item.title,
          detail: `${detailPrefix}${localizedSummary}`,
          confidence:
            item.sourceTier === "official"
              ? ("official" as const)
              : ("reported" as const),
          sourceUrl: item.url,
          sourceLabel: item.sourceLabel,
          category: item.category,
          severity: item.severity,
          actionRequired: item.actionRequired,
          live: true,
        };
      }) ?? [];

    const fireService = updatesData?.fireServiceIncident
      ? [
          {
            id: "fire-service-live-status",
            time: formatGreeceTime(
              updatesData.fireServiceIncident.fetchedAt,
            ),
            label: `${localize(language, "Fire Service", "Πυροσβεστικό Σώμα")}: ${localizeFireStatus(
              updatesData.fireServiceIncident.status,
              updatesData.fireServiceIncident.statusLabel,
              language,
            )}`,
            detail: `${localize(
              language,
              "The official incident board lists the Plomari landfill fire as",
              "Ο επίσημος πίνακας συμβάντων καταγράφει την πυρκαγιά στον ΧΑΔΑ Πλωμαρίου ως",
            )} ${localizeFireStatus(
              updatesData.fireServiceIncident.status,
              updatesData.fireServiceIncident.statusLabel,
              language,
            ).toLocaleLowerCase(LOCALES[language])}${
              updatesData.fireServiceIncident.sourceAge
                ? pick(language, {
                    en: `; source-reported update age ${updatesData.fireServiceIncident.sourceAge}`,
                    el: `· ηλικία ενημέρωσης πηγής ${updatesData.fireServiceIncident.sourceAge}`,
                    es: `; antigüedad del dato según la fuente ${updatesData.fireServiceIncident.sourceAge}`,
                    fr: `; ancienneté de la mise à jour selon la source ${updatesData.fireServiceIncident.sourceAge}`,
                    de: `; Alter der Quellenmeldung ${updatesData.fireServiceIncident.sourceAge}`,
                    it: `; età dell'aggiornamento secondo la fonte ${updatesData.fireServiceIncident.sourceAge}`,
                  })
                : ""
            }. ${localize(
              language,
              "The board does not provide a perimeter or public route instruction.",
              "Ο πίνακας δεν παρέχει περίμετρο ούτε δημόσια οδηγία διαδρομής.",
            )}`,
            confidence: "official" as const,
            sourceUrl: updatesData.fireServiceIncident.sourceUrl,
            sourceLabel: "Hellenic Fire Service",
            category: "incident" as const,
            severity: "medium" as const,
            actionRequired: false,
            live: true,
          },
        ]
      : [];

    const archivedChronology = staticIntel.map((item) => ({
      ...item,
      archived: true,
    }));

    return [...fireService, ...liveItems, ...archivedChronology];
  }, [language, staticIntel, updatesData]);
  const active =
    displayIntel.find((item) => item.id === activeIntel) ??
    {
      id: "live-wire-pending",
      time: "LIVE",
      label: localize(
        language,
        updatesError
          ? "Live-source retry in progress"
          : updatesData
            ? "No current live item returned"
            : "Checking live sources",
        updatesError
          ? "Νέα προσπάθεια σύνδεσης με ζωντανές πηγές"
          : updatesData
            ? "Δεν επιστράφηκε τρέχουσα ζωντανή ενημέρωση"
            : "Έλεγχος ζωντανών πηγών",
      ),
      detail: localize(
        language,
        "No archived chronology item is selected by default. Dated archive entries remain available in the list while current sources are checked.",
        "Δεν επιλέγεται από προεπιλογή καταχώριση του αρχείου. Οι χρονολογημένες αρχειακές καταχωρίσεις παραμένουν διαθέσιμες στη λίστα όσο ελέγχονται οι τρέχουσες πηγές.",
      ),
      confidence: "reported" as const,
      live: true,
    };
  const fireWind =
    windData?.locations.find((location) => location.id === "fire")?.current ??
    WIND_FALLBACK;
  const downwindHeading = (fireWind.wind10.directionDeg + 180) % 360;
  const smokeDistance = Math.max(
    2,
    Math.min(18, fireWind.wind10.speedKmh * (smokeMinutes / 60)),
  );
  const windObservedTime = formatGreeceTime(fireWind.time);
  const retrievedTime = formatGreeceTime(windData?.generatedAt);
  const incidentThermalDetections = useMemo(
    () =>
      thermalData?.detections.filter(
        (detection) => detection.scope === "incident",
      ) ?? [],
    [thermalData],
  );
  const latestIncidentPass = useMemo(
    () =>
      thermalData?.passes.find((pass) => pass.incidentRecordCount > 0) ?? null,
    [thermalData],
  );
  const thermalDetections = useMemo(() => {
    if (thermalWindow === "latest") {
      if (!latestIncidentPass) return [];
      return incidentThermalDetections.filter(
        (detection) => detection.passId === latestIncidentPass.id,
      );
    }
    if (thermalWindow === "6h") {
      return incidentThermalDetections.filter(
        (detection) =>
          (ageMinutesFromTimestamp(detection.observedAt, ageEpoch) ??
            detection.ageMinutes) <= 360,
      );
    }
    return incidentThermalDetections;
  }, [ageEpoch, incidentThermalDetections, latestIncidentPass, thermalWindow]);
  const visibleThermalPasses = useMemo(
    () => new Set(thermalDetections.map((detection) => detection.passId)).size,
    [thermalDetections],
  );
  const proximity = useMemo(
    () =>
      userPoint
        ? assessProximity(
            userPoint,
            { lat: INCIDENT[0], lon: INCIDENT[1] },
            thermalDetections,
          )
        : null,
    [userPoint, thermalDetections],
  );
  const proximityLevelText = proximity
    ? {
        critical: {
          label: localize(
            language,
            "NEAR ACTIVE FIRE AREA",
            "ΚΟΝΤΑ ΣΕ ΕΝΕΡΓΗ ΠΕΡΙΟΧΗ ΠΥΡΚΑΓΙΑΣ",
          ),
          advice: localize(
            language,
            "Follow the 112 instruction now and move away from the fire area.",
            "Ακολουθήστε τώρα την οδηγία 112 και απομακρυνθείτε από την περιοχή της πυρκαγιάς.",
          ),
        },
        high: {
          label: localize(language, "HIGH PROXIMITY", "ΥΨΗΛΗ ΕΓΓΥΤΗΤΑ"),
          advice: localize(
            language,
            "Prepare to move; keep checking 112 and local authorities.",
            "Προετοιμαστείτε για μετακίνηση· ελέγχετε συνεχώς το 112 και τις τοπικές αρχές.",
          ),
        },
        elevated: {
          label: localize(
            language,
            "ELEVATED · SMOKE RANGE",
            "ΑΥΞΗΜΕΝΗ · ΕΜΒΕΛΕΙΑ ΚΑΠΝΟΥ",
          ),
          advice: localize(
            language,
            "Smoke and rekindling can affect this distance; stay aware.",
            "Ο καπνός και οι αναζωπυρώσεις μπορούν να επηρεάσουν αυτή την απόσταση· παραμείνετε σε επαγρύπνηση.",
          ),
        },
        monitor: {
          label: localize(language, "MONITOR", "ΠΑΡΑΚΟΛΟΥΘΗΣΗ"),
          advice: localize(
            language,
            "Outside the immediate area; keep monitoring official updates.",
            "Εκτός της άμεσης περιοχής· συνεχίστε να παρακολουθείτε τις επίσημες ενημερώσεις.",
          ),
        },
      }[proximity.level]
    : null;
  const thermalUnavailable =
    (!thermalData && thermalError) ||
    thermalData?.status === "unconfigured" ||
    thermalData?.status === "upstream-error";
  const thermalStaleSnapshot =
    thermalError && Boolean(thermalData) && !thermalUnavailable;
  const thermalLoading = !thermalData && !thermalError;
  const thermalLatestTime = formatGreeceDateTime(
    thermalData?.latestIncidentObservedAt,
    language,
  );
  const thermalLatestAge = ageLabel(
    ageMinutesFromTimestamp(
      thermalData?.latestIncidentObservedAt,
      ageEpoch,
    ) ?? thermalData?.observationAgeMinutes,
    language,
  );
  const thermalRetrievedTime = formatGreeceDateTime(
    thermalData?.retrievedAt,
    language,
  );
  const updatesRetrievedTime = formatGreeceTime(updatesData?.retrievedAt);
  const sourceHealth = updatesData?.sourceSummary;
  const thermalLayerDetail = thermalLoading
    ? localize(language, "Loading FIRMS point feed", "Φόρτωση σημειακής ροής FIRMS")
    : thermalUnavailable
      ? localize(
          language,
          "FIRMS point feed unavailable",
          "Η σημειακή ροή FIRMS δεν είναι διαθέσιμη",
        )
      : thermalStaleSnapshot
        ? pick(language, {
            en: `Last response · refresh failed · ${thermalLatestAge}`,
            el: `Τελευταία απόκριση · αποτυχία ανανέωσης · ${thermalLatestAge}`,
            es: `Última respuesta · fallo de actualización · ${thermalLatestAge}`,
            fr: `Dernière réponse · échec d'actualisation · ${thermalLatestAge}`,
            de: `Letzte Antwort · Aktualisierung fehlgeschlagen · ${thermalLatestAge}`,
            it: `Ultima risposta · aggiornamento non riuscito · ${thermalLatestAge}`,
          })
      : thermalData?.status === "partial"
        ? pick(language, {
            en: `Partial FIRMS response · ${thermalLatestAge}`,
            el: `Μερική απόκριση FIRMS · ${thermalLatestAge}`,
            es: `Respuesta parcial de FIRMS · ${thermalLatestAge}`,
            fr: `Réponse partielle FIRMS · ${thermalLatestAge}`,
            de: `Teilweise FIRMS-Antwort · ${thermalLatestAge}`,
            it: `Risposta parziale FIRMS · ${thermalLatestAge}`,
          })
        : pick(language, {
            en: `NASA FIRMS · ${thermalLatestAge}`,
            el: `NASA FIRMS · ${thermalLatestAge}`,
            es: `NASA FIRMS · ${thermalLatestAge}`,
            fr: `NASA FIRMS · ${thermalLatestAge}`,
            de: `NASA FIRMS · ${thermalLatestAge}`,
            it: `NASA FIRMS · ${thermalLatestAge}`,
          });
  const thermalWindowName = {
    latest: localize(
      language,
      "latest detecting pass",
      "νεότερη διέλευση με ανιχνεύσεις",
    ),
    "6h": localize(language, "last 6 hours", "τελευταίες 6 ώρες"),
    "24h": localize(language, "last 24 hours", "τελευταίες 24 ώρες"),
  }[thermalWindow];
  const officialVerifiedTime = formatGreeceTime(
    updatesData?.officialAlert.lastManuallyVerifiedAt,
  );
  const officialStatus = localizeFireStatus(
    updatesData?.fireServiceIncident?.status ?? null,
    updatesData?.fireServiceIncident?.statusLabel,
    language,
  );

  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    document.documentElement.lang = nextLanguage;
    window.localStorage.setItem("firewatch-language", nextLanguage);
  };

  const closePanels = () => {
    setPanelOpen(false);
    setIntelOpen(false);
    setLocatorOpen(false);
  };

  useEffect(() => {
    const format = () =>
      setClock(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Athens",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date()),
      );
    format();
    const timer = window.setInterval(format, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshAge = () => setAgeEpoch(Date.now());
    const timer = window.setInterval(refreshAge, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem("firewatch-language");
      const browser = navigator.language.toLowerCase().slice(0, 2);
      const nextLanguage = isLanguage(stored)
        ? stored
        : isLanguage(browser)
          ? browser
          : "en";
      setLanguage(nextLanguage);
      document.documentElement.lang = nextLanguage;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      setCompact(query.matches);
      if (query.matches) {
        setPanelOpen(false);
        setIntelOpen(false);
      }
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshWind = async () => {
      try {
        const response = await fetch("/api/wind", { cache: "no-store" });
        if (!response.ok) throw new Error("wind request failed");
        const payload = (await response.json()) as WindPayload;
        if (!cancelled) {
          setWindData(payload);
          setWindError(false);
        }
      } catch {
        if (!cancelled) setWindError(true);
      }
    };
    const initial = window.setTimeout(() => void refreshWind(), 0);
    const timer = window.setInterval(() => void refreshWind(), 300_000);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshUpdates = async () => {
      try {
        const response = await fetch("/api/updates", { cache: "no-store" });
        if (!response.ok) throw new Error("updates request failed");
        const payload = (await response.json()) as UpdatesPayload;
        if (!cancelled) {
          setUpdatesData(payload);
          setUpdatesError(false);
          const preferred = preferredLiveItemId(payload);
          if (
            preferred &&
            lastAutoSelectedLive.current !== preferred
          ) {
            lastAutoSelectedLive.current = preferred;
            setActiveIntel(preferred);
          }
        }
      } catch {
        if (!cancelled) setUpdatesError(true);
      }
    };
    const initial = window.setTimeout(() => void refreshUpdates(), 0);
    const timer = window.setInterval(() => void refreshUpdates(), 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshThermal = async () => {
      try {
        const response = await fetch("/api/thermal", { cache: "no-store" });
        if (!response.ok) throw new Error("thermal request failed");
        const payload = (await response.json()) as ThermalPayload;
        if (!cancelled) {
          setThermalData(payload);
          setThermalError(false);
          setSatelliteEpoch(Date.now());
        }
      } catch {
        if (!cancelled) {
          setThermalError(true);
          setSatelliteEpoch(Date.now());
        }
      }
    };
    const initial = window.setTimeout(() => void refreshThermal(), 0);
    const timer = window.setInterval(() => void refreshThermal(), 300_000);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function createMap() {
      if (!mapElement.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapElement.current) return;
      leafletRef.current = L;
      const map = L.map(mapElement.current, {
        zoomControl: false,
        attributionControl: true,
        minZoom: 10,
        maxZoom: 19,
      }).setView([38.988, 26.383], 13);
      mapRef.current = map;
      L.control.zoom({ position: "bottomright" }).addTo(map);
      operationalGroup.current = L.layerGroup().addTo(map);
      effisGroup.current = L.layerGroup().addTo(map);
      map.on("click", (event) => {
        const coordinate = `${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`;
        L.popup()
          .setLatLng(event.latlng)
          .setContent(
            `<div class="popup-copy"><strong>MAP INSPECT / ΕΠΙΘΕΩΡΗΣΗ ΧΑΡΤΗ</strong><br>${coordinate}<br><span>Coordinate only · not an incident observation / Μόνο συντεταγμένες · όχι παρατήρηση συμβάντος</span></div>`,
          )
          .openOn(map);
      });
      setReady(true);
    }
    createMap();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    if (baseLayerRef.current) {
      mapRef.current.removeLayer(baseLayerRef.current);
    }
    const config = BASEMAPS[baseMode];
    baseLayerRef.current = L.tileLayer(config.url, {
      maxZoom: config.maxZoom,
      attribution: config.attribution,
      subdomains: baseMode === "dark" || baseMode === "terrain" ? "abc" : "",
    });
    baseLayerRef.current.addTo(mapRef.current);
    baseLayerRef.current.bringToBack();
  }, [baseMode, ready]);

  useEffect(() => {
    if (
      !ready ||
      !mapRef.current ||
      !leafletRef.current ||
      !operationalGroup.current
    ) {
      return;
    }
    const L = leafletRef.current;
    const group = operationalGroup.current;
    group.clearLayers();

    const settlements: Array<[string, LatLngTuple]> = [
      [localize(language, "MELINTA", "ΜΕΛΙΝΤΑ"), MELINTA],
      [
        localize(language, "PLOMARI BEACH", "ΠΑΡΑΛΙΑ ΠΛΩΜΑΡΙΟΥ"),
        PLOMARI_BEACH,
      ],
      [localize(language, "MILIES", "ΜΗΛΙΕΣ"), MILIES],
      [localize(language, "PLAGIA", "ΠΛΑΓΙΑ"), PLAGIA],
      [
        localize(language, "AGIOS ISIDOROS", "ΑΓΙΟΣ ΙΣΙΔΩΡΟΣ"),
        AGIOS_ISIDOROS,
      ],
      [
        localize(language, "AGIOS ANTONIOS", "ΑΓΙΟΣ ΑΝΤΩΝΙΟΣ"),
        AGIOS_ANTONIOS,
      ],
      [localize(language, "MEGALOCHORI", "ΜΕΓΑΛΟΧΩΡΙ"), MEGALOCHORI],
      [localize(language, "PERAMA", "ΠΕΡΑΜΑ"), PERAMA],
    ];
    settlements.forEach(([name, point]) => {
      L.marker(point, {
        interactive: false,
        icon: L.divIcon({
          className: "marker-shell",
          html: markerHtml("settlement", name),
          iconSize: [150, 26],
          iconAnchor: [8, 13],
        }),
      }).addTo(group);
    });

    if (userPoint) {
      L.marker([userPoint.lat, userPoint.lon], {
        interactive: false,
        icon: L.divIcon({
          className: "marker-shell",
          html: markerHtml(
            "user",
            localize(language, "YOUR LOCATION", "Η ΘΕΣΗ ΣΑΣ"),
          ),
          iconSize: [150, 26],
          iconAnchor: [8, 13],
        }),
      }).addTo(group);
    }

    if (layers.official) {
      L.polygon(LANDFILL_FOOTPRINT, {
        color: "#f59e0b",
        weight: 1.5,
        fillColor: "#f59e0b",
        fillOpacity: 0.1,
        dashArray: "6 5",
      })
        .bindTooltip(
          localize(
            language,
            "Restored Chalkelia landfill footprint · not the fire perimeter",
            "Όρια αποκατεστημένου ΧΑΔΑ Χαλκελίων · δεν είναι περίμετρος πυρκαγιάς",
          ),
          { sticky: true },
        )
        .addTo(group);

      L.circle(INCIDENT, {
        radius: 340,
        color: "#ff4d32",
        weight: 2,
        fillColor: "#ff4d32",
        fillOpacity: 0.08,
        dashArray: "8 7",
      })
        .bindPopup(
          `<div class="popup-copy"><strong>${localize(
            language,
            "REPORTED INCIDENT AREA",
            "ΑΝΑΦΕΡΘΕΙΣΑ ΠΕΡΙΟΧΗ ΣΥΜΒΑΝΤΟΣ",
          )}</strong><br>${localize(
            language,
            "Restored Chalkelia landfill.",
            "Αποκατεστημένος ΧΑΔΑ Χαλκελίων.",
          )}<br><span>${localize(
            language,
            "Site location only · perimeter not published.",
            "Μόνο η θέση του σημείου · δεν έχει δημοσιευθεί περίμετρος.",
          )}</span></div>`,
        )
        .addTo(group);
      L.marker(INCIDENT, {
        icon: L.divIcon({
          className: "marker-shell",
          html: markerHtml(
            "fire",
            localize(language, "INCIDENT", "ΣΥΜΒΑΝ"),
          ),
          iconSize: [120, 34],
          iconAnchor: [14, 17],
        }),
      }).addTo(group);

      L.polyline([PLOMARI_BEACH, AGIOS_ISIDOROS], {
        color: "#55ddff",
        weight: 8,
        opacity: 0.18,
        lineCap: "round",
      }).addTo(group);
      L.polyline([PLOMARI_BEACH, AGIOS_ISIDOROS], {
        color: "#55ddff",
        weight: 3,
        opacity: 0.95,
        dashArray: "10 8",
      })
        .bindTooltip(
          localize(
            language,
            "16:58 official 112 direction: Plomari beach → Agios Isidoros · historical alert, verify any newer instruction",
            "Επίσημη κατεύθυνση 112 στις 16:58: παραλία Πλωμαρίου → Άγιος Ισίδωρος · ιστορική ειδοποίηση, ελέγξτε κάθε νεότερη οδηγία",
          ),
          { sticky: true },
        )
        .addTo(group);
      L.marker(midpoint(PLOMARI_BEACH, AGIOS_ISIDOROS), {
        interactive: false,
        icon: L.divIcon({
          className: "marker-shell route-arrow-shell",
          html: markerHtml(
            "arrow",
            localize(language, "112 · 16:58 →", "112 · 16:58 →"),
          ),
          iconSize: [130, 30],
          iconAnchor: [18, 15],
        }),
      }).addTo(group);
    }

    if (layers.satelliteRaster) {
      const thermalDate = utcDate(satelliteEpoch);
      [
        "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
        "VIIRS_NOAA21_Thermal_Anomalies_375m_All",
        "VIIRS_SNPP_Thermal_Anomalies_375m_All",
      ].forEach((layerName) => {
        L.tileLayer
          .wms(
            "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
            {
              layers: layerName,
              format: "image/png",
              transparent: true,
              styles: "size15",
              version: "1.1.1",
              opacity: 0.74,
              attribution: "NASA GIBS / FIRMS",
              time: thermalDate,
              refresh: String(Math.floor(satelliteEpoch / 300_000)),
            } as WMSOptions,
          )
          .addTo(group);
      });
    }

    if (layers.satellite) {
      thermalDetections.forEach((detection) => {
        const style = {
          h: {
            color: "#ff3b24",
            fillColor: "#ff3b24",
            dashArray: undefined,
            radius: 7,
          },
          n: {
            color: "#ff9f1c",
            fillColor: "#ffb23f",
            dashArray: undefined,
            radius: 6,
          },
          l: {
            color: "#ffe16a",
            fillColor: "#ffe16a",
            dashArray: "4 5",
            radius: 5,
          },
          u: {
            color: "#9aa7b5",
            fillColor: "#9aa7b5",
            dashArray: "2 5",
            radius: 5,
          },
        }[detection.confidenceCode];
        const footprint =
          detection.scanKm !== null && detection.trackKm !== null
            ? `${detection.scanKm.toFixed(2)} × ${detection.trackKm.toFixed(2)} km`
            : localize(
                language,
                "nominal 375 m pixel",
                "ονομαστικό εικονοστοιχείο 375 m",
              );
        const footprintRadius =
          Math.max(detection.scanKm ?? 0.375, detection.trackKm ?? 0.375) *
          500;
        L.circle([detection.lat, detection.lon], {
          radius: footprintRadius,
          color: style.color,
          weight: 1,
          fillColor: style.fillColor,
          fillOpacity: 0.07,
          opacity: 0.44,
          dashArray: style.dashArray ?? "3 7",
          interactive: false,
        }).addTo(group);
        L.circleMarker([detection.lat, detection.lon], {
          radius: style.radius,
          color: style.color,
          weight: detection.confidenceCode === "h" ? 2.2 : 1.6,
          fillColor: style.fillColor,
          fillOpacity: detection.confidenceCode === "l" ? 0.48 : 0.74,
          dashArray: style.dashArray,
        })
          .bindPopup(
            `<div class="popup-copy"><strong>${localize(
              language,
              "SATELLITE THERMAL DETECTION",
              "ΔΟΡΥΦΟΡΙΚΗ ΘΕΡΜΙΚΗ ΑΝΙΧΝΕΥΣΗ",
            )}</strong><br>${detection.sensor} · ${formatGreeceDateTime(detection.observedAt, language)} ${localize(
              language,
              "Greece time",
              "ώρα Ελλάδας",
            )} · ${ageLabel(
              ageMinutesFromTimestamp(detection.observedAt, ageEpoch) ??
                detection.ageMinutes,
              language,
            )}<br>${localize(
              language,
              "Detection confidence",
              "Αξιοπιστία ανίχνευσης",
            )}: ${thermalConfidenceLabel(detection.confidenceCode, language)}<br>FRP ${detection.frpMw?.toFixed(2) ?? "—"} MW · ${detection.distanceFromIncidentKm.toFixed(1)} km ${compass(detection.bearingFromIncidentDeg, language)} ${localize(
              language,
              "of incident reference",
              "από το σημείο αναφοράς συμβάντος",
            )}<br><span>${footprint} · ${localize(
              language,
              "Marker is the pixel center. The halo approximates pixel dimensions, not a fire perimeter. FRP is pixel-integrated radiative power—not flame height or total fire intensity.",
              "Ο δείκτης είναι το κέντρο του εικονοστοιχείου. Η ζώνη προσεγγίζει τις διαστάσεις του εικονοστοιχείου, όχι περίμετρο πυρκαγιάς. Το FRP είναι η ακτινοβολούμενη ισχύς του εικονοστοιχείου—όχι ύψος φλόγας ούτε συνολική ένταση.",
            )}</span></div>`,
          )
          .addTo(group);
      });
    }

    if (layers.local) {
      [AGIOS_ANTONIOS, midpoint(AGIOS_ANTONIOS, MEGALOCHORI)].forEach(
        (point, index) => {
          L.circle(point, {
            radius: index === 0 ? 420 : 650,
            color: "#ffb347",
            weight: 2,
            fillColor: "#ff6a32",
            fillOpacity: 0.08,
            dashArray: "5 8",
          })
            .bindPopup(
              `<div class="popup-copy"><strong>${localize(
                language,
                "FIELD-REPORTED AREA (APPROXIMATE)",
                "ΠΕΡΙΟΧΗ ΑΝΑΦΟΡΑΣ ΑΠΟ ΤΟ ΠΕΔΙΟ (ΚΑΤΑ ΠΡΟΣΕΓΓΙΣΗ)",
              )}</strong><br>${localize(
                language,
                index === 0
                  ? "One local report referenced scattered activity near Agios Antonios at 20:50."
                  : "The same report described activity in the direction of Megalochori; this second area is a broad reference zone.",
                index === 0
                  ? "Μία τοπική αναφορά περιέγραψε διάσπαρτη δραστηριότητα κοντά στον Άγιο Αντώνιο στις 20:50."
                  : "Η ίδια αναφορά περιέγραψε δραστηριότητα προς το Μεγαλοχώρι· αυτή η δεύτερη περιοχή είναι ευρεία ζώνη αναφοράς.",
              )}<br><span>${localize(
                language,
                "Approximate only · not an official perimeter or live flame location.",
                "Μόνο κατά προσέγγιση · δεν αποτελεί επίσημη περίμετρο ούτε επιβεβαιωμένη θέση ενεργής φλόγας.",
              )}</span></div>`,
            )
            .addTo(group);
        },
      );
      L.marker(AGIOS_ANTONIOS, {
        interactive: false,
        icon: L.divIcon({
          className: "marker-shell",
          html: markerHtml(
            "arrow",
            localize(
              language,
              "FIELD REPORT · 20:50",
              "ΑΝΑΦΟΡΑ ΠΕΔΙΟΥ · 20:50",
            ),
          ),
          iconSize: [170, 30],
          iconAnchor: [16, 15],
        }),
      }).addTo(group);
    }

    if (layers.wind) {
      const windVectors = [
        { label: "10 m", vector: fireWind.wind10, length: 2, opacity: 1 },
        { label: "80 m", vector: fireWind.wind80, length: 2.4, opacity: 0.72 },
        { label: "120 m", vector: fireWind.wind120, length: 2.8, opacity: 0.55 },
        { label: "180 m", vector: fireWind.wind180, length: 3.2, opacity: 0.38 },
      ];
      windVectors.forEach(({ label, vector, length, opacity }) => {
        const toward = (vector.directionDeg + 180) % 360;
        const windStart = destination(INCIDENT, vector.directionDeg, 0.85);
        const windEnd = destination(INCIDENT, toward, length);
        L.polyline([windStart, INCIDENT, windEnd], {
          color: "#55ddff",
          weight: label === "10 m" ? 3 : 2,
          opacity,
          dashArray: label === "10 m" ? "5 7" : "3 9",
        })
          .bindTooltip(
            pick(language, {
              en: `${label} Open-Meteo point model: from ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) toward ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · valid ${windObservedTime} Greece`,
              el: `${label} σημειακό μοντέλο Open-Meteo: από ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) προς ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · ισχύει για ${windObservedTime} ώρα Ελλάδας`,
              es: `${label} modelo puntual Open-Meteo: desde ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) hacia ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · válido ${windObservedTime} hora de Grecia`,
              fr: `${label} modèle ponctuel Open-Meteo : depuis ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) vers ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · valable ${windObservedTime} heure de Grèce`,
              de: `${label} Open-Meteo-Punktmodell: aus ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) nach ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · gültig ${windObservedTime} griechische Zeit`,
              it: `${label} modello puntuale Open-Meteo: da ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) verso ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · valido ${windObservedTime} ora della Grecia`,
            }),
            { sticky: true },
          )
          .addTo(group);
      });
      const windEnd = destination(INCIDENT, downwindHeading, 2);
      L.marker(windEnd, {
        interactive: false,
        icon: L.divIcon({
          className: "marker-shell",
          html: markerHtml(
            "wind",
            `10 m → ${compass(downwindHeading, language)} · ${fireWind.wind10.speedKmh.toFixed(0)} km/h`,
          ),
          iconSize: [190, 30],
          iconAnchor: [15, 15],
        }),
      }).addTo(group);

      if (windData?.metar) {
        const metar = windData.metar;
        L.marker([39.054, 26.604], {
          icon: L.divIcon({
            className: "marker-shell",
            html: markerHtml(
              "wind",
              `LGMT ${metar.speedKt}G${metar.gustKt ?? "—"} kt`,
            ),
            iconSize: [170, 30],
            iconAnchor: [15, 15],
          }),
        })
          .bindPopup(
            `<div class="popup-copy"><strong>${localize(
              language,
              "LGMT MEASURED WIND",
              "ΜΕΤΡΗΜΕΝΟΣ ΑΝΕΜΟΣ LGMT",
            )}</strong><br>${Math.round(metar.directionDeg)}° · ${metar.speedKt} kt · ${localize(
              language,
              "gust",
              "ριπή",
            )} ${metar.gustKt ?? "—"} kt<br><span>${pick(language, {
              en: `Observed ${formatGreeceTime(metar.observedAt)} Greece at Mytilene airport; conditions at the fire can differ.`,
              el: `Παρατήρηση ${formatGreeceTime(metar.observedAt)} ώρα Ελλάδας στο αεροδρόμιο Μυτιλήνης· οι συνθήκες στην πυρκαγιά μπορεί να διαφέρουν.`,
              es: `Observado a las ${formatGreeceTime(metar.observedAt)} hora de Grecia en el aeropuerto de Mitilene; las condiciones en el incendio pueden diferir.`,
              fr: `Observé à ${formatGreeceTime(metar.observedAt)} heure de Grèce à l'aéroport de Mytilène ; les conditions sur l'incendie peuvent différer.`,
              de: `Beobachtet ${formatGreeceTime(metar.observedAt)} griechische Zeit am Flughafen Mytilini; die Bedingungen am Brand können abweichen.`,
              it: `Osservato alle ${formatGreeceTime(metar.observedAt)} ora della Grecia all'aeroporto di Mitilene; le condizioni sull'incendio possono differire.`,
            })}<br>${metar.raw}</span></div>`,
          )
          .addTo(group);
      }
    }

    if (layers.smokeObserved) {
      L.tileLayer
        .wms(
          "https://gibs.earthdata.nasa.gov/wms/epsg3857/nrt/wms.cgi",
          {
            layers:
              "VIIRS_NOAA20_Aerosol_Type_Deep_Blue_Land_Ocean_v2.1_NRT",
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            opacity: 0.46,
            attribution: "NASA GIBS VIIRS aerosol type",
            time: utcDate(satelliteEpoch),
            refresh: String(Math.floor(satelliteEpoch / 300_000)),
          } as WMSOptions,
        )
        .bindTooltip(
          localize(
            language,
            "NASA VIIRS daylight aerosol classification · smoke retrieval is coarse, cloud-sensitive and not surface PM2.5",
            "Ημερήσια ταξινόμηση αερολυμάτων NASA VIIRS · η ανίχνευση καπνού είναι χαμηλής ανάλυσης, επηρεάζεται από νέφη και δεν αποτελεί επιφανειακή μέτρηση PM2.5",
          ),
          { sticky: true },
        )
        .addTo(group);
    }

    if (layers.smoke) {
      const outer = scenarioShape(
        INCIDENT,
        downwindHeading,
        smokeDistance,
        34,
      );
      const core = scenarioShape(
        INCIDENT,
        downwindHeading,
        smokeDistance * 0.68,
        17,
      );
      L.polygon(outer, {
        color: "#b9a4ff",
        weight: 2,
        fillColor: "#b9a4ff",
        fillOpacity: 0.08,
        dashArray: "7 8",
      })
        .bindTooltip(
          pick(language, {
            en: `Modeled smoke-transport proxy · ${smokeMinutes} min · ${smokeDistance.toFixed(1)} km at 10 m model wind · not measured PM2.5 or fire spread`,
            el: `Ενδεικτικό μοντέλο μεταφοράς καπνού · ${smokeMinutes} λεπτά · ${smokeDistance.toFixed(1)} km με μοντέλο ανέμου στα 10 m · όχι μέτρηση PM2.5 ούτε πρόγνωση εξάπλωσης πυρκαγιάς`,
            es: `Modelo indicativo de transporte de humo · ${smokeMinutes} min · ${smokeDistance.toFixed(1)} km con viento del modelo a 10 m · no es PM2.5 medido ni propagación del fuego`,
            fr: `Modèle indicatif de transport de fumée · ${smokeMinutes} min · ${smokeDistance.toFixed(1)} km au vent modélisé à 10 m · ni PM2,5 mesurées ni propagation du feu`,
            de: `Indikatives Rauchtransportmodell · ${smokeMinutes} Min. · ${smokeDistance.toFixed(1)} km bei 10-m-Modellwind · kein gemessenes PM2,5 und keine Feuerausbreitung`,
            it: `Modello indicativo di trasporto del fumo · ${smokeMinutes} min · ${smokeDistance.toFixed(1)} km con vento del modello a 10 m · non è PM2,5 misurato né propagazione del fuoco`,
          }),
          { sticky: true },
        )
        .addTo(group);
      L.polygon(core, {
        color: "#d4c7ff",
        weight: 1.5,
        fillColor: "#b9a4ff",
        fillOpacity: 0.13,
        dashArray: "4 7",
      })
        .bindTooltip(
          localize(
            language,
            "Higher-confidence centerline of an illustrative wind-driven envelope · terrain and fire behavior are not modeled",
            "Κεντρικός άξονας υψηλότερης αξιοπιστίας μιας ενδεικτικής ανεμογενούς ζώνης · το ανάγλυφο και η συμπεριφορά της φωτιάς δεν μοντελοποιούνται",
          ),
          { sticky: true },
        )
        .addTo(group);
    }

    if (layers.simulation && hour > 0) {
      const polygon = scenarioShape(INCIDENT, heading, scenarioDistance);
      L.polygon(polygon, {
        color: "#ffcf4a",
        weight: 2,
        fillColor: "#ff6a32",
        fillOpacity: 0.15,
        dashArray: "5 7",
      })
        .bindTooltip(
          pick(language, {
            en: `WHAT-IF ONLY · +${hour}h · ${beaufort} Bft · not a forecast`,
            el: `ΜΟΝΟ ΥΠΟΘΕΤΙΚΟ ΣΕΝΑΡΙΟ · +${hour}ω · ${beaufort} Bft · όχι πρόγνωση`,
            es: `SOLO HIPOTÉTICO · +${hour}h · ${beaufort} Bft · no es un pronóstico`,
            fr: `HYPOTHÈSE UNIQUEMENT · +${hour}h · ${beaufort} Bft · pas une prévision`,
            de: `NUR HYPOTHETISCH · +${hour}h · ${beaufort} Bft · keine Vorhersage`,
            it: `SOLO IPOTETICO · +${hour}h · ${beaufort} Bft · non è una previsione`,
          }),
          { sticky: true },
        )
        .addTo(group);
    }

  }, [
    ready,
    layers,
    hour,
    heading,
    beaufort,
    scenarioDistance,
    fireWind,
    windData,
    windObservedTime,
    downwindHeading,
    smokeDistance,
    smokeMinutes,
    satelliteEpoch,
    thermalDetections,
    ageEpoch,
    language,
    userPoint,
  ]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/effis?region=${region}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ burntAreas: BurntArea[] }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setEffisData(payload.burntAreas ?? []);
          setEffisError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEffisData(null);
          setEffisError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [region]);

  useEffect(() => {
    let cancelled = false;
    const country = FIRE_REGIONS.find(
      (candidate) => candidate.id === region,
    )?.country;
    if (!country) return;
    fetch(`/api/alerts?country=${country}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ summary: AlertSummary }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setAlertData(payload.summary ?? null);
          setAlertError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlertData(null);
          setAlertError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [region]);

  useEffect(() => {
    let cancelled = false;
    if (region !== "spain") {
      return;
    }
    fetch("/api/spain-incidents")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ incidents: SpainIncident[] }>;
      })
      .then((payload) => {
        if (!cancelled) setSpainIncidents(payload.incidents ?? []);
      })
      .catch(() => {
        if (!cancelled) setSpainIncidents(null);
      });
    return () => {
      cancelled = true;
    };
  }, [region]);

  useEffect(() => {
    let cancelled = false;
    const country = FIRE_REGIONS.find(
      (candidate) => candidate.id === region,
    )?.country;
    if (region === "lesvos" || !country || country === "gr") {
      return;
    }
    fetch(`/api/regionnews?country=${country}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ items: NewsItem[] }>;
      })
      .then((payload) => {
        if (!cancelled) setRegionNews(payload.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setRegionNews(null);
      });
    return () => {
      cancelled = true;
    };
  }, [region]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/airquality?region=${region}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{
          reading: NormalizedAirQuality | null;
        }>;
      })
      .then((payload) => {
        if (!cancelled) setRegionAq(payload.reading ?? null);
      })
      .catch(() => {
        if (!cancelled) setRegionAq(null);
      });
    return () => {
      cancelled = true;
    };
  }, [region]);

  useEffect(() => {
    if (!ready || !leafletRef.current || !effisGroup.current) return;
    const L = leafletRef.current;
    const group = effisGroup.current;
    group.clearLayers();
    if (layers.inforcyl && region === "spain" && spainIncidents) {
      const statusColor = (status: string | null) =>
        status === "ACTIVO"
          ? "#ff3b24"
          : status === "CONTROLADO"
            ? "#ff8a3c"
            : "#7fa3ad";
      spainIncidents.forEach((incident) => {
        const label = [
          `${incident.municipality ?? "—"}${incident.province ? ` (${incident.province})` : ""}`,
          incident.status,
          incident.level !== null ? `${localize(language, "level", "επίπεδο")} ${incident.level}` : null,
          incident.aerialUnits ? `${incident.aerialUnits} ${localize(language, "aerial units", "εναέρια μέσα")}` : null,
          incident.startDate,
        ]
          .filter((value): value is string => value !== null)
          .join(" · ");
        L.circleMarker([incident.lat, incident.lon], {
          radius: incident.status === "ACTIVO" ? 7 : 5,
          color: statusColor(incident.status),
          fillColor: statusColor(incident.status),
          fillOpacity: 0.55,
          weight: 1.5,
        })
          .bindTooltip(
            `<div class="popup-copy"><strong>${incident.source}</strong><br>${label}<br><span>${localize(
              language,
              "Official regional fire-service record",
              "Επίσημη καταγραφή περιφερειακής πυροσβεστικής υπηρεσίας",
            )}</span></div>`,
            { sticky: true },
          )
          .addTo(group);
      });
    }
    if (!layers.effis || !effisData) return;
    effisData.forEach((area) => {
      const place = [area.commune, area.province]
        .filter((value): value is string => value !== null)
        .join(", ");
      const label = [
        place || area.country || "—",
        area.areaHa !== null ? `${area.areaHa} ha` : null,
        area.fireDate,
      ]
        .filter((value): value is string => value !== null)
        .join(" · ");
      area.rings.forEach((ring) => {
        L.polygon(ring, {
          color: "#ff8a3c",
          weight: 1.4,
          fillColor: "#ff8a3c",
          fillOpacity: 0.16,
        })
          .bindTooltip(
            `<div class="popup-copy"><strong>${localize(
              language,
              "EFFIS burnt area",
              "Καμένη έκταση EFFIS",
            )}</strong><br>${label}<br><span>${localize(
              language,
              "approximate satellite mapping",
              "κατά προσέγγιση δορυφορική αποτύπωση",
            )}</span></div>`,
            { sticky: true },
          )
          .addTo(group);
      });
    });
  }, [
    ready,
    layers.effis,
    layers.inforcyl,
    effisData,
    spainIncidents,
    region,
    language,
  ]);

  const toggleLayer = (key: LayerKey) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
    if (key === "simulation" && compact && !layers.simulation) {
      closePanels();
    }
  };

  const focusPoint = (point: LatLngTuple, zoom = 15) => {
    mapRef.current?.flyTo(point, zoom, { duration: 0.65 });
  };

  const activeRegionConfig = FIRE_REGIONS.find(
    (candidate) => candidate.id === region,
  );

  const formatRegionTime = (value: string | null) => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat(LOCALES[language], {
      timeZone: activeRegionConfig?.timeZone ?? "Europe/Athens",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(parsed);
  };

  const changeRegion = (next: FireRegionId) => {
    setRegion(next);
    const target = FIRE_REGIONS.find((candidate) => candidate.id === next);
    if (target) focusPoint(target.center, target.zoom);
  };

  const chooseLocatorResult = (result: GeocodeResult) => {
    setUserPoint({ lat: result.lat, lon: result.lon, label: result.label });
    setLocatorResults([]);
    setLocatorError(null);
    focusPoint([result.lat, result.lon], 13);
  };

  const runLocatorSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = locatorQuery.trim();
    if (query.length < 2 || locatorBusy) return;
    setLocatorBusy(true);
    setLocatorError(null);
    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(query)}&lang=${language}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { results: GeocodeResult[] };
      if (payload.results.length === 0) {
        setLocatorResults([]);
        setLocatorError("empty");
      } else {
        setLocatorResults(payload.results);
      }
    } catch {
      setLocatorError("search");
    } finally {
      setLocatorBusy(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocatorError("geolocation");
      return;
    }
    setLocatorBusy(true);
    setLocatorError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocatorBusy(false);
        chooseLocatorResult({
          label: localize(language, "YOUR LOCATION", "Η ΘΕΣΗ ΣΑΣ"),
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      () => {
        setLocatorBusy(false);
        setLocatorError("geolocation");
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const clearLocator = () => {
    setUserPoint(null);
    setLocatorResults([]);
    setLocatorError(null);
  };

  const showOperationalView = () => {
    mapRef.current?.fitBounds(
      [MELINTA, MEGALOCHORI, MILIES, PLOMARI_BEACH, AGIOS_ISIDOROS],
      {
        padding: [42, 42],
        animate: true,
        duration: 0.65,
      },
    );
  };

  const locatorBody = (
    <>
        <form className="locator-search" onSubmit={runLocatorSearch}>
          <input
            type="search"
            value={locatorQuery}
            onChange={(event) => setLocatorQuery(event.target.value)}
            placeholder={localize(
              language,
              "Search address or place",
              "Αναζήτηση διεύθυνσης ή τοποθεσίας",
            )}
            aria-label={localize(
              language,
              "Search address or place",
              "Αναζήτηση διεύθυνσης ή τοποθεσίας",
            )}
          />
          <button type="submit" disabled={locatorBusy}>
            {localize(language, "SEARCH", "ΑΝΑΖΗΤΗΣΗ")}
          </button>
          <button type="button" onClick={useMyLocation} disabled={locatorBusy}>
            {locatorBusy
              ? localize(language, "Locating…", "Εντοπισμός…")
              : localize(language, "MY LOCATION", "Η ΘΕΣΗ ΜΟΥ")}
          </button>
          {userPoint && (
            <button type="button" onClick={clearLocator}>
              {localize(language, "CLEAR", "ΚΑΘΑΡΙΣΜΟΣ")}
            </button>
          )}
        </form>
        {locatorError && (
          <p className="locator-error" role="alert">
            {locatorError === "empty"
              ? localize(
                  language,
                  "No results — try a more specific place name.",
                  "Κανένα αποτέλεσμα — δοκιμάστε πιο συγκεκριμένο όνομα τοποθεσίας.",
                )
              : locatorError === "geolocation"
                ? localize(
                    language,
                    "Location unavailable — allow location access or search instead.",
                    "Η τοποθεσία δεν είναι διαθέσιμη — επιτρέψτε την πρόσβαση τοποθεσίας ή χρησιμοποιήστε την αναζήτηση.",
                  )
                : localize(
                    language,
                    "Search failed — try again.",
                    "Η αναζήτηση απέτυχε — δοκιμάστε ξανά.",
                  )}
          </p>
        )}
        {locatorResults.length > 0 && (
          <ul className="locator-results">
            {locatorResults.map((result) => (
              <li key={`${result.lat},${result.lon}`}>
                <button
                  type="button"
                  onClick={() => chooseLocatorResult(result)}
                >
                  {result.label}
                </button>
              </li>
            ))}
            <li className="locator-credit">
              {localize(
                language,
                "Search data © OpenStreetMap",
                "Δεδομένα αναζήτησης © OpenStreetMap",
              )}
            </li>
          </ul>
        )}
        {userPoint && proximity && proximityLevelText && (
          <div className={`locator-card locator-card--${proximity.level}`}>
            <strong className="locator-level">
              {proximityLevelText.label}
            </strong>
            <p className="locator-place">{userPoint.label}</p>
            <p>
              <strong>
                {proximity.distanceToIncidentKm.toFixed(1)} km{" "}
                {compass(proximity.bearingToIncidentDeg, language)}
              </strong>{" "}
              {localize(
                language,
                "to incident center",
                "από το κέντρο του συμβάντος",
              )}
            </p>
            <p>
              {localize(
                language,
                "nearest satellite detection",
                "πλησιέστερη δορυφορική ανίχνευση",
              )}
              :{" "}
              {proximity.nearestDetectionKm !== null
                ? `${proximity.nearestDetectionKm.toFixed(1)} km · ${Math.round(proximity.nearestDetectionAgeMinutes ?? 0)} min`
                : localize(
                    language,
                    "no detections in the selected window",
                    "καμία ανίχνευση στο επιλεγμένο παράθυρο",
                  )}
            </p>
            <p className="locator-advice">{proximityLevelText.advice}</p>
            <small>
              {localize(
                language,
                "Indicative distance-based level · not an official warning. Follow 112 and authorities.",
                "Ενδεικτικό επίπεδο βάσει απόστασης · όχι επίσημη προειδοποίηση. Ακολουθείτε το 112 και τις αρχές.",
              )}
            </small>
          </div>
        )}
    </>
  );

  const mobileSheetOpen = compact && (panelOpen || intelOpen || locatorOpen);

  return (
    <main
      className={`command-shell${mobileSheetOpen ? " has-mobile-sheet" : ""}${layers.simulation ? " has-scenario" : ""}`}
    >
      <div className="map-stage">
        <div
          ref={mapElement}
          className={`map map--${baseMode}`}
          aria-label={localize(
            language,
            "Interactive Plomari wildfire operational map",
            "Διαδραστικός επιχειρησιακός χάρτης δασικής πυρκαγιάς Πλωμαρίου",
          )}
        />
        {!ready && (
          <div className="map-loading">
            {localize(language, "ACQUIRING MAP…", "ΦΟΡΤΩΣΗ ΧΑΡΤΗ…")}
          </div>
        )}
        <div className="scanline" aria-hidden="true" />
        <div className="reticle" aria-hidden="true">
          <span />
        </div>
      </div>

      {!online && (
        <div className="offline-banner">
          {localize(
            language,
            "OFFLINE — DISPLAYING THE LAST AVAILABLE SNAPSHOT",
            "ΕΚΤΟΣ ΣΥΝΔΕΣΗΣ — ΠΡΟΒΟΛΗ ΤΟΥ ΤΕΛΕΥΤΑΙΟΥ ΔΙΑΘΕΣΙΜΟΥ ΣΤΙΓΜΙΟΤΥΠΟΥ",
          )}
        </div>
      )}

      <header className="top-hud">
        <div className="brand-lockup">
          <div className="brand-line">
            <span className="live-dot" aria-hidden="true" />
            <h1>FIREWATCH // PLOMARI</h1>
          </div>
          <p>
            {localize(
              language,
              "LOCAL INCIDENT PICTURE · MULTISOURCE OSINT",
              "ΤΟΠΙΚΗ ΕΙΚΟΝΑ ΣΥΜΒΑΝΤΟΣ · ΠΛΗΡΟΦΟΡΙΕΣ ΑΝΟΙΧΤΩΝ ΠΗΓΩΝ",
            )}
          </p>
        </div>

        <div className="classification">
          {localize(language, "FIRE SERVICE", "ΠΥΡΟΣΒΕΣΤΙΚΟ ΣΩΜΑ")}
          {" // "}
          {officialStatus}
        </div>

        <div className="clock-block">
          <span>
            {localize(
              language,
              "GREECE LOCAL",
              "ΤΟΠΙΚΗ ΩΡΑ ΕΛΛΑΔΑΣ",
            )}
          </span>
          <div className="clock-line">
            <strong aria-live="polite">{clock || "--:--:--"}</strong>
            <div className="language-switch">
              <select
                value={language}
                onChange={(event) =>
                  changeLanguage(event.target.value as Language)
                }
                aria-label={localize(language, "Language", "Γλώσσα")}
              >
                {LANGUAGES.map((code) => (
                  <option key={code} value={code} lang={code}>
                    {LANGUAGE_NAMES[code]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <small>
            {localize(
              language,
              "FIRE BOARD AUTO · 112 MANUAL",
              "ΑΥΤΟΜΑΤΗ ΕΝΗΜΕΡΩΣΗ Π.Σ. · ΧΕΙΡΟΚΙΝΗΤΗ ΕΠΑΛΗΘΕΥΣΗ 112",
            )}
          </small>
        </div>
      </header>

      <div className="top-stack">
      <section
        className="evacuation-banner"
        aria-label={localize(
          language,
          "Archived 112 instruction issued at 16:58; not a current verification",
          "Αρχειοθετημένη οδηγία 112 που εκδόθηκε στις 16:58· όχι τρέχουσα επαλήθευση",
        )}
      >
        <div className="evacuation-code">112</div>
        <div className="evacuation-copy">
          <span className="evacuation-archive-tag">
            {localize(
              language,
              "ARCHIVED 112 · ISSUED 16:58 · NOT LIVE",
              "ΑΡΧΕΙΟ 112 · 16:58 · ΟΧΙ ΖΩΝΤΑΝΗ ΕΝΗΜΕΡΩΣΗ",
            )}
          </span>
          <strong lang="el">
            Η ΑΡΧΙΚΗ ΟΔΗΓΙΑ ΗΤΑΝ: ΠΑΡΑΛΙΑ ΠΛΩΜΑΡΙΟΥ → ΑΓΙΟΣ ΙΣΙΔΩΡΟΣ.
          </strong>
          <strong className="evacuation-copy__secondary" lang="en">
            ORIGINAL INSTRUCTION: PLOMARI BEACH → AGIOS ISIDOROS.
          </strong>
          <span className="evacuation-caveat evacuation-caveat--mobile">
            {localize(
              language,
              "Archived instruction — not a current verification. Follow newer 112 messages.",
              "Αρχειοθετημένη οδηγία — όχι τρέχουσα επαλήθευση. Ακολουθείτε νεότερα μηνύματα 112.",
            )}
          </span>
          <a
            className="official-alert-link official-alert-link--mobile"
            href="https://x.com/112Greece/status/2082468150189167080"
            target="_blank"
            rel="noreferrer"
          >
            112 {localize(language, "source", "πηγή")} ↗
          </a>
          <span className="evacuation-caveat">
            {pick(language, {
              en: `Original alert issued 16:58 · last manual record review ${officialVerifiedTime === "—" ? "pending" : officialVerifiedTime}. This banner reproduces that instruction; it is not proof that it remains current. Follow any newer 112 message and authorities on the ground.`,
              el: `Η αρχική ειδοποίηση εκδόθηκε στις 16:58 · τελευταίος χειροκίνητος έλεγχος αρχείου ${officialVerifiedTime === "—" ? "εκκρεμεί" : `στις ${officialVerifiedTime}`}. Το πλαίσιο αναπαράγει εκείνη την οδηγία· δεν αποδεικνύει ότι παραμένει σε ισχύ. Ακολουθείτε κάθε νεότερο μήνυμα 112 και τις επί τόπου οδηγίες των Αρχών.`,
              es: `Alerta original emitida a las 16:58 · última revisión manual del registro ${officialVerifiedTime === "—" ? "pendiente" : officialVerifiedTime}. Este aviso reproduce aquella instrucción; no demuestra que siga vigente. Siga cualquier mensaje 112 más reciente y a las autoridades sobre el terreno.`,
              fr: `Alerte initiale émise à 16h58 · dernière revue manuelle du registre ${officialVerifiedTime === "—" ? "en attente" : officialVerifiedTime}. Ce bandeau reproduit cette consigne ; il ne prouve pas qu'elle reste en vigueur. Suivez tout message 112 plus récent et les autorités sur le terrain.`,
              de: `Ursprüngliche Warnung ausgegeben 16:58 · letzte manuelle Prüfung des Eintrags ${officialVerifiedTime === "—" ? "ausstehend" : officialVerifiedTime}. Dieses Banner gibt jene Anweisung wieder; es belegt nicht, dass sie weiterhin gilt. Befolgen Sie jede neuere 112-Meldung und die Behörden vor Ort.`,
              it: `Allerta originale emessa alle 16:58 · ultima revisione manuale del registro ${officialVerifiedTime === "—" ? "in attesa" : officialVerifiedTime}. Questo avviso riproduce quell'istruzione; non dimostra che sia ancora in vigore. Seguire ogni messaggio 112 più recente e le autorità sul territorio.`,
            })}{" "}
            <a
              className="official-alert-link"
              href="https://x.com/112Greece/status/2082468150189167080"
              target="_blank"
              rel="noreferrer"
            >
              {localize(
                language,
                "Official alert",
                "Επίσημη ειδοποίηση",
              )}{" "}
              ↗
            </a>
          </span>
        </div>
        <a href="tel:112" aria-label={localize(language, "Call 112", "Κλήση 112")}>
          <span>{localize(language, "CALL", "ΚΛΗΣΗ")}</span>
          <b>112</b>
        </a>
      </section>

      <aside
        className="locator-hud"
        aria-label={localize(
          language,
          "PROXIMITY CHECK",
          "ΕΛΕΓΧΟΣ ΕΓΓΥΤΗΤΑΣ",
        )}
      >
        {locatorBody}
      </aside>
      <div className="region-block">
        <nav
          className="region-controls"
          aria-label={localize(language, "Fire region", "Περιοχή πυρκαγιών")}
        >
          {FIRE_REGIONS.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className={region === candidate.id ? "is-active" : ""}
              onClick={() => changeRegion(candidate.id)}
              aria-pressed={region === candidate.id}
            >
              {
                {
                  lesvos: localize(language, "LESVOS", "ΛΕΣΒΟΣ"),
                  france: localize(language, "FRANCE", "ΓΑΛΛΙΑ"),
                  spain: localize(language, "SPAIN", "ΙΣΠΑΝΙΑ"),
                }[candidate.id]
              }
            </button>
          ))}
        </nav>
        <p className="region-alerts" role="status">
          {alertError
            ? localize(
                language,
                "Meteoalarm unavailable",
                "Το Meteoalarm δεν είναι διαθέσιμο",
              )
            : alertData === null
              ? localize(language, "CHECKING", "ΕΛΕΓΧΟΣ")
              : (() => {
                  const parts: string[] = [];
                  if (alertData.forestFire.count > 0) {
                    parts.push(
                      `${alertData.forestFire.count} × ${localize(
                        language,
                        "FOREST-FIRE WARNINGS",
                        "ΠΡΟΕΙΔΟΠΟΙΗΣΕΙΣ ΔΑΣΙΚΩΝ ΠΥΡΚΑΓΙΩΝ",
                      )}`,
                    );
                  }
                  if (alertData.heat.count > 0) {
                    parts.push(
                      `${alertData.heat.count} × ${localize(
                        language,
                        "HEAT WARNINGS",
                        "ΠΡΟΕΙΔΟΠΟΙΗΣΕΙΣ ΚΑΥΣΩΝΑ",
                      )}`,
                    );
                  }
                  return parts.length > 0
                    ? `METEOALARM · ${parts.join(" · ")}`
                    : `METEOALARM · ${localize(
                        language,
                        "No active fire-weather warnings",
                        "Καμία ενεργή προειδοποίηση πυρομετεωρολογίας",
                      )}`;
                })()}
          {regionAq?.pm25 !== null && regionAq?.pm25 !== undefined
            ? ` · PM2.5 ${regionAq.pm25} µg/m³${
                regionAq.europeanAqi !== null
                  ? ` (${eaqiBand(language, regionAq.europeanAqi)})`
                  : ""
              }`
            : ""}
        </p>
      </div>
      </div>

      <nav
        className="view-controls"
        aria-label={localize(language, "Map style", "Υπόβαθρο χάρτη")}
      >
        {(["dark", "satellite", "terrain"] as BaseMode[]).map((mode) => (
          <button
            type="button"
            key={mode}
            className={baseMode === mode ? "is-active" : ""}
            onClick={() => setBaseMode(mode)}
            aria-pressed={baseMode === mode}
          >
            {
              {
                dark: localize(language, "dark", "σκοτεινό"),
                satellite: localize(language, "satellite", "δορυφορικό"),
                terrain: localize(language, "terrain", "ανάγλυφο"),
              }[mode]
            }
          </button>
        ))}
      </nav>


      {mobileSheetOpen && (
        <button
          type="button"
          className="mobile-scrim"
          onClick={closePanels}
          aria-label={localize(language, "Close panel", "Κλείσιμο πίνακα")}
        />
      )}

      <button
        type="button"
        className="panel-toggle panel-toggle--left"
        onClick={() =>
          setPanelOpen((value) => {
            const next = !value;
            if (next && compact) setIntelOpen(false);
            return next;
          })
        }
        aria-expanded={panelOpen}
        aria-controls="layers-sheet"
      >
        {panelOpen
          ? localize(language, "HIDE LAYERS", "ΑΠΟΚΡΥΨΗ ΕΠΙΠΕΔΩΝ")
          : localize(language, "LAYERS", "ΕΠΙΠΕΔΑ")}
      </button>


      {panelOpen && (
        <aside
          className="layer-hud"
          id="layers-sheet"
          aria-label={localize(language, "Data layers", "Επίπεδα δεδομένων")}
        >
          <div className="hud-heading">
            <div>
              <span>
                {localize(language, "DATA LAYERS", "ΕΠΙΠΕΔΑ ΔΕΔΟΜΕΝΩΝ")}
              </span>
              <small>
                {localize(
                  language,
                  "10 LAYERS // SOURCE + FRESHNESS VISIBLE",
                  "10 ΕΠΙΠΕΔΑ // ΟΡΑΤΗ ΠΗΓΗ + ΩΡΑ ΕΝΗΜΕΡΩΣΗΣ",
                )}
              </small>
            </div>
            <div className="hud-heading__actions">
              <button type="button" onClick={showOperationalView}>
                {localize(language, "FRAME", "ΠΡΟΒΟΛΗ")}
              </button>
              <button
                type="button"
                className="sheet-close"
                onClick={closePanels}
                aria-label={localize(
                  language,
                  "Close layers",
                  "Κλείσιμο επιπέδων",
                )}
              >
                ×
              </button>
            </div>
          </div>

          <div className="layer-stack">
            {[
              {
                key: "official" as LayerKey,
                icon: "→",
                label: localize(
                  language,
                  "112 evacuation",
                  "Οδηγία απομάκρυνσης 112",
                ),
                detail: localize(
                  language,
                  "Original official alert · 16:58",
                  "Αρχική επίσημη ειδοποίηση · 16:58",
                ),
                count: "1",
              },
              {
                key: "satellite" as LayerKey,
                icon: "✦",
                label: localize(
                  language,
                  "Satellite thermal detections",
                  "Δορυφορικές θερμικές ανιχνεύσεις",
                ),
                detail: thermalLayerDetail,
                count:
                  thermalLoading || thermalUnavailable
                    ? "—"
                    : String(thermalDetections.length),
              },
              {
                key: "satelliteRaster" as LayerKey,
                icon: "▧",
                label: localize(
                  language,
                  "Daily thermal raster",
                  "Ημερήσιο θερμικό επίπεδο",
                ),
                detail: localize(
                  language,
                  "NASA GIBS imagery · not extra points",
                  "Εικόνα NASA GIBS · όχι πρόσθετα σημεία",
                ),
                count: "IMG",
              },
              {
                key: "effis" as LayerKey,
                icon: "▰",
                label: localize(
                  language,
                  "EFFIS burnt areas (7 days)",
                  "Καμένες εκτάσεις EFFIS (7 ημέρες)",
                ),
                detail: localize(
                  language,
                  "Copernicus EU-wide perimeters · auto",
                  "Περίμετροι Copernicus για όλη την ΕΕ · αυτόματα",
                ),
                count: effisError ? "—" : String(effisData?.length ?? "…"),
              },
              {
                key: "inforcyl" as LayerKey,
                icon: "◉",
                label: localize(
                  language,
                  "Spain official incidents (INFORCYL + INFOCA)",
                  "Επίσημα συμβάντα Ισπανίας (INFORCYL + INFOCA)",
                ),
                detail: localize(
                  language,
                  "Castilla y León + Andalucía · 14 days",
                  "Castilla y León + Ανδαλουσία · 14 ημέρες",
                ),
                count:
                  region === "spain"
                    ? String(spainIncidents?.length ?? "…")
                    : "ES",
              },
              {
                key: "local" as LayerKey,
                icon: "△",
                label: localize(
                  language,
                  "Field-reported areas (approx.)",
                  "Περιοχές αναφοράς πεδίου (κατά προσ.)",
                ),
                detail: localize(
                  language,
                  "1 report · 2 reference areas · 20:50",
                  "1 αναφορά · 2 περιοχές αναφοράς · 20:50",
                ),
                count: "1R/2A",
              },
              {
                key: "wind" as LayerKey,
                icon: "↙",
                label: localize(
                  language,
                  "Wind profile",
                  "Προφίλ ανέμου",
                ),
                detail: pick(language, {
                  en: `Model valid ${windObservedTime} · polls 5 min`,
                  el: `Μοντέλο για ${windObservedTime} · ενημέρωση κάθε 5 λεπτά`,
                  es: `Modelo válido ${windObservedTime} · sondeo cada 5 min`,
                  fr: `Modèle valable ${windObservedTime} · sondage toutes les 5 min`,
                  de: `Modell gültig ${windObservedTime} · Abfrage alle 5 Min.`,
                  it: `Modello valido ${windObservedTime} · interrogazione ogni 5 min`,
                }),
                count: "4",
              },
              {
                key: "smokeObserved" as LayerKey,
                icon: "◌",
                label: localize(
                  language,
                  "Satellite aerosol / smoke",
                  "Δορυφορικό αερόλυμα / καπνός",
                ),
                detail: localize(
                  language,
                  "NASA VIIRS NRT · daylight snapshot",
                  "NASA VIIRS NRT · ημερήσιο στιγμιότυπο",
                ),
                count: "NRT",
              },
              {
                key: "smoke" as LayerKey,
                icon: "≈",
                label: localize(
                  language,
                  "Smoke transport proxy",
                  "Ενδεικτική μεταφορά καπνού",
                ),
                detail: localize(
                  language,
                  "Modeled wind envelope · not PM2.5",
                  "Μοντελοποιημένη ζώνη ανέμου · όχι μέτρηση PM2.5",
                ),
                count: `${smokeMinutes}m`,
              },
              {
                key: "simulation" as LayerKey,
                icon: "◇",
                label: localize(
                  language,
                  "What-if envelope",
                  "Υποθετική ζώνη",
                ),
                detail: localize(
                  language,
                  "Simulation · never route from this",
                  "Προσομοίωση · ποτέ για επιλογή διαδρομής",
                ),
                count: "SIM",
              },
            ].map((layer) => (
              <button
                type="button"
                className={`layer-control ${layers[layer.key] ? "is-enabled" : ""}`}
                key={layer.key}
                onClick={() => toggleLayer(layer.key)}
                aria-pressed={layers[layer.key]}
              >
                <span className="layer-icon">{layer.icon}</span>
                <span className="layer-copy">
                  <strong>{layer.label}</strong>
                  <small>{layer.detail}</small>
                </span>
                <span className="layer-count">{layer.count}</span>
                <span className="switch" aria-hidden="true">
                  <i />
                </span>
              </button>
            ))}
          </div>

          <section
            className="thermal-key"
            aria-label={localize(
              language,
              "Satellite thermal detection key",
              "Υπόμνημα δορυφορικών θερμικών ανιχνεύσεων",
            )}
          >
            <div className="thermal-key__head">
              <span>
                {localize(
                  language,
                  "SATELLITE DETECTION KEY",
                  "ΥΠΟΜΝΗΜΑ ΔΟΡΥΦΟΡΙΚΩΝ ΑΝΙΧΝΕΥΣΕΩΝ",
                )}
              </span>
              <strong
                className={
                  thermalUnavailable
                    ? "is-error"
                    : thermalData?.status === "partial" ||
                        thermalStaleSnapshot
                      ? "is-partial"
                      : ""
                }
              >
                {thermalLoading
                  ? localize(language, "LOADING", "ΦΟΡΤΩΣΗ")
                  : thermalUnavailable
                    ? localize(language, "UNAVAILABLE", "ΜΗ ΔΙΑΘΕΣΙΜΗ")
                    : thermalStaleSnapshot
                      ? localize(language, "RETRYING", "ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ")
                    : thermalData?.status === "partial"
                      ? localize(language, "PARTIAL", "ΜΕΡΙΚΗ")
                      : localize(language, "AVAILABLE", "ΔΙΑΘΕΣΙΜΗ")}
              </strong>
            </div>

            <div
              className="thermal-filter"
              role="group"
              aria-label={localize(
                language,
                "Thermal observation window",
                "Χρονικό παράθυρο θερμικών παρατηρήσεων",
              )}
            >
              {(["latest", "6h", "24h"] as ThermalWindow[]).map((window) => (
                <button
                  type="button"
                  key={window}
                  className={thermalWindow === window ? "is-active" : ""}
                  onClick={() => setThermalWindow(window)}
                  aria-pressed={thermalWindow === window}
                >
                  {
                    {
                      latest: localize(
                        language,
                        "LATEST DETECTING PASS",
                        "ΝΕΟΤΕΡΗ ΔΙΕΛΕΥΣΗ ΜΕ ΑΝΙΧΝΕΥΣΕΙΣ",
                      ),
                      "6h": localize(language, "6 HOURS", "6 ΩΡΕΣ"),
                      "24h": localize(language, "24 HOURS", "24 ΩΡΕΣ"),
                    }[window]
                  }
                </button>
              ))}
            </div>

            {!thermalLoading && !thermalUnavailable && (
              <div className="thermal-summary">
                <strong>
                  {thermalDetections.length}{" "}
                  {localize(
                    language,
                    "detection records",
                    "εγγραφές ανίχνευσης",
                  )}{" "}
                  · {visibleThermalPasses}{" "}
                  {localize(
                    language,
                    visibleThermalPasses === 1 ? "pass" : "passes",
                    visibleThermalPasses === 1 ? "διέλευση" : "διελεύσεις",
                  )}
                </strong>
                <small>
                  {localize(language, "Window", "Παράθυρο")}:{" "}
                  {thermalWindowName} ·{" "}
                  {localize(language, "latest observation", "νεότερη παρατήρηση")}{" "}
                  {thermalLatestTime} ({thermalLatestAge})
                </small>
              </div>
            )}

            <p className="thermal-definition">
              {localize(
                language,
                "Each marker is the center of a satellite pixel where a thermal anomaly was detected during one overpass. It is not a live flame location, a fire perimeter, or a count of fires.",
                "Κάθε δείκτης είναι το κέντρο ενός δορυφορικού εικονοστοιχείου όπου ανιχνεύτηκε θερμική ανωμαλία κατά μία διέλευση. Δεν αποτελεί θέση ενεργής φλόγας σε πραγματικό χρόνο, περίμετρο πυρκαγιάς ή αριθμό πυρκαγιών.",
              )}
            </p>

            {thermalUnavailable && (
              <p className="thermal-message thermal-message--error">
                {localize(
                  language,
                  "FIRMS point feed unavailable — showing no point count. The optional NASA daily raster can be enabled separately.",
                  "Η σημειακή ροή FIRMS δεν είναι διαθέσιμη — δεν εμφανίζεται αριθμός σημείων. Το προαιρετικό ημερήσιο δορυφορικό επίπεδο NASA μπορεί να ενεργοποιηθεί ξεχωριστά.",
                )}
              </p>
            )}
            {!thermalLoading &&
              !thermalUnavailable &&
              thermalDetections.length === 0 && (
                <p className="thermal-message">
                  {localize(
                    language,
                    "No thermal detections were returned for this area in the selected window. This does not mean the fire is out; clouds, satellite timing, and sensor limits can hide activity.",
                    "Δεν επιστράφηκαν θερμικές ανιχνεύσεις για αυτή την περιοχή στο επιλεγμένο χρονικό παράθυρο. Αυτό δεν σημαίνει ότι η πυρκαγιά έχει σβήσει· νέφη, χρόνος διέλευσης και περιορισμοί του αισθητήρα μπορεί να αποκρύπτουν δραστηριότητα.",
                  )}
                </p>
              )}

            <div className="thermal-confidence">
              {[
                {
                  code: "h",
                  label: localize(language, "HIGH", "ΥΨΗΛΗ"),
                  detail: localize(
                    language,
                    "saturated fire pixel",
                    "κορεσμένο εικονοστοιχείο φωτιάς",
                  ),
                },
                {
                  code: "n",
                  label: localize(language, "NOMINAL", "ΟΝΟΜΑΣΤΙΚΗ"),
                  detail: localize(
                    language,
                    "strong anomaly; no daytime sun-glint flag",
                    "ισχυρή ανωμαλία· χωρίς ένδειξη ηλιακής αντανάκλασης",
                  ),
                },
                {
                  code: "l",
                  label: localize(language, "LOW", "ΧΑΜΗΛΗ"),
                  detail: localize(
                    language,
                    "lower confidence / sun-glint prone",
                    "χαμηλότερη αξιοπιστία / πιθανή ηλιακή αντανάκλαση",
                  ),
                },
              ].map((item) => (
                <span key={item.code}>
                  <i className={`thermal-dot thermal-dot--${item.code}`} />
                  <b>{item.label}</b>
                  <small>{item.detail}</small>
                </span>
              ))}
            </div>

            <p className="thermal-note">
              {localize(
                language,
                "Confidence describes detection quality, not fire severity. FRP is pixel-integrated radiative power; not flame height or total fire intensity.",
                "Η αξιοπιστία περιγράφει την ποιότητα της ανίχνευσης, όχι τη σοβαρότητα της πυρκαγιάς. Το FRP είναι ακτινοβολούμενη ισχύς ενσωματωμένη στο εικονοστοιχείο· όχι ύψος φλόγας ούτε συνολική ένταση της πυρκαγιάς.",
              )}
            </p>
            <small className="thermal-source-line">
              {localize(language, "Retrieved", "Ανάκτηση")}{" "}
              {thermalRetrievedTime} ·{" "}
              {localize(
                language,
                "app checks every 5 min; satellite passes are not continuous",
                "έλεγχος εφαρμογής κάθε 5 λεπτά· οι δορυφορικές διελεύσεις δεν είναι συνεχείς",
              )}
            </small>
          </section>

          <div className="position-actions">
            <button type="button" onClick={() => focusPoint(INCIDENT, 15)}>
              {localize(language, "INCIDENT", "ΣΥΜΒΑΝ")}
            </button>
            <button type="button" onClick={() => focusPoint(PLOMARI_BEACH, 15)}>
              {localize(language, "PLOMARI", "ΠΛΩΜΑΡΙ")}
            </button>
            <button type="button" onClick={() => focusPoint(PERAMA, 15)}>
              {localize(language, "PERAMA", "ΠΕΡΑΜΑ")}
            </button>
          </div>

          <div className="wind-readout">
            <div className="wind-readout__head">
              <span>
                {localize(
                  language,
                  "FIRE-GRID WIND MODEL",
                  "ΜΟΝΤΕΛΟ ΑΝΕΜΟΥ ΣΤΗΝ ΕΣΤΙΑ",
                )}
              </span>
              <strong className={windError ? "is-stale" : ""}>
                {windError
                  ? localize(
                      language,
                      "SNAPSHOT / RETRYING",
                      "ΣΤΙΓΜΙΟΤΥΠΟ / ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ",
                    )
                  : pick(language, {
                      en: `VALID ${windObservedTime}`,
                      el: `ΕΓΚΥΡΟ ΓΙΑ ${windObservedTime}`,
                      es: `VÁLIDO ${windObservedTime}`,
                      fr: `VALABLE ${windObservedTime}`,
                      de: `GÜLTIG ${windObservedTime}`,
                      it: `VALIDO ${windObservedTime}`,
                    })}
              </strong>
            </div>
            {[
              ["10 m", fireWind.wind10],
              ["80 m", fireWind.wind80],
              ["120 m", fireWind.wind120],
              ["180 m", fireWind.wind180],
            ].map(([height, vector]) => {
              const typedVector = vector as WindVector;
              return (
                <div className="wind-row" key={height as string}>
                  <span>{height as string}</span>
                  <b>
                    {localize(language, "FROM", "ΑΠΟ")}{" "}
                    {String(Math.round(typedVector.directionDeg)).padStart(3, "0")}°
                  </b>
                  <strong>{typedVector.speedKmh.toFixed(1)} km/h</strong>
                </div>
              );
            })}
            <div className="wind-row wind-row--hazard">
              <span>{localize(language, "GUST", "ΡΙΠΗ")}</span>
              <b>{localize(language, "MODEL", "ΜΟΝΤΕΛΟ")}</b>
              <strong>{fireWind.gustKmh.toFixed(1)} km/h</strong>
            </div>
            <div className="wind-row">
              <span>RH / PBL</span>
              <b>{fireWind.rhPct}%</b>
              <strong>{Math.round(fireWind.pblM)} m</strong>
            </div>
            {(windData?.airQuality ?? [])
              .filter((entry) => entry.pm25 !== null)
              .map((entry) => (
                <div
                  className={`wind-row${
                    entry.europeanAqi !== null && entry.europeanAqi >= 60
                      ? " wind-row--hazard"
                      : ""
                  }`}
                  key={`aq-${entry.id}`}
                >
                  <span>
                    PM2.5 ·{" "}
                    {entry.id === "fire"
                      ? localize(language, "FIRE AREA", "ΕΣΤΙΑ")
                      : localize(language, "PERAMA", "ΠΕΡΑΜΑ")}
                  </span>
                  <b>
                    {entry.europeanAqi !== null
                      ? eaqiBand(language, entry.europeanAqi)
                      : "—"}
                  </b>
                  <strong>{entry.pm25} µg/m³</strong>
                </div>
              ))}
            {windData?.metar && (
              <div className="metar-line">
                <span>
                  {localize(
                    language,
                    "LGMT MEASURED",
                    "LGMT · ΜΕΤΡΗΜΕΝΟΣ ΑΝΕΜΟΣ",
                  )}{" "}
                  · {formatGreeceTime(windData.metar.observedAt)}
                </span>
                <strong>
                  {windData.metar.directionDeg}° {windData.metar.speedKt}G
                  {windData.metar.gustKt ?? "—"} kt
                </strong>
              </div>
            )}
            <label className="smoke-horizon">
              <span>
                {localize(
                  language,
                  "Smoke proxy horizon",
                  "Ορίζοντας ενδεικτικής μεταφοράς καπνού",
                )}{" "}
                <b>
                  {smokeMinutes} {localize(language, "min", "λεπτά")}
                </b>
              </span>
              <input
                type="range"
                min="5"
                max="60"
                step="5"
                value={smokeMinutes}
                onChange={(event) => setSmokeMinutes(Number(event.target.value))}
              />
            </label>
            <p>
              {pick(language, {
                en: `From ${compass(fireWind.wind10.directionDeg, language)} toward ${compass(downwindHeading, language)}. Point-model wind is not fire spread; terrain and gusts can change local flow. Retrieved ${
                  retrievedTime === "—" ? "pending" : `${retrievedTime} Greece`
                }.`,
                el: `Από ${compass(fireWind.wind10.directionDeg, language)} προς ${compass(downwindHeading, language)}. Το μοντέλο ανέμου σε σημείο δεν προβλέπει την εξάπλωση της φωτιάς· το ανάγλυφο και οι ριπές μπορούν να μεταβάλουν την τοπική ροή. Ανάκτηση ${
                  retrievedTime === "—" ? "εκκρεμεί" : `${retrievedTime} ώρα Ελλάδας`
                }.`,
                es: `Desde ${compass(fireWind.wind10.directionDeg, language)} hacia ${compass(downwindHeading, language)}. El viento del modelo puntual no es propagación del fuego; el terreno y las rachas pueden cambiar el flujo local. Obtenido ${
                  retrievedTime === "—" ? "pendiente" : `${retrievedTime} hora de Grecia`
                }.`,
                fr: `Depuis ${compass(fireWind.wind10.directionDeg, language)} vers ${compass(downwindHeading, language)}. Le vent du modèle ponctuel n'est pas la propagation du feu ; le terrain et les rafales peuvent modifier l'écoulement local. Récupéré ${
                  retrievedTime === "—" ? "en attente" : `${retrievedTime} heure de Grèce`
                }.`,
                de: `Aus ${compass(fireWind.wind10.directionDeg, language)} nach ${compass(downwindHeading, language)}. Punktmodell-Wind ist keine Feuerausbreitung; Gelände und Böen können die lokale Strömung ändern. Abgerufen ${
                  retrievedTime === "—" ? "ausstehend" : `${retrievedTime} griechische Zeit`
                }.`,
                it: `Da ${compass(fireWind.wind10.directionDeg, language)} verso ${compass(downwindHeading, language)}. Il vento del modello puntuale non è la propagazione del fuoco; terreno e raffiche possono modificare il flusso locale. Recuperato ${
                  retrievedTime === "—" ? "in attesa" : `${retrievedTime} ora della Grecia`
                }.`,
              })}
            </p>
          </div>
        </aside>
      )}

      <button
        type="button"
        className="panel-toggle panel-toggle--right"
        onClick={() =>
          setIntelOpen((value) => {
            const next = !value;
            if (next && compact) setPanelOpen(false);
            return next;
          })
        }
        aria-expanded={intelOpen}
        aria-controls="intel-sheet"
      >
        {intelOpen
          ? localize(language, "HIDE UPDATES", "ΑΠΟΚΡΥΨΗ ΕΝΗΜΕΡΩΣΕΩΝ")
          : localize(language, "UPDATES", "ΕΝΗΜΕΡΩΣΕΙΣ")}
      </button>

      <nav
        className="mobile-dock"
        aria-label={localize(
          language,
          "Mobile map navigation",
          "Πλοήγηση χάρτη για κινητό",
        )}
      >
        <button
          type="button"
          className={!panelOpen && !intelOpen && !locatorOpen ? "is-active" : ""}
          onClick={closePanels}
          aria-pressed={!panelOpen && !intelOpen && !locatorOpen}
        >
          <span aria-hidden="true">◎</span>
          <b>{localize(language, "MAP", "ΧΑΡΤΗΣ")}</b>
        </button>
        <button
          type="button"
          className={locatorOpen ? "is-active" : ""}
          onClick={() => {
            setLocatorOpen((value) => !value);
            setPanelOpen(false);
            setIntelOpen(false);
          }}
          aria-expanded={locatorOpen}
          aria-controls="locator-sheet"
        >
          <span aria-hidden="true">⚲</span>
          <b>{localize(language, "SEARCH", "ΑΝΑΖΗΤΗΣΗ")}</b>
        </button>
        <button
          type="button"
          className={panelOpen ? "is-active" : ""}
          onClick={() => {
            setPanelOpen((value) => !value);
            setIntelOpen(false);
            setLocatorOpen(false);
          }}
          aria-expanded={panelOpen}
          aria-controls="layers-sheet"
        >
          <span aria-hidden="true">☷</span>
          <b>{localize(language, "LAYERS", "ΕΠΙΠΕΔΑ")}</b>
        </button>
        <button
          type="button"
          className={intelOpen ? "is-active" : ""}
          onClick={() => {
            setIntelOpen((value) => !value);
            setPanelOpen(false);
            setLocatorOpen(false);
          }}
          aria-expanded={intelOpen}
          aria-controls="intel-sheet"
        >
          <span aria-hidden="true">≡</span>
          <b>{localize(language, "UPDATES", "ΕΝΗΜΕΡΩΣΕΙΣ")}</b>
        </button>
      </nav>

      {compact && locatorOpen && (
        <aside
          className="locator-sheet"
          id="locator-sheet"
          aria-label={localize(
            language,
            "PROXIMITY CHECK",
            "ΕΛΕΓΧΟΣ ΕΓΓΥΤΗΤΑΣ",
          )}
        >
          <div className="hud-heading">
            <div>
              <span>
                {localize(language, "PROXIMITY CHECK", "ΕΛΕΓΧΟΣ ΕΓΓΥΤΗΤΑΣ")}
              </span>
              <small>
                {localize(
                  language,
                  "Search data © OpenStreetMap",
                  "Δεδομένα αναζήτησης © OpenStreetMap",
                )}
              </small>
            </div>
          </div>
          <div className="locator-sheet__body">{locatorBody}</div>
        </aside>
      )}

      {intelOpen && (
        <aside
          className="intel-hud"
          id="intel-sheet"
          aria-label={localize(
            language,
            "Incident updates",
            "Ενημερώσεις συμβάντος",
          )}
        >
          <div className="hud-heading">
            <div>
              <span>
                {localize(language, "INCIDENT WIRE", "ΡΟΗ ΣΥΜΒΑΝΤΟΣ")}
              </span>
              <small>
                {region === "lesvos"
                  ? localize(language, "GREECE TIME", "ΩΡΑ ΕΛΛΑΔΑΣ")
                  : localize(
                      language,
                      "REGION FIRE NEWS · CURATED RSS",
                      "ΕΙΔΗΣΕΙΣ ΠΥΡΚΑΓΙΩΝ ΠΕΡΙΟΧΗΣ · ΕΠΙΛΕΓΜΕΝΑ RSS",
                    )}
                {" // "}
                {updatesError
                  ? localize(
                      language,
                      "SNAPSHOT · RETRYING",
                      "ΣΤΙΓΜΙΟΤΥΠΟ · ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ",
                    )
                  : pick(language, {
                      en: `RSS POLL ${updatesRetrievedTime}`,
                      el: `ΕΛΕΓΧΟΣ RSS ${updatesRetrievedTime}`,
                      es: `SONDEO RSS ${updatesRetrievedTime}`,
                      fr: `SONDAGE RSS ${updatesRetrievedTime}`,
                      de: `RSS-ABFRAGE ${updatesRetrievedTime}`,
                      it: `INTERROGAZIONE RSS ${updatesRetrievedTime}`,
                    })}
              </small>
            </div>
            <div className="hud-heading__actions">
              <span className="recording-dot">
                {localize(language, "REC", "ΖΩΝΤΑΝΑ")}
              </span>
              <button
                type="button"
                className="sheet-close"
                onClick={closePanels}
                aria-label={localize(
                  language,
                  "Close updates",
                  "Κλείσιμο ενημερώσεων",
                )}
              >
                ×
              </button>
            </div>
          </div>

          {region === "lesvos" ? (
            <>
          <div className="intel-list">
            {displayIntel.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === activeIntel ? "intel-item is-active" : "intel-item"}
                onClick={() => setActiveIntel(item.id)}
              >
                <time>
                  <span>{item.time}</span>
                  {item.archived && (
                    <small>
                      {localize(language, "29 JUL 2026", "29 ΙΟΥΛ 2026")}
                    </small>
                  )}
                </time>
                <span>
                  <strong>{item.label}</strong>
                  <small>
                    {item.archived
                      ? `${localize(language, "ARCHIVE", "ΑΡΧΕΙΟ")} · `
                      : ""}
                    {confidenceLabel(item.confidence, language)}
                    {item.category
                      ? ` · ${updateCategoryLabel(item.category, language)}`
                      : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>

          <div className={`intel-detail intel-detail--${active.confidence}`}>
            <div className="intel-detail__meta">
              {active.archived && (
                <span className="archive-badge">
                  {localize(
                    language,
                    "ARCHIVE · 29 JUL 2026",
                    "ΑΡΧΕΙΟ · 29 ΙΟΥΛ 2026",
                  )}
                </span>
              )}
              <span>{confidenceLabel(active.confidence, language)}</span>
              {active.category && (
                <span
                  className={`category-badge category-badge--${active.severity ?? "low"}`}
                >
                  {updateCategoryLabel(active.category, language)}
                </span>
              )}
              {active.actionRequired && (
                <span className="action-badge">
                  {localize(language, "ACTION", "ΕΝΕΡΓΕΙΑ")}
                </span>
              )}
            </div>
            <strong>{active.label}</strong>
            <p>{active.detail}</p>
            {active.sourceUrl && (
              <a
                className="intel-detail__source"
                href={active.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {active.sourceLabel ??
                  localize(language, "Direct source", "Άμεση πηγή")}{" "}
                ↗
              </a>
            )}
          </div>
            </>
          ) : (
            <div className="intel-list intel-list--news">
              {regionNews === null && (
                <p className="intel-empty">
                  {localize(language, "Checking live sources", "Έλεγχος ζωντανών πηγών")}
                </p>
              )}
              {regionNews?.length === 0 && (
                <p className="intel-empty">
                  {localize(
                    language,
                    "No recent fire headlines from the region packs.",
                    "Δεν υπάρχουν πρόσφατοι τίτλοι πυρκαγιών από τα πακέτα της περιοχής.",
                  )}
                </p>
              )}
              {(regionNews ?? []).map((item) => (
                <a
                  key={item.url}
                  className="intel-item"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <time>
                    <span>{formatRegionTime(item.publishedAt)}</span>
                  </time>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.sourceLabel} ·{" "}
                      {localize(language, "LOCAL REPORT", "ΤΟΠΙΚΗ ΑΝΑΦΟΡΑ")}
                    </small>
                  </span>
                </a>
              ))}
            </div>
          )}

          {region === "lesvos" ? (
            <>
          <div className="source-health">
            <span>
              {localize(language, "SOURCE HEALTH", "ΚΑΤΑΣΤΑΣΗ ΠΗΓΩΝ")}
            </span>
            {sourceHealth ? (
              <strong>
                {sourceHealth.online}/{sourceHealth.total}{" "}
                {localize(language, "reachable", "προσβάσιμες")}
                {sourceHealth.failed
                  ? ` · ${sourceHealth.failed} ${localize(language, "failed", "σε σφάλμα")}`
                  : ""}
                {sourceHealth.unconfigured
                  ? ` · ${sourceHealth.unconfigured} ${localize(language, "optional unconfigured", "προαιρετικές χωρίς ρύθμιση")}`
                  : ""}
              </strong>
            ) : (
              <strong>{localize(language, "CHECKING", "ΕΛΕΓΧΟΣ")}</strong>
            )}
            <small>
              {localize(
                language,
                "Reachable means the source responded—not that it published a new Plomari update.",
                "Προσβάσιμη σημαίνει ότι η πηγή ανταποκρίθηκε—όχι ότι δημοσίευσε νέα ενημέρωση για το Πλωμάρι.",
              )}
            </small>
          </div>

          <div className="source-links">
            {localizedSources.map((source) => (
              <a
                key={source.label}
                href={source.href}
                target="_blank"
                rel="noreferrer"
              >
                <span>{source.label}</span>
                <small>{source.kind} ↗</small>
              </a>
            ))}
          </div>
            </>
          ) : (
            <div className="source-links">
              {REGION_LINKS[region].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{link.label}</span>
                  <small>
                    {
                      {
                        "Official X account": localize(
                          language,
                          "Official X account",
                          "Επίσημος λογαριασμός X",
                        ),
                        "Official fire-weather outlook": localize(
                          language,
                          "Official fire-weather outlook",
                          "Επίσημη πρόγνωση πυρομετεωρολογίας",
                        ),
                        "Curated national coverage": localize(
                          language,
                          "Curated national coverage",
                          "Επιμελημένη εθνική κάλυψη",
                        ),
                        "Official government news": localize(
                          language,
                          "Official government news",
                          "Επίσημες κυβερνητικές ειδήσεις",
                        ),
                        "Official incident data": localize(
                          language,
                          "Official incident data",
                          "Επίσημα δεδομένα συμβάντων",
                        ),
                      }[link.kind]
                    }{" "}
                    ↗
                  </small>
                </a>
              ))}
            </div>
          )}
        </aside>
      )}

      {layers.simulation && (
        <section
          className="scenario-hud"
          aria-label={localize(
            language,
            "What-if simulation controls",
            "Χειριστήρια υποθετικής προσομοίωσης",
          )}
        >
          <div className="scenario-title">
            <span>
              {localize(language, "SCENARIO ENGINE", "ΜΗΧΑΝΗ ΣΕΝΑΡΙΩΝ")}
            </span>
            <strong>
              {localize(
                language,
                "WHAT-IF ONLY · NOT A FORECAST",
                "ΜΟΝΟ ΥΠΟΘΕΤΙΚΟ ΣΕΝΑΡΙΟ · ΟΧΙ ΠΡΟΓΝΩΣΗ",
              )}
            </strong>
          </div>
          <label>
            <span>
              {localize(language, "Horizon", "Ορίζοντας")}{" "}
              <b>
                +{hour}
                {localize(language, "h", "ω")}
              </b>
            </span>
            <input
              type="range"
              min="0"
              max="6"
              step="1"
              value={hour}
              onChange={(event) => setHour(Number(event.target.value))}
            />
          </label>
          <label>
            <span>
              {localize(language, "Wind", "Άνεμος")} <b>{beaufort} Bft</b>
            </span>
            <input
              type="range"
              min="3"
              max="7"
              step="1"
              value={beaufort}
              onChange={(event) => setBeaufort(Number(event.target.value))}
            />
          </label>
          <label>
            <span>{localize(language, "Heading", "Κατεύθυνση")}</span>
            <select
              value={heading}
              onChange={(event) => setHeading(Number(event.target.value))}
            >
              <option value="218">
                {localize(
                  language,
                  "SW · modeled downwind",
                  "ΝΔ · μοντελοποιημένη υπήνεμη κατεύθυνση",
                )}
              </option>
              <option value="180">
                {localize(language, "S · Plomari", "Ν · Πλωμάρι")}
              </option>
              <option value="270">
                {localize(language, "W · Melinta", "Δ · Μελίντα")}
              </option>
              <option value="135">
                {localize(
                  language,
                  "SE · Agios Isidoros",
                  "ΝΑ · Άγιος Ισίδωρος",
                )}
              </option>
            </select>
          </label>
          <div className="scenario-distance">
            <span>
              {localize(language, "Illustrative head", "Ενδεικτικό άκρο")}
            </span>
            <b>{scenarioDistance} km</b>
          </div>
        </section>
      )}

      <section
        className="mission-hud"
        aria-label={localize(
          language,
          "Current operating picture",
          "Τρέχουσα επιχειρησιακή εικόνα",
        )}
      >
        <div className="mission-primary">
          <span>
            {localize(language, "OFFICIAL STATUS", "ΕΠΙΣΗΜΗ ΚΑΤΑΣΤΑΣΗ")}
          </span>
          <strong>{officialStatus}</strong>
          <small>
            {localize(
              language,
              "Fire Service auto · latest 112 instruction remains manual",
              "Αυτόματη ενημέρωση Π.Σ. · χειροκίνητη επαλήθευση τελευταίας οδηγίας 112",
            )}
          </small>
        </div>
        <div>
          <span>
            {localize(language, "SATELLITE THERMAL", "ΔΟΡΥΦΟΡΙΚΑ ΘΕΡΜΙΚΑ")} ·{" "}
            {thermalLatestTime}
          </span>
          <strong>
            {thermalLoading
              ? localize(language, "CHECKING FIRMS", "ΕΛΕΓΧΟΣ FIRMS")
              : thermalUnavailable
                ? localize(
                    language,
                    "POINT FEED UNAVAILABLE",
                    "Η ΣΗΜΕΙΑΚΗ ΡΟΗ ΔΕΝ ΕΙΝΑΙ ΔΙΑΘΕΣΙΜΗ",
                  )
                : pick(language, {
                    en: `${thermalDetections.length} RECORDS · ${visibleThermalPasses} PASSES`,
                    el: `${thermalDetections.length} ΕΓΓΡΑΦΕΣ · ${visibleThermalPasses} ΔΙΕΛΕΥΣΕΙΣ`,
                    es: `${thermalDetections.length} REGISTROS · ${visibleThermalPasses} PASADAS`,
                    fr: `${thermalDetections.length} ENREGISTREMENTS · ${visibleThermalPasses} PASSAGES`,
                    de: `${thermalDetections.length} DATENSÄTZE · ${visibleThermalPasses} ÜBERFLÜGE`,
                    it: `${thermalDetections.length} RECORD · ${visibleThermalPasses} PASSAGGI`,
                  })}
          </strong>
          <small>
            {thermalUnavailable
              ? localize(
                  language,
                  "No historical points substituted · raster is a separate layer",
                  "Δεν υποκαθίστανται ιστορικά σημεία · η εικόνα είναι ξεχωριστό επίπεδο",
                )
              : thermalDetections.length === 0
                ? localize(
                    language,
                    "Zero detections is not an all-clear",
                    "Μηδενικές ανιχνεύσεις δεν σημαίνουν λήξη συναγερμού",
                  )
                : pick(language, {
                    en: `${thermalWindowName} · ${thermalLatestAge} · orbital snapshots`,
                    el: `${thermalWindowName} · ${thermalLatestAge} · δορυφορικά στιγμιότυπα`,
                    es: `${thermalWindowName} · ${thermalLatestAge} · capturas orbitales`,
                    fr: `${thermalWindowName} · ${thermalLatestAge} · instantanés orbitaux`,
                    de: `${thermalWindowName} · ${thermalLatestAge} · Orbital-Snapshots`,
                    it: `${thermalWindowName} · ${thermalLatestAge} · istantanee orbitali`,
                  })}
          </small>
        </div>
        <div>
          <span>
            {localize(
              language,
              "FIRE-GRID MODEL",
              "ΜΟΝΤΕΛΟ ΑΝΕΜΟΥ ΣΤΗΝ ΕΣΤΙΑ",
            )}{" "}
            · {windObservedTime}
          </span>
          <strong>
            {compass(fireWind.wind10.directionDeg, language)} →{" "}
            {compass(downwindHeading, language)} ·{" "}
            {fireWind.wind10.speedKmh.toFixed(0)} km/h
          </strong>
          <small>
            {localize(language, "Gust", "Ριπή")}{" "}
            {fireWind.gustKmh.toFixed(0)} km/h ·{" "}
            {localize(language, "model, not sensor", "μοντέλο, όχι αισθητήρας")}
          </small>
        </div>
        <div>
          <span>
            {localize(language, "INCIDENT WIRE", "ΡΟΗ ΣΥΜΒΑΝΤΟΣ")} ·{" "}
            {updatesRetrievedTime}
          </span>
          <strong>
            {updatesError
              ? localize(
                  language,
                  "SNAPSHOT / RETRYING",
                  "ΣΤΙΓΜΙΟΤΥΠΟ / ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ",
                )
              : localize(
                  language,
                  "POLLING 60 SECONDS",
                  "ΕΛΕΓΧΟΣ ΚΑΘΕ 60 ΔΕΥΤΕΡΟΛΕΠΤΑ",
                )}
          </strong>
          <small>
            {pick(language, {
              en: sourceHealth
                ? `${sourceHealth.online}/${sourceHealth.total} sources reachable · Greece timestamps`
                : "Checking official and local sources · Greece timestamps",
              el: sourceHealth
                ? `${sourceHealth.online}/${sourceHealth.total} πηγές προσβάσιμες · ώρες Ελλάδας`
                : "Έλεγχος επίσημων και τοπικών πηγών · ώρες Ελλάδας",
              es: sourceHealth
                ? `${sourceHealth.online}/${sourceHealth.total} fuentes accesibles · horas de Grecia`
                : "Comprobando fuentes oficiales y locales · horas de Grecia",
              fr: sourceHealth
                ? `${sourceHealth.online}/${sourceHealth.total} sources joignables · heures de Grèce`
                : "Vérification des sources officielles et locales · heures de Grèce",
              de: sourceHealth
                ? `${sourceHealth.online}/${sourceHealth.total} Quellen erreichbar · griechische Zeitstempel`
                : "Offizielle und lokale Quellen werden geprüft · griechische Zeitstempel",
              it: sourceHealth
                ? `${sourceHealth.online}/${sourceHealth.total} fonti raggiungibili · orari della Grecia`
                : "Verifica delle fonti ufficiali e locali · orari della Grecia",
            })}
          </small>
        </div>
      </section>

      <div
        className="confidence-legend"
        aria-label={localize(
          language,
          "Confidence legend",
          "Υπόμνημα αξιοπιστίας",
        )}
      >
        <span>
          <i className="official-dot" />
          {localize(language, "OFFICIAL", "ΕΠΙΣΗΜΗ ΠΗΓΗ")}
        </span>
        <span>
          <i className="observed-dot" />
          {localize(language, "OBSERVED", "ΠΑΡΑΤΗΡΗΣΗ")}
        </span>
        <span>
          <i className="reported-dot" />
          {localize(language, "REPORTED", "ΤΟΠΙΚΗ ΑΝΑΦΟΡΑ")}
        </span>
        <span>
          <i className="modeled-dot" />
          {localize(
            language,
            "MODELED / SIM",
            "ΜΟΝΤΕΛΟ / ΠΡΟΣΟΜΟΙΩΣΗ",
          )}
        </span>
      </div>

      <footer className="system-footer">
        <span>
          {localize(
            language,
            "NOT AN OFFICIAL EMERGENCY PRODUCT",
            "ΔΕΝ ΑΠΟΤΕΛΕΙ ΕΠΙΣΗΜΟ ΕΡΓΑΛΕΙΟ ΕΚΤΑΚΤΗΣ ΑΝΑΓΚΗΣ",
          )}
        </span>
        <span>
          {localize(
            language,
            "Interface baseline inspired by",
            "Η βάση της διεπαφής είναι εμπνευσμένη από το",
          )}{" "}
          <a
            href="https://github.com/VrushankPatel/godseye"
            target="_blank"
            rel="noreferrer"
          >
            Godseye
          </a>
          .{" "}
          {localize(
            language,
            "Authorities override every map layer.",
            "Οι οδηγίες των Αρχών υπερισχύουν κάθε επιπέδου του χάρτη.",
          )}
        </span>
      </footer>
    </main>
  );
}
