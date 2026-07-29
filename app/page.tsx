"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LayerGroup,
  Map as LeafletMap,
  TileLayer,
  WMSOptions,
} from "leaflet";
import "leaflet/dist/leaflet.css";

type LatLngTuple = [number, number];
type Confidence = "official" | "observed" | "reported" | "modeled";
type Language = "en" | "el";
type LayerKey =
  | "official"
  | "satellite"
  | "local"
  | "wind"
  | "smokeObserved"
  | "smoke"
  | "simulation";
type BaseMode = "dark" | "satellite" | "terrain";

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
};

type ThermalDetection = {
  id: string;
  point: LatLngTuple;
  sensor: string;
  pass: string;
  confidence: string;
  frp: number;
  footprint: string;
};

type LiveThermalDetection = {
  id: string;
  lat: number;
  lon: number;
  sensor: string;
  satellite: string;
  observedAt: string;
  confidence: string;
  frpMw: number | null;
  scanKm: number | null;
  trackKm: number | null;
  daynight: string | null;
};

type ThermalPayload = {
  generatedAt: string;
  mode: "firms-area-api" | "gibs-wms-fallback";
  latestObservedAt: string | null;
  detections: LiveThermalDetection[];
  errors: string[];
  source: {
    label: string;
    docs: string;
    refreshMinutes: number;
    typicalLatencyHours: number;
  };
};

type LiveUpdateItem = {
  id: string;
  title: string;
  summary: string;
  url: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: "local-reporting" | "official-context";
  publishedAt: string | null;
  modifiedAt: string | null;
  timeQuality: "exact" | "date-only" | "feed-order-only";
  latestUpdateLabel: string | null;
};

type UpdatesPayload = {
  generatedAt: string;
  localTimeZone: "Europe/Athens";
  refreshSeconds: number;
  officialAlert: {
    issuedAt: string;
    lastManuallyVerifiedAt: string;
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
    kind: "local-reporting" | "official-context";
    timeQuality: string;
    fetchedAt: string | null;
    channelUpdatedAt: string | null;
    status: "ok" | "error";
  }>;
  items: LiveUpdateItem[];
  errors: string[];
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

const THERMAL_DETECTIONS: ThermalDetection[] = [
  {
    id: "snpp-1",
    point: [38.99092, 26.38489],
    sensor: "Suomi-NPP VIIRS",
    pass: "14:57",
    confidence: "Nominal",
    frp: 5.08,
    footprint: "0.54 × 0.51 km",
  },
  {
    id: "snpp-2",
    point: [38.9858, 26.37997],
    sensor: "Suomi-NPP VIIRS",
    pass: "14:57",
    confidence: "Nominal",
    frp: 19.92,
    footprint: "0.54 × 0.51 km",
  },
  {
    id: "snpp-3",
    point: [38.98624, 26.38598],
    sensor: "Suomi-NPP VIIRS",
    pass: "14:57",
    confidence: "Nominal",
    frp: 19.92,
    footprint: "0.54 × 0.51 km",
  },
  {
    id: "snpp-4",
    point: [38.98112, 26.38098],
    sensor: "Suomi-NPP VIIRS",
    pass: "14:57",
    confidence: "Nominal",
    frp: 19.92,
    footprint: "0.54 × 0.51 km",
  },
  {
    id: "snpp-5",
    point: [38.98936, 26.38072],
    sensor: "Suomi-NPP VIIRS",
    pass: "14:57",
    confidence: "Nominal",
    frp: 11.7,
    footprint: "0.54 × 0.51 km",
  },
  {
    id: "snpp-6",
    point: [38.98982, 26.38652],
    sensor: "Suomi-NPP VIIRS",
    pass: "14:57",
    confidence: "Nominal",
    frp: 24.48,
    footprint: "0.54 × 0.51 km",
  },
  {
    id: "snpp-7",
    point: [38.98468, 26.38161],
    sensor: "Suomi-NPP VIIRS",
    pass: "14:57",
    confidence: "Nominal",
    frp: 10.97,
    footprint: "0.54 × 0.51 km",
  },
  {
    id: "snpp-8",
    point: [38.98516, 26.38771],
    sensor: "Suomi-NPP VIIRS",
    pass: "14:57",
    confidence: "High",
    frp: 17.66,
    footprint: "0.54 × 0.51 km",
  },
  {
    id: "noaa20-1",
    point: [38.98045, 26.3883],
    sensor: "NOAA-20 VIIRS",
    pass: "15:17",
    confidence: "High",
    frp: 22.38,
    footprint: "0.60 × 0.70 km",
  },
  {
    id: "noaa20-2",
    point: [38.98028, 26.38137],
    sensor: "NOAA-20 VIIRS",
    pass: "15:17",
    confidence: "Nominal",
    frp: 31.26,
    footprint: "0.60 × 0.70 km",
  },
  {
    id: "noaa20-3",
    point: [38.98696, 26.38648],
    sensor: "NOAA-20 VIIRS",
    pass: "15:17",
    confidence: "High",
    frp: 22.38,
    footprint: "0.60 × 0.70 km",
  },
  {
    id: "noaa20-4",
    point: [38.97919, 26.38359],
    sensor: "NOAA-20 VIIRS",
    pass: "15:17",
    confidence: "Nominal",
    frp: 20.63,
    footprint: "0.60 × 0.70 km",
  },
  {
    id: "noaa20-5",
    point: [38.98586, 26.38887],
    sensor: "NOAA-20 VIIRS",
    pass: "15:17",
    confidence: "High",
    frp: 32.26,
    footprint: "0.60 × 0.71 km",
  },
  {
    id: "noaa20-6",
    point: [38.98572, 26.38212],
    sensor: "NOAA-20 VIIRS",
    pass: "15:17",
    confidence: "Nominal",
    frp: 20.63,
    footprint: "0.60 × 0.70 km",
  },
  {
    id: "modis-1",
    point: [38.98641, 26.3782],
    sensor: "Aqua MODIS",
    pass: "16:06",
    confidence: "63%",
    frp: 32.94,
    footprint: "1.22 × 1.10 km",
  },
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
    label: "Latest official 112 instruction",
    detail:
      "People in the Plomari area were instructed to move toward Plomari beach in the direction of Agios Isidoros. No official cancellation or all-clear had been found at the latest manual review.",
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
    label: "Τελευταία επίσημη οδηγία 112",
    detail:
      "Όσοι βρίσκονταν στην περιοχή Πλωμαρίου κλήθηκαν να απομακρυνθούν προς την παραλία Πλωμαρίου με κατεύθυνση τον Άγιο Ισίδωρο. Κατά τον τελευταίο χειροκίνητο έλεγχο δεν είχε εντοπιστεί επίσημη άρση ή λήξη συναγερμού.",
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
    kind: "Latest official instruction · 16:58",
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
    kind: "Τελευταία επίσημη οδηγία · 16:58",
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
  kind: "fire" | "settlement" | "arrow" | "wind",
  label: string,
) {
  return `<div class="map-marker map-marker--${kind}"><span></span><b>${label}</b></div>`;
}

function localize(language: Language, english: string, greek: string) {
  return language === "el" ? greek : english;
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
  return new Intl.DateTimeFormat(language === "el" ? "el-GR" : "en-GB", {
    timeZone: "Europe/Athens",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function utcDate(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function compass(degrees: number, language: Language = "en") {
  const points =
    language === "el"
      ? ["Β", "ΒΑ", "Α", "ΝΑ", "Ν", "ΝΔ", "Δ", "ΒΔ"]
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
    },
    "partial-control": {
      en: "PARTIAL CONTROL",
      el: "ΜΕΡΙΚΟΣ ΕΛΕΓΧΟΣ",
    },
    "full-control": {
      en: "UNDER CONTROL",
      el: "ΥΠΟ ΕΛΕΓΧΟ",
    },
    ended: {
      en: "ENDED",
      el: "ΛΗΞΗ ΣΥΜΒΑΝΤΟΣ",
    },
  } as const;
  return labels[status][language];
}

export default function Home() {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const operationalGroup = useRef<LayerGroup | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);

  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState("");
  const [baseMode, setBaseMode] = useState<BaseMode>("satellite");
  const [language, setLanguage] = useState<Language>("en");
  const [compact, setCompact] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [intelOpen, setIntelOpen] = useState(true);
  const [activeIntel, setActiveIntel] = useState("overnight-hotspots");
  const [windData, setWindData] = useState<WindPayload | null>(null);
  const [windError, setWindError] = useState(false);
  const [updatesData, setUpdatesData] = useState<UpdatesPayload | null>(null);
  const [updatesError, setUpdatesError] = useState(false);
  const [thermalData, setThermalData] = useState<ThermalPayload | null>(null);
  const [thermalError, setThermalError] = useState(false);
  const [satelliteEpoch, setSatelliteEpoch] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    official: true,
    satellite: true,
    local: true,
    wind: true,
    smokeObserved: false,
    smoke: true,
    simulation: false,
  });
  const [hour, setHour] = useState(2);
  const [beaufort, setBeaufort] = useState(6);
  const [heading, setHeading] = useState(218);
  const [smokeMinutes, setSmokeMinutes] = useState(15);

  const scenarioDistance = useMemo(
    () => Number((spreadRates[beaufort] * hour).toFixed(1)),
    [beaufort, hour],
  );
  const staticIntel = language === "el" ? intelEl : intelEn;
  const localizedSources = language === "el" ? sourcesEl : sourcesEn;
  const displayIntel = useMemo<IntelItem[]>(() => {
    const liveItems =
      updatesData?.items.slice(0, 6).map((item) => {
        const timestamp = item.modifiedAt ?? item.publishedAt;
        const detailPrefix =
          item.sourceKind === "official-context"
            ? localize(
                language,
                "Official context feed; not a 112 dispatch. ",
                "Επίσημη ροή ενημέρωσης· δεν αποτελεί ειδοποίηση 112. ",
              )
            : localize(
                language,
                "Near-real-time local reporting; not independently confirmed. ",
                "Σχεδόν ζωντανή τοπική ενημέρωση· δεν έχει επιβεβαιωθεί ανεξάρτητα. ",
              );
        return {
          id: `feed-${item.id}`,
          time:
            item.latestUpdateLabel ??
            (timestamp ? formatGreeceTime(timestamp) : "RSS"),
          label: item.title,
          detail: `${detailPrefix}${item.summary}`,
          confidence:
            item.sourceKind === "official-context"
              ? ("official" as const)
              : ("reported" as const),
          sourceUrl: item.url,
          sourceLabel: item.sourceLabel,
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
            ).toLocaleLowerCase(language === "el" ? "el-GR" : "en-GB")}${
              updatesData.fireServiceIncident.sourceAge
                ? localize(
                    language,
                    `; source-reported update age ${updatesData.fireServiceIncident.sourceAge}`,
                    `· ηλικία ενημέρωσης πηγής ${updatesData.fireServiceIncident.sourceAge}`,
                  )
                : ""
            }. ${localize(
              language,
              "The board does not provide a perimeter or public route instruction.",
              "Ο πίνακας δεν παρέχει περίμετρο ούτε δημόσια οδηγία διαδρομής.",
            )}`,
            confidence: "official" as const,
            sourceUrl: updatesData.fireServiceIncident.sourceUrl,
            sourceLabel: "Hellenic Fire Service",
          },
        ]
      : [];

    return [...fireService, ...liveItems, ...staticIntel];
  }, [language, staticIntel, updatesData]);
  const active =
    displayIntel.find((item) => item.id === activeIntel) ?? displayIntel[0];
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
  const thermalDetections = useMemo<LiveThermalDetection[]>(
    () =>
      thermalData?.detections.length
        ? thermalData.detections
        : THERMAL_DETECTIONS.map((detection) => ({
            id: `snapshot-${detection.id}`,
            lat: detection.point[0],
            lon: detection.point[1],
            sensor: detection.sensor,
            satellite: detection.sensor,
            observedAt: `2026-07-29T${detection.pass}:00+03:00`,
            confidence: detection.confidence,
            frpMw: detection.frp,
            scanKm: Number(detection.footprint.split(" × ")[0]),
            trackKm: Number(
              detection.footprint.split(" × ")[1]?.split(" ")[0],
            ),
            daynight: null,
          })),
    [thermalData],
  );
  const thermalLatestTime = formatGreeceTime(
    thermalData?.latestObservedAt ?? thermalDetections[0]?.observedAt,
  );
  const updatesRetrievedTime = formatGreeceTime(updatesData?.generatedAt);
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
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem("firewatch-language");
      const nextLanguage =
        stored === "en" || stored === "el"
          ? stored
          : navigator.language.toLowerCase().startsWith("el")
            ? "el"
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
          setThermalError(payload.errors.length > 0);
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
            "112 direction: Plomari beach → Agios Isidoros · follow authorities on the ground",
            "Κατεύθυνση 112: παραλία Πλωμαρίου → Άγιος Ισίδωρος · ακολουθείτε τις επί τόπου οδηγίες των Αρχών",
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
            localize(language, "112 DIRECTION →", "ΚΑΤΕΥΘΥΝΣΗ 112 →"),
          ),
          iconSize: [130, 30],
          iconAnchor: [18, 15],
        }),
      }).addTo(group);
    }

    if (layers.satellite) {
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

      thermalDetections.forEach((detection) => {
        const high =
          detection.confidence === "High" || (detection.frpMw ?? 0) >= 30;
        const footprint =
          detection.scanKm !== null && detection.trackKm !== null
            ? `${detection.scanKm.toFixed(2)} × ${detection.trackKm.toFixed(2)} km`
            : localize(
                language,
                "nominal 375 m pixel",
                "ονομαστικό εικονοστοιχείο 375 m",
              );
        L.circleMarker([detection.lat, detection.lon], {
          radius: high ? 7 : 5,
          color: high ? "#ff3b24" : "#ff9f1c",
          weight: high ? 2 : 1.5,
          fillColor: high ? "#ff3b24" : "#ffb23f",
          fillOpacity: high ? 0.72 : 0.52,
        })
          .bindPopup(
            `<div class="popup-copy"><strong>${detection.sensor}</strong><br>${formatGreeceDateTime(detection.observedAt, language)} ${localize(
              language,
              "Greece",
              "ώρα Ελλάδας",
            )} · ${detection.confidence}<br>FRP ${detection.frpMw?.toFixed(2) ?? "—"} MW<br><span>${footprint} · ${localize(
              language,
              "satellite pixel center, not a perimeter or proof of current flame",
              "κέντρο δορυφορικού εικονοστοιχείου, όχι περίμετρος ούτε απόδειξη ενεργής φλόγας",
            )}</span></div>`,
          )
          .addTo(group);
      });
    }

    if (layers.local) {
      L.polyline([AGIOS_ANTONIOS, MEGALOCHORI], {
        color: "#ffb347",
        weight: 2,
        opacity: 0.86,
        dashArray: "7 10",
      })
        .bindTooltip(
          localize(
            language,
            "20:50 local report: scattered hotspots near Agios Antonios and in the direction of Megalochori · not a continuous fire perimeter",
            "Τοπική αναφορά 20:50: διάσπαρτες ενεργές εστίες κοντά στον Άγιο Αντώνιο και προς το Μεγαλοχώρι · δεν αποτελεί ενιαία περίμετρο πυρκαγιάς",
          ),
          { sticky: true },
        )
        .addTo(group);
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
                "REPORTED HOTSPOT AREA",
                "ΑΝΑΦΕΡΘΕΙΣΑ ΠΕΡΙΟΧΗ ΕΝΕΡΓΩΝ ΕΣΤΙΩΝ",
              )}</strong><br>${localize(
                language,
                "Observed in local field reporting at 20:50.",
                "Παρατηρήθηκε σε τοπική επιτόπια ενημέρωση στις 20:50.",
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
            localize(language, "HOTSPOTS · 20:50", "ΕΝΕΡΓΕΣ ΕΣΤΙΕΣ · 20:50"),
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
            localize(
              language,
              `${label} Open-Meteo point model: from ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) toward ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · valid ${windObservedTime} Greece`,
              `${label} σημειακό μοντέλο Open-Meteo: από ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) προς ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · ισχύει για ${windObservedTime} ώρα Ελλάδας`,
            ),
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
            )} ${metar.gustKt ?? "—"} kt<br><span>${localize(
              language,
              `Observed ${formatGreeceTime(metar.observedAt)} Greece at Mytilene airport; conditions at the fire can differ.`,
              `Παρατήρηση ${formatGreeceTime(metar.observedAt)} ώρα Ελλάδας στο αεροδρόμιο Μυτιλήνης· οι συνθήκες στην πυρκαγιά μπορεί να διαφέρουν.`,
            )}<br>${metar.raw}</span></div>`,
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
          localize(
            language,
            `Modeled smoke-transport proxy · ${smokeMinutes} min · ${smokeDistance.toFixed(1)} km at 10 m model wind · not measured PM2.5 or fire spread`,
            `Ενδεικτικό μοντέλο μεταφοράς καπνού · ${smokeMinutes} λεπτά · ${smokeDistance.toFixed(1)} km με μοντέλο ανέμου στα 10 m · όχι μέτρηση PM2.5 ούτε πρόγνωση εξάπλωσης πυρκαγιάς`,
          ),
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
          localize(
            language,
            `WHAT-IF ONLY · +${hour}h · ${beaufort} Bft · not a forecast`,
            `ΜΟΝΟ ΥΠΟΘΕΤΙΚΟ ΣΕΝΑΡΙΟ · +${hour}ω · ${beaufort} Bft · όχι πρόγνωση`,
          ),
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

  const mobileSheetOpen = compact && (panelOpen || intelOpen);

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
            <div
              className="language-switch"
              role="group"
              aria-label={localize(language, "Language", "Γλώσσα")}
            >
              <button
                type="button"
                className={language === "el" ? "is-active" : ""}
                onClick={() => changeLanguage("el")}
                aria-pressed={language === "el"}
                lang="el"
              >
                ΕΛ
              </button>
              <button
                type="button"
                className={language === "en" ? "is-active" : ""}
                onClick={() => changeLanguage("en")}
                aria-pressed={language === "en"}
                lang="en"
              >
                EN
              </button>
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

      <section
        className="evacuation-banner"
        aria-label={localize(
          language,
          "Official evacuation instruction",
          "Επίσημη οδηγία απομάκρυνσης",
        )}
      >
        <div className="evacuation-code">112</div>
        <div className="evacuation-copy">
          <strong lang="el">
            ΑΝ ΒΡΙΣΚΕΣΤΕ ΣΤΗΝ ΠΕΡΙΟΧΗ, ΑΠΟΜΑΚΡΥΝΘΕΙΤΕ ΠΡΟΣ ΤΗΝ ΠΑΡΑΛΙΑ
            ΠΛΩΜΑΡΙΟΥ ΜΕ ΚΑΤΕΥΘΥΝΣΗ ΤΟΝ ΑΓΙΟ ΙΣΙΔΩΡΟ.
          </strong>
          <strong className="evacuation-copy__secondary" lang="en">
            IF YOU ARE IN THE AREA, MOVE TOWARD PLOMARI BEACH IN THE DIRECTION
            OF AGIOS ISIDOROS.
          </strong>
          <a
            className="official-alert-link official-alert-link--mobile"
            href="https://x.com/112Greece/status/2082468150189167080"
            target="_blank"
            rel="noreferrer"
          >
            112 {localize(language, "source", "πηγή")} ↗
          </a>
          <span>
            {localize(
              language,
              `Issued 16:58 · no official cancellation found as of ${officialVerifiedTime === "—" ? "the latest review" : officialVerifiedTime}. Follow authorities on the ground; this map does not certify that a route is safe.`,
              `Εκδόθηκε στις 16:58 · δεν έχει εντοπιστεί επίσημη άρση έως ${officialVerifiedTime === "—" ? "τον τελευταίο έλεγχο" : `τις ${officialVerifiedTime}`}. Ακολουθείτε τις επί τόπου οδηγίες των Αρχών· ο χάρτης δεν πιστοποιεί ότι κάποια διαδρομή είναι ασφαλής.`,
            )}{" "}
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
                  "7 LAYERS // SOURCE + FRESHNESS VISIBLE",
                  "7 ΕΠΙΠΕΔΑ // ΟΡΑΤΗ ΠΗΓΗ + ΩΡΑ ΕΝΗΜΕΡΩΣΗΣ",
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
                  "Official · 16:58",
                  "Επίσημη · 16:58",
                ),
                count: "1",
              },
              {
                key: "satellite" as LayerKey,
                icon: "✦",
                label: localize(
                  language,
                  "Thermal detections",
                  "Θερμικές ανιχνεύσεις",
                ),
                detail: `${thermalError ? localize(language, "Fallback / retrying", "Εφεδρικά δεδομένα / νέα προσπάθεια") : "NASA FIRMS NRT"} · ${localize(language, "latest", "τελευταία")} ${thermalLatestTime}`,
                count: String(thermalDetections.length),
              },
              {
                key: "local" as LayerKey,
                icon: "△",
                label: localize(
                  language,
                  "Reported hotspots",
                  "Αναφερθείσες ενεργές εστίες",
                ),
                detail: localize(
                  language,
                  "Local field report · 20:50",
                  "Τοπική αναφορά από το πεδίο · 20:50",
                ),
                count: "2",
              },
              {
                key: "wind" as LayerKey,
                icon: "↙",
                label: localize(
                  language,
                  "Wind profile",
                  "Προφίλ ανέμου",
                ),
                detail: localize(
                  language,
                  `Model valid ${windObservedTime} · polls 5 min`,
                  `Μοντέλο για ${windObservedTime} · ενημέρωση κάθε 5 λεπτά`,
                ),
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
                  : localize(
                      language,
                      `VALID ${windObservedTime}`,
                      `ΕΓΚΥΡΟ ΓΙΑ ${windObservedTime}`,
                    )}
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
              {localize(
                language,
                `From ${compass(fireWind.wind10.directionDeg, language)} toward ${compass(downwindHeading, language)}. Point-model wind is not fire spread; terrain and gusts can change local flow. Retrieved ${
                  retrievedTime === "—" ? "pending" : `${retrievedTime} Greece`
                }.`,
                `Από ${compass(fireWind.wind10.directionDeg, language)} προς ${compass(downwindHeading, language)}. Το μοντέλο ανέμου σε σημείο δεν προβλέπει την εξάπλωση της φωτιάς· το ανάγλυφο και οι ριπές μπορούν να μεταβάλουν την τοπική ροή. Ανάκτηση ${
                  retrievedTime === "—" ? "εκκρεμεί" : `${retrievedTime} ώρα Ελλάδας`
                }.`,
              )}
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
          className={!panelOpen && !intelOpen ? "is-active" : ""}
          onClick={closePanels}
          aria-pressed={!panelOpen && !intelOpen}
        >
          <span aria-hidden="true">◎</span>
          <b>{localize(language, "MAP", "ΧΑΡΤΗΣ")}</b>
        </button>
        <button
          type="button"
          className={panelOpen ? "is-active" : ""}
          onClick={() => {
            setPanelOpen((value) => !value);
            setIntelOpen(false);
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
          }}
          aria-expanded={intelOpen}
          aria-controls="intel-sheet"
        >
          <span aria-hidden="true">≡</span>
          <b>{localize(language, "UPDATES", "ΕΝΗΜΕΡΩΣΕΙΣ")}</b>
        </button>
      </nav>

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
                {localize(language, "GREECE TIME", "ΩΡΑ ΕΛΛΑΔΑΣ")}
                {" // "}
                {updatesError
                  ? localize(
                      language,
                      "SNAPSHOT · RETRYING",
                      "ΣΤΙΓΜΙΟΤΥΠΟ · ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ",
                    )
                  : localize(
                      language,
                      `RSS POLL ${updatesRetrievedTime}`,
                      `ΕΛΕΓΧΟΣ RSS ${updatesRetrievedTime}`,
                    )}
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

          <div className="intel-list">
            {displayIntel.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === activeIntel ? "intel-item is-active" : "intel-item"}
                onClick={() => setActiveIntel(item.id)}
              >
                <time>{item.time}</time>
                <span>
                  <strong>{item.label}</strong>
                  <small>{confidenceLabel(item.confidence, language)}</small>
                </span>
              </button>
            ))}
          </div>

          <div className={`intel-detail intel-detail--${active.confidence}`}>
            <span>{confidenceLabel(active.confidence, language)}</span>
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
            {localize(language, "THERMAL", "ΘΕΡΜΙΚΑ")} · {thermalLatestTime}
          </span>
          <strong>
            {thermalDetections.length}{" "}
            {localize(
              language,
              "NASA PIXELS",
              "ΔΟΡΥΦΟΡΙΚΑ ΕΙΚΟΝΟΣΤΟΙΧΕΙΑ NASA",
            )}
          </strong>
          <small>
            {localize(
              language,
              "Poll 5 min · satellite latency typically ≤3h",
              "Έλεγχος κάθε 5 λεπτά · συνήθης δορυφορική καθυστέρηση έως 3 ώρες",
            )}
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
            {localize(
              language,
              "Local RSS + official feeds · timestamps in Greece time",
              "Τοπικό RSS + επίσημες ροές · ώρες Ελλάδας",
            )}
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
