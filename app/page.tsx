"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type {
  LayerGroup,
  Map as LeafletMap,
  TileLayer,
  WMSOptions,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import { GlobalDiscoveryLink } from "@/components/firewatch/GlobalDiscoveryLink";
import { MobileLocationSummary } from "@/components/firewatch/MobileLocationSummary";
import {
  LIVE_AS_OF,
  asOfEpochFromRangeValue,
  effectiveAsOfEpoch,
  filterAtOrBefore,
  isTimestampVisibleAt,
  latestAtOrBefore,
  timestampEpoch,
  type AsOfSelection,
} from "@/lib/as-of";
import {
  formatAreaDate,
  formatAreaDateTime,
  formatElapsedMinutes,
  normalizeAthensWallTime,
  presentAreaDateTime,
  zonedDateTimeAttribute,
} from "@/lib/area-time";
import { DEMAND_INTERVALS_MS } from "@/lib/firewatch/demand-policy";
import { initialArchivedAlertCollapsed } from "@/lib/firewatch/incident-ui";
import { coarseAreaCellForLocation } from "@/lib/firewatch/map-context";
import { footprintLeafletPolygons } from "@/lib/firewatch/v3/satellite-pass-client";
import { satellitePassPresentationState } from "@/lib/firewatch/v3/satellite-pass-presentation";
import {
  bearingDeg,
  destination,
  distanceKm,
  midpoint,
  nearestPointOnPolyline,
  scenarioShape,
  type LatLngTuple,
} from "@/lib/geo";
import { useSatellitePassArea } from "@/hooks/use-satellite-pass-area";

type Confidence = "official" | "observed" | "reported" | "modeled";
type Language = "en" | "el";
type LayerKey =
  | "official"
  | "evacRoute"
  | "satellite"
  | "satelliteCoverage"
  | "satelliteRaster"
  | "local"
  | "wind"
  | "smokeObserved"
  | "smoke"
  | "simulation";
type BaseMode = "dark" | "satellite" | "terrain";
type ThermalWindow = "latest" | "6h" | "24h";
type LayerTab = "layers" | "thermal" | "wind" | "updates";
type PanelView = LayerTab | "location";
type SnapshotSource = "wind" | "updates" | "thermal";
type SourceErrorCode =
  | "timeout"
  | "authentication"
  | "upstream_forbidden"
  | "rate_limit"
  | "unavailable"
  | "missing_X_BEARER_TOKEN";

const LAYER_TABS: readonly LayerTab[] = [
  "layers",
  "thermal",
  "wind",
  "updates",
];
const SNAPSHOT_HEADER = "X-Firewatch-Snapshot";
const DESKTOP_PANEL_TOP = 170;
const DESKTOP_PANEL_BOTTOM = 130;
const DESKTOP_PANEL_GAP = 12;
const AS_OF_STEP_MS = 15 * 60_000;

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
  timeKind?: string;
  dateOnly?: boolean;
  occurredAt?: string | null;
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

function clientPollingAvailable(allowOfflineSnapshot = false) {
  return (
    document.visibilityState === "visible" &&
    (navigator.onLine || allowOfflineSnapshot)
  );
}

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
    mode?: "live" | "historical";
    date?: string | null;
    requestedUtcDates?: string[];
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
  summary: string;
  summaryEn?: string;
  summaryEl?: string;
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
  collectionMode: "incident-realtime" | "feeds-only";
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
    errorCode: SourceErrorCode | null;
    freshnessPolicy?: string;
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
    code: SourceErrorCode | null;
    message: string;
  }>;
};

const INCIDENT: LatLngTuple = [38.989013, 26.382489];
const INCIDENT_STARTED_AT = "2026-07-29T10:30:00Z";
const INCIDENT_STARTED_EPOCH = Date.parse(INCIDENT_STARTED_AT);
const OFFICIAL_ALERT_ISSUED_AT = "2026-07-29T13:58:00Z";
const FIELD_REPORT_OCCURRED_AT = "2026-07-29T17:50:00Z";
const PLOMARI_BEACH: LatLngTuple = [38.9752, 26.3714];
const AGIOS_ISIDOROS: LatLngTuple = [38.9702, 26.3927];
const MELINTA: LatLngTuple = [38.9875, 26.3131];
const MILIES: LatLngTuple = [38.998, 26.4109];
const PLAGIA: LatLngTuple = [38.98234, 26.39769];
const PERAMA: LatLngTuple = [39.0429, 26.50556];
const AGIOS_ANTONIOS: LatLngTuple = [38.9817634, 26.4073025];
const MEGALOCHORI: LatLngTuple = [39.0173137, 26.3687164];

const STATIC_INTEL_OCCURRED_AT: Record<string, string> = {
  "overnight-hotspots": "2026-07-29T17:50:00Z",
  "no-active-front": "2026-07-29T16:55:00Z",
  homes: "2026-07-29T16:25:00Z",
  smoke: "2026-07-29T14:50:00Z",
  evacuation: OFFICIAL_ALERT_ISSUED_AT,
  reinforced: "2026-07-29T13:34:00Z",
  modis: "2026-07-29T13:06:00Z",
  viirs: "2026-07-29T12:17:00Z",
  ignition: "2026-07-29T11:00:00Z",
};

const CURRENT_ONLY_LAYER_KEYS = new Set<LayerKey>([
  "satelliteCoverage",
  "satelliteRaster",
  "wind",
  "smokeObserved",
  "smoke",
]);

// Road alignment for the archived 29 Jul 2026 16:58 Europe/Athens (UTC+03:00)
// 112 instruction (Plomari beach ->
// Agios Isidoros), traced once via OSRM. The alert named the endpoints,
// not the streets; the map labels this caveat wherever the route shows.
const EVACUATION_ROUTE: LatLngTuple[] = [[38.97519,26.3714],[38.97511,26.37183],[38.97492,26.37179],[38.97505,26.37152],[38.97512,26.37136],[38.97522,26.37117],[38.97531,26.37097],[38.9754,26.37069],[38.97556,26.37019],[38.97565,26.36987],[38.97556,26.36977],[38.97545,26.36967],[38.97527,26.36985],[38.97515,26.37007],[38.97503,26.37014],[38.975,26.37024],[38.97499,26.37043],[38.97499,26.37053],[38.97497,26.37068],[38.97488,26.37096],[38.97478,26.37116],[38.97468,26.37132],[38.97458,26.37157],[38.97441,26.3722],[38.97433,26.37257],[38.97427,26.37286],[38.97424,26.37306],[38.97413,26.3734],[38.97412,26.37362],[38.97411,26.37375],[38.97413,26.37423],[38.97416,26.37456],[38.97418,26.37478],[38.97418,26.37499],[38.97407,26.3753],[38.97402,26.37561],[38.97404,26.37588],[38.97403,26.37597],[38.9739,26.37621],[38.97383,26.37633],[38.97382,26.37638],[38.97382,26.37643],[38.97385,26.37652],[38.97422,26.377],[38.97431,26.37713],[38.97429,26.37722],[38.97416,26.3774],[38.97396,26.3777],[38.97386,26.37785],[38.97379,26.37795],[38.97348,26.37844],[38.97301,26.37922],[38.97291,26.37948],[38.97294,26.37977],[38.97292,26.37987],[38.97258,26.38018],[38.97227,26.38054],[38.97215,26.38068],[38.97212,26.38079],[38.97209,26.38093],[38.97209,26.38103],[38.97211,26.38109],[38.97219,26.38121],[38.9723,26.38129],[38.97254,26.38142],[38.9726,26.38146],[38.97263,26.38149],[38.97266,26.38152],[38.97266,26.38162],[38.97265,26.38169],[38.97261,26.38175],[38.97256,26.38179],[38.97186,26.38197],[38.97158,26.382],[38.97154,26.38202],[38.97151,26.38206],[38.97147,26.38211],[38.97145,26.38218],[38.97147,26.38321],[38.97146,26.38351],[38.97152,26.38383],[38.97152,26.38397],[38.97145,26.38433],[38.97144,26.38443],[38.97144,26.3847],[38.97149,26.3855],[38.97149,26.38566],[38.97147,26.38584],[38.97143,26.38602],[38.97136,26.38614],[38.97108,26.38631],[38.97092,26.38647],[38.97084,26.38664],[38.97078,26.38681],[38.97055,26.38761],[38.97041,26.38788],[38.97027,26.38807],[38.97012,26.38824],[38.97001,26.38838],[38.96966,26.38898],[38.96952,26.38913],[38.96942,26.38921],[38.96933,26.38925],[38.96912,26.3893],[38.96894,26.38937],[38.96885,26.38945],[38.96867,26.3898],[38.96847,26.39031],[38.96841,26.39059],[38.96839,26.39087],[38.9684,26.39107],[38.96843,26.3914],[38.96892,26.39187],[38.96893,26.39197],[38.96895,26.39199],[38.969,26.39198],[38.96915,26.39188],[38.96951,26.39179],[38.97006,26.39165],[38.97037,26.39158],[38.97048,26.39155],[38.9705,26.3916],[38.9705,26.39165],[38.97048,26.3917],[38.97015,26.39197],[38.96995,26.39216],[38.96986,26.39227]];

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
    time: "29 Jul 2026 · 20:50 · Europe/Athens · UTC+03:00",
    label: "Aerial drops ended; scattered hotspots remain",
    detail:
      "Local field reporting says aerial operations ended for the night, with scattered active hotspots around Agios Antonios and toward Megalochori. Strong winds are hampering ground crews. This is not an official containment statement.",
    confidence: "reported",
  },
  {
    id: "no-active-front",
    time: "29 Jul 2026 · 19:55 · Europe/Athens · UTC+03:00",
    label: "No continuous front reported; rekindling risk",
    detail:
      "The deputy regional governor reported no active continuous front, but numerous scattered hotspots remained in difficult terrain. Crews stayed alert for rekindling. This was a local official statement, not a Fire Service all-clear.",
    confidence: "reported",
  },
  {
    id: "homes",
    time: "29 Jul 2026 · 19:25 · Europe/Athens · UTC+03:00",
    label: "Hotspots reported near holiday homes",
    detail:
      "Local reporting said hotspots remained above Plomari near holiday homes. Residents and volunteers reportedly prevented flames from reaching houses.",
    confidence: "reported",
  },
  {
    id: "smoke",
    time: "29 Jul 2026 · 17:50 · Europe/Athens · UTC+03:00",
    label: "Regional satellite smoke observed",
    detail:
      "Satellite imagery showed smoke from the Plomari incident and a major Turkish fire transported across Lesvos. This is a regional smoke snapshot, not a ground-level PM2.5 measurement.",
    confidence: "observed",
  },
  {
    id: "evacuation",
    time: "29 Jul 2026 · 16:58 · Europe/Athens · UTC+03:00",
    label:
      "Official 112 alert issued 29 Jul 2026 at 16:58 · Europe/Athens · UTC+03:00",
    detail:
      "People in the Plomari area were instructed to move toward Plomari beach in the direction of Agios Isidoros. This reproduces the alert issued 29 Jul 2026 at 16:58 · Europe/Athens · UTC+03:00; check the local feed reader and authorities for any newer instruction.",
    confidence: "official",
  },
  {
    id: "reinforced",
    time: "29 Jul 2026 · 16:34 · Europe/Athens · UTC+03:00",
    label: "Fire Service response reinforced",
    detail:
      "Fire Service reported 50 firefighters, two 12th EMODE teams, volunteers, 13 vehicles, three aircraft and three helicopters.",
    confidence: "official",
  },
  {
    id: "modis",
    time: "29 Jul 2026 · 16:06 · Europe/Athens · UTC+03:00",
    label: "Latest satellite heat",
    detail:
      "Aqua MODIS detected active heat near Chalkelia. A satellite point is an observed hot pixel, not a fire perimeter.",
    confidence: "observed",
  },
  {
    id: "viirs",
    time: "29 Jul 2026 · 15:17 · Europe/Athens · UTC+03:00",
    label: "NOAA-20 pass",
    detail:
      "Six VIIRS hot pixels were detected near the incident, including three high-confidence detections.",
    confidence: "observed",
  },
  {
    id: "ignition",
    time: "29 Jul 2026 · 14:00 · Europe/Athens · UTC+03:00",
    label: "Fire reported",
    detail:
      "The incident was reported around the restored Chalkelia landfill, north-east of Plomari.",
    confidence: "official",
  },
];

const intelEl: IntelItem[] = [
  {
    id: "overnight-hotspots",
    time: "29 Ιουλ 2026 · 20:50 · Europe/Athens · UTC+03:00",
    label: "Σταμάτησαν οι εναέριες ρίψεις· παραμένουν διάσπαρτες εστίες",
    detail:
      "Σύμφωνα με τοπική επιτόπια ενημέρωση, οι εναέριες επιχειρήσεις σταμάτησαν για τη νύχτα και παρέμειναν διάσπαρτες ενεργές εστίες γύρω από τον Άγιο Αντώνιο και προς το Μεγαλοχώρι. Οι ισχυροί άνεμοι δυσχεραίνουν τα πεζοπόρα τμήματα. Δεν πρόκειται για επίσημη ανακοίνωση οριοθέτησης.",
    confidence: "reported",
  },
  {
    id: "no-active-front",
    time: "29 Ιουλ 2026 · 19:55 · Europe/Athens · UTC+03:00",
    label: "Δεν αναφέρθηκε ενιαίο μέτωπο· κίνδυνος αναζωπύρωσης",
    detail:
      "Ο αντιπεριφερειάρχης ανέφερε ότι δεν υπήρχε ενεργό ενιαίο μέτωπο, όμως παρέμεναν πολλές διάσπαρτες εστίες σε δύσβατο έδαφος. Οι δυνάμεις παρέμειναν σε επιφυλακή για αναζωπυρώσεις. Ήταν τοπική επίσημη δήλωση, όχι μήνυμα λήξης συναγερμού από την Πυροσβεστική.",
    confidence: "reported",
  },
  {
    id: "homes",
    time: "29 Ιουλ 2026 · 19:25 · Europe/Athens · UTC+03:00",
    label: "Αναφέρθηκαν εστίες κοντά σε εξοχικές κατοικίες",
    detail:
      "Τοπικό ρεπορτάζ ανέφερε ότι παρέμεναν εστίες πάνω από το Πλωμάρι, κοντά σε εξοχικές κατοικίες. Κάτοικοι και εθελοντές φέρονται να εμπόδισαν τις φλόγες να φτάσουν σε σπίτια.",
    confidence: "reported",
  },
  {
    id: "smoke",
    time: "29 Ιουλ 2026 · 17:50 · Europe/Athens · UTC+03:00",
    label: "Δορυφορική παρατήρηση καπνού στην περιοχή",
    detail:
      "Δορυφορική εικόνα έδειξε καπνό από το συμβάν στο Πλωμάρι και από μεγάλη πυρκαγιά στην Τουρκία να μεταφέρεται πάνω από τη Λέσβο. Πρόκειται για περιφερειακή απεικόνιση καπνού, όχι για μέτρηση PM2.5 στο έδαφος.",
    confidence: "observed",
  },
  {
    id: "evacuation",
    time: "29 Ιουλ 2026 · 16:58 · Europe/Athens · UTC+03:00",
    label:
      "Επίσημη ειδοποίηση 112 που εκδόθηκε στις 29 Ιουλ 2026, 16:58 · Europe/Athens · UTC+03:00",
    detail:
      "Όσοι βρίσκονταν στην περιοχή Πλωμαρίου κλήθηκαν να απομακρυνθούν προς την παραλία Πλωμαρίου με κατεύθυνση τον Άγιο Ισίδωρο. Η καταχώριση αναπαράγει την ειδοποίηση της 29 Ιουλ 2026, 16:58 · Europe/Athens · UTC+03:00· ελέγξτε τον τοπικό αναγνώστη ροών και τις Αρχές για κάθε νεότερη οδηγία.",
    confidence: "official",
  },
  {
    id: "reinforced",
    time: "29 Ιουλ 2026 · 16:34 · Europe/Athens · UTC+03:00",
    label: "Ενισχύθηκαν οι δυνάμεις της Πυροσβεστικής",
    detail:
      "Η Πυροσβεστική ανέφερε 50 πυροσβέστες, δύο ομάδες της 12ης ΕΜΟΔΕ, εθελοντές, 13 οχήματα, τρία αεροσκάφη και τρία ελικόπτερα.",
    confidence: "official",
  },
  {
    id: "modis",
    time: "29 Ιουλ 2026 · 16:06 · Europe/Athens · UTC+03:00",
    label: "Νεότερη δορυφορική θερμική ανίχνευση",
    detail:
      "Ο Aqua MODIS ανίχνευσε ενεργή θερμότητα κοντά στα Χαλκέλια. Ένα δορυφορικό σημείο είναι θερμό εικονοστοιχείο και όχι περίμετρος πυρκαγιάς.",
    confidence: "observed",
  },
  {
    id: "viirs",
    time: "29 Ιουλ 2026 · 15:17 · Europe/Athens · UTC+03:00",
    label: "Διέλευση NOAA-20",
    detail:
      "Ανιχνεύθηκαν έξι θερμά εικονοστοιχεία VIIRS κοντά στο συμβάν, τρία από αυτά υψηλής αξιοπιστίας.",
    confidence: "observed",
  },
  {
    id: "ignition",
    time: "29 Ιουλ 2026 · 14:00 · Europe/Athens · UTC+03:00",
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
    kind:
      "Original official alert · issued 29 Jul 2026 · 16:58 · Europe/Athens · UTC+03:00",
  },
  {
    label: "Protective guidance",
    href: "https://civilprotection.gov.gr/112/odigies-prostasias",
    kind: "Official safety instructions",
  },
  {
    label: "Fire Service",
    href: "https://x.com/pyrosvestiki/status/2082459852350066823",
    kind:
      "Official response · published 29 Jul 2026 · 16:34 · Europe/Athens · UTC+03:00",
  },
  {
    label: "Civil Protection X",
    href: "https://x.com/CivPro_GR",
    kind: "Official context feed · not a 112 alert",
  },
  {
    label: "StoNisi overnight",
    href: "https://www.stonisi.gr/post/114624/stamathsan-oi-ripseis-apo-aeros-sthn-fwtia-toy-plwmarioy",
    kind:
      "Local field report · published 29 Jul 2026 · 20:50 · Europe/Athens · UTC+03:00",
  },
  {
    label: "Aeolos",
    href: "https://aeolos.tv/140029/kalyteri-i-eikona-sti-fotia-tou-plomariou-synechizetai-i-machi-me-tis-anazopyroseis/",
    kind: "Local reporting · repeated rekindling",
  },
  {
    label: "Satellite smoke",
    href: "https://www.stonisi.gr/post/115334/kapnos-apo-thn-toyrkia-skepazei-lesvo-kai-xio",
    kind:
      "Regional smoke report · published 29 Jul 2026 · 17:50 · Europe/Athens · UTC+03:00",
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
    kind:
      "Αρχική επίσημη ειδοποίηση · έκδοση 29 Ιουλ 2026 · 16:58 · Europe/Athens · UTC+03:00",
  },
  {
    label: "Οδηγίες προστασίας",
    href: "https://civilprotection.gov.gr/112/odigies-prostasias",
    kind: "Επίσημες οδηγίες ασφάλειας",
  },
  {
    label: "Πυροσβεστικό Σώμα",
    href: "https://x.com/pyrosvestiki/status/2082459852350066823",
    kind:
      "Επίσημη κινητοποίηση · δημοσίευση 29 Ιουλ 2026 · 16:34 · Europe/Athens · UTC+03:00",
  },
  {
    label: "Πολιτική Προστασία X",
    href: "https://x.com/CivPro_GR",
    kind: "Επίσημη ενημέρωση πλαισίου · όχι ειδοποίηση 112",
  },
  {
    label: "StoNisi · νυχτερινή ενημέρωση",
    href: "https://www.stonisi.gr/post/114624/stamathsan-oi-ripseis-apo-aeros-sthn-fwtia-toy-plwmarioy",
    kind:
      "Τοπική επιτόπια ενημέρωση · δημοσίευση 29 Ιουλ 2026 · 20:50 · Europe/Athens · UTC+03:00",
  },
  {
    label: "Aeolos",
    href: "https://aeolos.tv/140029/kalyteri-i-eikona-sti-fotia-tou-plomariou-synechizetai-i-machi-me-tis-anazopyroseis/",
    kind: "Τοπικό ρεπορτάζ · επαναλαμβανόμενες αναζωπυρώσεις",
  },
  {
    label: "Δορυφορική εικόνα καπνού",
    href: "https://www.stonisi.gr/post/115334/kapnos-apo-thn-toyrkia-skepazei-lesvo-kai-xio",
    kind:
      "Περιφερειακή αναφορά καπνού · δημοσίευση 29 Ιουλ 2026 · 17:50 · Europe/Athens · UTC+03:00",
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

type Beaufort = 3 | 4 | 5 | 6 | 7;

const spreadRates: Record<Beaufort, number> = {
  3: 0.28,
  4: 0.42,
  5: 0.58,
  6: 0.78,
  7: 1.02,
};

function isBeaufort(value: number): value is Beaufort {
  return Object.hasOwn(spreadRates, value);
}

const BASEMAPS: Record<
  BaseMode,
  {
    url: string;
    attribution: string;
    maxZoom: number;
    subdomains: string | string[];
  }
> = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    maxZoom: 19,
    subdomains: "abcd",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    // Both public ArcGIS service hosts serve the same World
    // Imagery tiles. Alternating them avoids one HTTP/1.1 connection queue on
    // large screens while preserving the provider and attribution.
    url: "https://{s}.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    subdomains: ["server", "services"],
    attribution:
      "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17,
    subdomains: "abc",
    attribution:
      'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, contours &copy; OpenTopoMap',
  },
};

function markerHtml(
  kind: "fire" | "settlement" | "arrow" | "wind" | "you",
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

function ageLabel(
  ageMinutes: number | null | undefined,
  language: Language,
  reference: "now" | "selected",
) {
  return formatElapsedMinutes(ageMinutes, language, reference);
}

function ageMinutesFromTimestamp(
  value: string | null | undefined,
  nowEpoch: number,
) {
  if (!value) return null;
  const observedEpoch = new Date(value).getTime();
  if (Number.isNaN(observedEpoch)) return null;
  const deltaMinutes = (nowEpoch - observedEpoch) / 60_000;
  return deltaMinutes >= 0
    ? Math.floor(deltaMinutes)
    : Math.ceil(deltaMinutes);
}

function formatUtcDate(epochMs: number, language: Language) {
  return `${new Intl.DateTimeFormat(
    language === "el" ? "el-GR" : "en-GB",
    {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  ).format(new Date(epochMs))} UTC`;
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

const UTC_DAY_MS = 24 * 60 * 60 * 1000;
const THERMAL_PASS_GAP_MS = 10 * 60 * 1000;

function historicalThermalDates(selectedDate: string) {
  const selectedStart = Date.parse(`${selectedDate}T00:00:00Z`);
  const previousDate = utcDate(selectedStart - UTC_DAY_MS);
  return previousDate >= utcDate(INCIDENT_STARTED_EPOCH)
    ? [previousDate, selectedDate]
    : [selectedDate];
}

function thermalConfidenceCounts(
  detections: readonly LiveThermalDetection[],
) {
  return detections.reduce(
    (counts, detection) => {
      counts[detection.confidenceCode] += 1;
      return counts;
    },
    { h: 0, n: 0, l: 0, u: 0 },
  );
}

function numericMedian(values: readonly number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return null;
  if (sorted.length % 2 === 1) return value;
  return ((sorted[middle - 1] ?? value) + value) / 2;
}

function mergeHistoricalThermalPayloads(
  payloads: readonly ThermalPayload[],
  requestedUtcDates: readonly string[],
  selectedDate: string,
): ThermalPayload {
  const base = payloads.at(-1);
  if (!base) throw new Error("Historical thermal response was empty");

  const detectionsById = new Map<string, LiveThermalDetection>();
  payloads.forEach((payload) => {
    payload.detections.forEach((detection) => {
      const observedEpoch = Date.parse(detection.observedAt);
      if (observedEpoch >= INCIDENT_STARTED_EPOCH) {
        detectionsById.set(detection.id, detection);
      }
    });
  });

  const previousByProduct = new Map<
    string,
    { observedEpoch: number; passId: string }
  >();
  const clustered = [...detectionsById.values()]
    .sort((left, right) => {
      if (left.product !== right.product) {
        return left.product.localeCompare(right.product);
      }
      const timeDelta =
        Date.parse(left.observedAt) - Date.parse(right.observedAt);
      return timeDelta || left.id.localeCompare(right.id);
    })
    .map((detection) => {
      const observedEpoch = Date.parse(detection.observedAt);
      const previous = previousByProduct.get(detection.product);
      const passId =
        previous &&
        observedEpoch - previous.observedEpoch <= THERMAL_PASS_GAP_MS
          ? previous.passId
          : `${detection.product}-${detection.observedAt}`;
      previousByProduct.set(detection.product, { observedEpoch, passId });
      return { ...detection, passId };
    });

  const detections = clustered.sort((left, right) => {
    const timeDelta = Date.parse(right.observedAt) - Date.parse(left.observedAt);
    return timeDelta || left.id.localeCompare(right.id);
  });
  const incidentDetections = detections.filter(
    (detection) => detection.scope === "incident",
  );
  const passGroups = detections.reduce((groups, detection) => {
    const records = groups.get(detection.passId) ?? [];
    records.push(detection);
    groups.set(detection.passId, records);
    return groups;
  }, new Map<string, LiveThermalDetection[]>());
  const passes = [...passGroups.entries()]
    .map(([id, records]) => {
      const representative = records[0];
      if (!representative) throw new Error(`Thermal pass ${id} was empty`);
      const frpValues = records
        .map((record) => record.frpMw)
        .filter((value): value is number => value !== null);
      const incidentRecords = records.filter(
        (record) => record.scope === "incident",
      );
      return {
        id,
        platform: representative.sensor,
        satellite: representative.satellite,
        product: representative.product,
        observedAt: representative.observedAt,
        ageMinutes: representative.ageMinutes,
        recordCount: records.length,
        incidentRecordCount: incidentRecords.length,
        byConfidence: thermalConfidenceCounts(records),
        maxFrpMw: frpValues.length ? Math.max(...frpValues) : null,
        medianFrpMw: numericMedian(frpValues),
        dayNight: representative.daynight,
      };
    })
    .sort((left, right) => {
      const timeDelta = Date.parse(right.observedAt) - Date.parse(left.observedAt);
      return timeDelta || left.id.localeCompare(right.id);
    });

  const allOk = payloads.every((payload) => payload.status === "ok");
  const hasUsable = payloads.some(
    (payload) => payload.status === "ok" || payload.status === "partial",
  );
  const allUnconfigured = payloads.every(
    (payload) => payload.status === "unconfigured",
  );
  const status: ThermalPayload["status"] = allOk
    ? "ok"
    : hasUsable
      ? "partial"
      : allUnconfigured
        ? "unconfigured"
        : "upstream-error";
  const retrievedAt =
    payloads.map((payload) => payload.retrievedAt).sort().at(-1) ??
    base.retrievedAt;
  const earliestQueryFrom = Math.min(
    ...payloads.map((payload) => Date.parse(payload.query.from)),
  );
  const latestQueryTo = Math.max(
    ...payloads.map((payload) => Date.parse(payload.query.to)),
  );
  const datasetIds = [
    ...new Set(
      payloads.flatMap((payload) =>
        payload.datasets.map((dataset) => dataset.id),
      ),
    ),
  ].sort();
  const datasets = datasetIds.map((id) => {
    const candidates = payloads.flatMap((payload) =>
      payload.datasets.filter((dataset) => dataset.id === id),
    );
    const primary = candidates.at(-1);
    if (!primary) throw new Error(`Historical thermal dataset ${id} was empty`);
    const records = detections.filter((detection) => detection.product === id);
    const anyOk = candidates.some((candidate) => candidate.status === "ok");
    const candidatesUnconfigured = candidates.every(
      (candidate) => candidate.status === "unconfigured",
    );
    return {
      ...primary,
      status: anyOk
        ? ("ok" as const)
        : candidatesUnconfigured
          ? ("unconfigured" as const)
          : ("error" as const),
      records: records.length,
      latestObservedAt: records[0]?.observedAt ?? null,
      errorCode:
        anyOk
          ? null
          : (candidates.find((candidate) => candidate.errorCode)?.errorCode ??
            null),
    };
  });
  const errorsByKey = new Map<string, ThermalPayload["errors"][number]>();
  payloads.flatMap((payload) => payload.errors).forEach((error) => {
    errorsByKey.set(
      `${error.dataset ?? ""}|${error.code ?? ""}|${error.message}`,
      error,
    );
  });
  const errors = [...errorsByKey.values()].sort((left, right) => {
    const leftKey = `${left.dataset ?? ""}|${left.code ?? ""}|${left.message}`;
    const rightKey = `${right.dataset ?? ""}|${right.code ?? ""}|${right.message}`;
    return leftKey.localeCompare(rightKey);
  });
  const latestObservedAt = detections[0]?.observedAt ?? null;
  const latestIncidentObservedAt = incidentDetections[0]?.observedAt ?? null;

  return {
    ...base,
    status,
    requestStartedAt:
      payloads.map((payload) => payload.requestStartedAt).sort()[0] ??
      base.requestStartedAt,
    retrievedAt,
    query: {
      ...base.query,
      mode: "historical",
      date: selectedDate,
      requestedUtcDates: [...requestedUtcDates],
      from: new Date(
        Math.max(earliestQueryFrom, INCIDENT_STARTED_EPOCH),
      ).toISOString(),
      to: new Date(latestQueryTo).toISOString(),
    },
    latestObservedAt,
    latestIncidentObservedAt,
    observationAgeMinutes: latestIncidentObservedAt
      ? Math.max(
          0,
          Math.round(
            (Date.parse(retrievedAt) - Date.parse(latestIncidentObservedAt)) /
              60_000,
          ),
        )
      : null,
    complete: status === "ok" && payloads.every((payload) => payload.complete),
    datasets,
    summary: {
      incidentRecords: incidentDetections.length,
      regionalRecords: detections.length - incidentDetections.length,
      passCount: passes.filter((pass) => pass.incidentRecordCount > 0).length,
      byConfidence: thermalConfidenceCounts(incidentDetections),
    },
    passes,
    detections,
    errors,
  };
}

function compass(degrees: number, language: Language = "en") {
  const points =
    language === "el"
      ? ["Β", "ΒΑ", "Α", "ΝΑ", "Ν", "ΝΔ", "Δ", "ΒΔ"]
      : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

function compassBearing(
  degrees: number | null,
  language: Language = "en",
): string | null {
  // A coincident or antipodal target has no safe direction to display.
  return degrees === null ? null : (compass(degrees, language) ?? null);
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
  const baseLayerRef = useRef<TileLayer | null>(null);
  const lastAutoSelectedLive = useRef<string | null>(null);
  const geoWatchId = useRef<number | null>(null);
  const pendingThermalAsOfEpoch = useRef<number | null>(null);
  const seenActionIds = useRef<Set<string> | null>(null);
  const panelElement = useRef<HTMLElement | null>(null);

  const [ready, setReady] = useState(false);
  const [baseTilesReady, setBaseTilesReady] = useState(false);
  const [baseTilesFailed, setBaseTilesFailed] = useState(false);
  const [clockEpoch, setClockEpoch] = useState<number | null>(null);
  const [ageEpoch, setAgeEpoch] = useState(() => Date.now());
  const [asOfEpoch, setAsOfEpoch] = useState<number | null>(null);
  const [committedThermalAsOfEpoch, setCommittedThermalAsOfEpoch] = useState<
    number | null
  >(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [baseMode, setBaseMode] = useState<BaseMode>("satellite");
  const [language, setLanguage] = useState<Language>("en");
  const [compact, setCompact] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
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
  const [snapshotSources, setSnapshotSources] = useState<
    Record<SnapshotSource, boolean>
  >({ wind: false, updates: false, thermal: false });
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    official: true,
    evacRoute: false,
    satellite: true,
    satelliteCoverage: false,
    satelliteRaster: false,
    local: true,
    wind: true,
    smokeObserved: false,
    smoke: true,
    simulation: false,
  });
  const [hour, setHour] = useState(2);
  const [beaufort, setBeaufort] = useState<Beaufort>(6);
  const [heading, setHeading] = useState(218);
  const [smokeMinutes, setSmokeMinutes] = useState(15);
  const [geoStatus, setGeoStatus] = useState<
    "off" | "locating" | "on" | "denied" | "error"
  >("off");
  const [userPosition, setUserPosition] = useState<{
    lat: number;
    lon: number;
    accuracyM: number;
  } | null>(null);
  const [actionAlerts, setActionAlerts] = useState<LiveUpdateItem[]>([]);
  const actionAlert = actionAlerts[0] ?? null;
  const [wireBadge, setWireBadge] = useState(false);
  const [layerTab, setLayerTab] = useState<PanelView>("layers");
  const [alertCollapsed, setAlertCollapsed] = useState(false);
  const [alertPreferenceReady, setAlertPreferenceReady] = useState(false);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const panelDrag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const updatesStaleSnapshot = updatesError || snapshotSources.updates;
  const windStaleSnapshot = windError || snapshotSources.wind;

  const scenarioDistance = useMemo(
    () => Number((spreadRates[beaufort] * hour).toFixed(1)),
    [beaufort, hour],
  );
  const asOfSelection = useMemo<AsOfSelection>(
    () =>
      asOfEpoch === null
        ? LIVE_AS_OF
        : { mode: "historical", epochMs: asOfEpoch },
    [asOfEpoch],
  );
  const isLive = asOfSelection.mode === "live";
  const satelliteAreaCell = useMemo(
    () =>
      coarseAreaCellForLocation(
        userPosition?.lat ?? INCIDENT[0],
        userPosition?.lon ?? INCIDENT[1],
      ),
    [userPosition],
  );
  const satellitePassArea = useSatellitePassArea(
    satelliteAreaCell.cellKey,
    isLive,
  );
  const effectiveEpoch = effectiveAsOfEpoch(asOfSelection, ageEpoch);
  const clockIso =
    clockEpoch === null ? null : new Date(clockEpoch).toISOString();
  const clock = formatAreaDateTime(clockIso, language, {
    includeOffset: true,
    includeSeconds: true,
    includeWeekday: true,
  });
  const thermalRequestDate =
    committedThermalAsOfEpoch === null
      ? null
      : utcDate(committedThermalAsOfEpoch);
  const asOfLabel = formatAreaDateTime(
    new Date(effectiveEpoch).toISOString(),
    language,
  );
  const incidentStartedLabel = formatAreaDateTime(
    INCIDENT_STARTED_AT,
    language,
  );
  const officialAlertIssuedLabel = formatAreaDateTime(
    OFFICIAL_ALERT_ISSUED_AT,
    language,
  );
  const fieldReportPresentation = presentAreaDateTime(
    FIELD_REPORT_OCCURRED_AT,
    language,
  );
  const fieldReportLabel = fieldReportPresentation.label;
  const fieldReportPrimary = fieldReportPresentation.primary;
  const requestedImageDate = formatUtcDate(satelliteEpoch, language);
  const showArchivedOfficialAlert = isTimestampVisibleAt(
    OFFICIAL_ALERT_ISSUED_AT,
    asOfSelection,
  );
  const showFieldReport = isTimestampVisibleAt(
    FIELD_REPORT_OCCURRED_AT,
    asOfSelection,
  );
  const staticIntel = language === "el" ? intelEl : intelEn;
  const localizedSources = language === "el" ? sourcesEl : sourcesEn;
  const displayIntel = useMemo<IntelItem[]>(() => {
    const liveItems =
      filterAtOrBefore(
        updatesData?.items ?? [],
        (item) => item.modifiedAt ?? item.publishedAt,
        asOfSelection,
      ).slice(0, 6).map((item) => {
        const timestamp = item.modifiedAt ?? item.publishedAt;
        const localizedSummary =
          language === "el"
            ? item.summaryEl ?? item.summary
            : item.summaryEn ?? item.summary;
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
            item.timeQuality === "date-only"
              ? `${formatAreaDate(timestamp, language)} · ${localize(
                  language,
                  "EXACT TIME UNKNOWN",
                  "ΑΓΝΩΣΤΗ ΑΚΡΙΒΗΣ ΩΡΑ",
                )}`
              : formatAreaDateTime(timestamp, language),
          timeKind: timestamp
            ? item.timeQuality === "date-only"
              ? localize(
                  language,
                  "PUBLISHED DATE",
                  "ΗΜΕΡΟΜΗΝΙΑ ΔΗΜΟΣΙΕΥΣΗΣ",
                )
              : item.modifiedAt
              ? localize(language, "MODIFIED", "ΤΡΟΠΟΠΟΙΗΘΗΚΕ")
              : localize(language, "PUBLISHED", "ΔΗΜΟΣΙΕΥΤΗΚΕ")
            : localize(
                language,
                "TIME UNKNOWN · FEED ORDER ONLY",
                "ΑΓΝΩΣΤΗ ΩΡΑ · ΣΕΙΡΑ ΡΟΗΣ ΜΟΝΟ",
              ),
          dateOnly: item.timeQuality === "date-only",
          occurredAt: timestamp,
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
      });

    const fireService = isLive && updatesData?.fireServiceIncident
      ? [
          {
            id: "fire-service-live-status",
            time: formatAreaDateTime(
              updatesData.fireServiceIncident.fetchedAt,
              language,
            ),
            timeKind: localize(language, "CHECKED", "ΕΛΕΓΧΘΗΚΕ"),
            occurredAt: updatesData.fireServiceIncident.fetchedAt,
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
            category: "incident" as const,
            severity: "medium" as const,
            actionRequired: false,
            live: true,
          },
        ]
      : [];

    const archivedChronology = staticIntel.map((item) => {
      const occurredAt = STATIC_INTEL_OCCURRED_AT[item.id] ?? null;
      const timeKind =
        item.id === "evacuation"
          ? localize(language, "ISSUED", "ΕΚΔΟΘΗΚΕ")
          : item.confidence === "observed"
            ? localize(language, "OBSERVED", "ΠΑΡΑΤΗΡΗΘΗΚΕ")
            : item.confidence === "official"
              ? localize(language, "REPORTED", "ΑΝΑΦΕΡΘΗΚΕ")
              : localize(language, "FIELD REPORT", "ΑΝΑΦΟΡΑ ΠΕΔΙΟΥ");
      return {
        ...item,
        time: formatAreaDateTime(occurredAt, language),
        timeKind,
        occurredAt,
        archived: true,
      };
    });

    const combined = filterAtOrBefore(
      [...fireService, ...liveItems, ...archivedChronology],
      (item) => item.occurredAt,
      asOfSelection,
    );

    if (isLive) return combined;
    return combined.sort(
      (left, right) =>
        (timestampEpoch(right.occurredAt) ?? 0) -
        (timestampEpoch(left.occurredAt) ?? 0),
    );
  }, [asOfSelection, isLive, language, staticIntel, updatesData]);
  const active =
    displayIntel.find((item) => item.id === activeIntel) ??
    displayIntel[0] ??
    {
      id: isLive ? "live-wire-pending" : "history-wire-empty",
      time: formatAreaDateTime(null, language),
      timeKind: isLive
        ? localize(language, "SOURCE STATUS", "ΚΑΤΑΣΤΑΣΗ ΠΗΓΗΣ")
        : localize(language, "NO DATED ITEM", "ΧΩΡΙΣ ΧΡΟΝΟΛΟΓΗΜΕΝΟ ΣΤΟΙΧΕΙΟ"),
      label: localize(
        language,
        isLive
          ? updatesStaleSnapshot
            ? "Live-source retry in progress"
            : updatesData
              ? "No current live item returned"
              : "Checking live sources"
          : "No dated incident item yet",
        isLive
          ? updatesStaleSnapshot
            ? "Νέα προσπάθεια σύνδεσης με ζωντανές πηγές"
            : updatesData
              ? "Δεν επιστράφηκε τρέχουσα ζωντανή ενημέρωση"
              : "Έλεγχος ζωντανών πηγών"
          : "Δεν υπάρχει ακόμη χρονολογημένη καταχώριση συμβάντος",
      ),
      detail: localize(
        language,
        isLive
          ? "Dated archive entries remain available while current sources are checked."
          : "Items with unknown timestamps and observations after the selected time are withheld.",
        isLive
          ? "Οι χρονολογημένες αρχειακές καταχωρίσεις παραμένουν διαθέσιμες όσο ελέγχονται οι τρέχουσες πηγές."
          : "Οι καταχωρίσεις με άγνωστη ώρα και οι παρατηρήσεις μετά την επιλεγμένη στιγμή αποκρύπτονται.",
      ),
      confidence: "reported" as const,
      live: isLive,
    };
  const fireWind =
    windData?.locations.find((location) => location.id === "fire")?.current ??
    null;
  const downwindHeading = fireWind
    ? (fireWind.wind10.directionDeg + 180) % 360
    : null;
  const smokeDistance = fireWind
    ? Math.max(
        2,
        Math.min(18, fireWind.wind10.speedKmh * (smokeMinutes / 60)),
      )
    : null;
  const windObservedAt = normalizeAthensWallTime(fireWind?.time);
  const windObservedTime = formatAreaDateTime(windObservedAt, language);
  const retrievedTime = formatAreaDateTime(windData?.generatedAt, language);
  const incidentThermalDetections = useMemo(
    () =>
      filterAtOrBefore(
        thermalData?.detections.filter(
          (detection) =>
            detection.scope === "incident" &&
            Date.parse(detection.observedAt) >= INCIDENT_STARTED_EPOCH,
        ) ?? [],
        (detection) => detection.observedAt,
        asOfSelection,
      ),
    [asOfSelection, thermalData],
  );
  const userReadout = useMemo(() => {
    if (!userPosition) return null;
    const point: LatLngTuple = [userPosition.lat, userPosition.lon];
    let nearest: LiveThermalDetection | null = null;
    let nearestKm = Infinity;
    for (const detection of incidentThermalDetections) {
      const km = distanceKm(point, [detection.lat, detection.lon]);
      if (km < nearestKm) {
        nearestKm = km;
        nearest = detection;
      }
    }
    const routePoint = nearestPointOnPolyline(point, EVACUATION_ROUTE);
    return {
      nearest,
      nearestKm,
      nearestDir: nearest
        ? compassBearing(
            bearingDeg(point, [nearest.lat, nearest.lon]),
            language,
          )
        : null,
      routeKm: distanceKm(point, routePoint),
      routeDir: compassBearing(bearingDeg(point, routePoint), language),
      incidentKm: distanceKm(point, INCIDENT),
      incidentDir: compassBearing(bearingDeg(point, INCIDENT), language),
    };
  }, [userPosition, incidentThermalDetections, language]);
  const latestIncidentPass = useMemo(
    () =>
      latestAtOrBefore(
        thermalData?.passes.filter((pass) => pass.incidentRecordCount > 0) ??
          [],
        (pass) => pass.observedAt,
        asOfSelection,
      ),
    [asOfSelection, thermalData],
  );
  const thermalDetections = useMemo(() => {
    if (thermalWindow === "latest") {
      if (!latestIncidentPass) return [];
      return incidentThermalDetections.filter(
        (detection) => detection.passId === latestIncidentPass.id,
      );
    }
    const windowMs = thermalWindow === "6h" ? 6 * 60 * 60_000 : 24 * 60 * 60_000;
    return incidentThermalDetections.filter((detection) => {
      const observedEpoch = timestampEpoch(detection.observedAt);
      return (
        observedEpoch !== null && observedEpoch >= effectiveEpoch - windowMs
      );
    });
  }, [effectiveEpoch, incidentThermalDetections, latestIncidentPass, thermalWindow]);
  const visibleThermalPasses = useMemo(
    () => new Set(thermalDetections.map((detection) => detection.passId)).size,
    [thermalDetections],
  );
  const thermalUnavailable =
    (!thermalData && thermalError) ||
    thermalData?.status === "unconfigured" ||
    thermalData?.status === "upstream-error";
  const thermalStaleSnapshot =
    (thermalError || snapshotSources.thermal) &&
    Boolean(thermalData) &&
    !thermalUnavailable;
  const thermalLoading = !thermalData && !thermalError;
  const thermalLatestDetection = latestAtOrBefore(
    incidentThermalDetections,
    (detection) => detection.observedAt,
    LIVE_AS_OF,
  );
  const thermalLatestObservedAt = thermalLatestDetection?.observedAt ?? null;
  const thermalLatestTime = formatAreaDateTime(
    thermalLatestObservedAt,
    language,
  );
  const thermalLatestAge = ageLabel(
    ageMinutesFromTimestamp(
      thermalLatestObservedAt,
      effectiveEpoch,
    ),
    language,
    isLive ? "now" : "selected",
  );
  const thermalRetrievedTime = formatAreaDateTime(
    thermalData?.retrievedAt,
    language,
  );
  const satellitePassData = satellitePassArea.data;
  const satellitePasses = satellitePassData?.passes ?? [];
  const latestSatellitePass = latestAtOrBefore(
    satellitePasses,
    (pass) => pass.times.observedTo,
    LIVE_AS_OF,
  );
  const satellitePassObservedTime = formatAreaDateTime(
    latestSatellitePass?.times.observedTo ??
      satellitePassData?.scan.freshness.latestSourceObservedAt,
    language,
  );
  const satellitePassCheckedTime = formatAreaDateTime(
    satellitePassData?.scan.freshness.scanCheckedAt ??
      satellitePassData?.scan.freshness.checkedAt,
    language,
  );
  const satellitePassDeadlineEpoch = timestampEpoch(
    satellitePassData?.scan.freshness.deadline,
  );
  const satellitePassStale = Boolean(
    satellitePassData &&
      (satellitePassArea.cachedSnapshot ||
        satellitePassArea.error ||
        satellitePassData.scan.coverageState !== "complete_current" ||
        !satellitePassData.scan.freshness.isCurrent ||
        satellitePassData.result.state === "complete-not-eligible" ||
        satellitePassData.page.truncated ||
        (satellitePassDeadlineEpoch !== null &&
          satellitePassDeadlineEpoch < ageEpoch)),
  );
  const satellitePassUnavailable = Boolean(
    (!satellitePassData && satellitePassArea.error) ||
      satellitePassData?.result.state === "disabled" ||
      satellitePassData?.result.state === "unconfigured" ||
      satellitePassData?.result.state === "unavailable",
  );
  const satellitePassCount = satellitePassData?.page.truncated
    ? `≥${satellitePasses.length}`
    : String(satellitePasses.length);
  const satellitePassIndeterminateEmpty = Boolean(
    satellitePassData &&
      satellitePasses.length === 0 &&
      satellitePassData.result.state !== "valid-empty" &&
      !satellitePassUnavailable,
  );
  const satellitePassAreaLabel = userPosition
    ? localize(language, "your coarse area", "την ευρεία περιοχή σας")
    : localize(language, "the incident area", "την περιοχή του συμβάντος");
  const satellitePassPresentation = satellitePassPresentationState({
    isLive,
    loading: satellitePassArea.loading,
    unavailable: satellitePassUnavailable,
    stale: satellitePassStale,
    validEmpty: satellitePassData?.result.state === "valid-empty",
    indeterminateEmpty: satellitePassIndeterminateEmpty,
  });
  const satellitePassLayerDetail = satellitePassPresentation ===
    "current-only-withheld"
    ? localize(
        language,
        "Current-only CMR catalog coverage · hidden in history",
        "Τρέχουσα μόνο κάλυψη καταλόγου CMR · κρυφή στο ιστορικό",
      )
    : satellitePassPresentation === "loading"
      ? localize(
          language,
          `Checking persisted CMR coverage for ${satellitePassAreaLabel}`,
          `Έλεγχος αποθηκευμένης κάλυψης CMR για ${satellitePassAreaLabel}`,
        )
      : satellitePassPresentation === "unavailable"
        ? localize(
            language,
            "Persisted CMR coverage unavailable",
            "Η αποθηκευμένη κάλυψη CMR δεν είναι διαθέσιμη",
          )
        : satellitePassPresentation === "stale" ||
            satellitePassPresentation === "stale-valid-empty"
          ? localize(
              language,
              `Cached, stale, or incomplete catalog coverage · checked ${satellitePassCheckedTime}`,
              `Προσωρινά αποθηκευμένη, παλιά ή ελλιπής κάλυψη καταλόγου · έλεγχος ${satellitePassCheckedTime}`,
            )
          : satellitePassPresentation === "valid-empty"
            ? localize(
                language,
                `No catalog footprints intersect ${satellitePassAreaLabel} · checked ${satellitePassCheckedTime}`,
                `Δεν τέμνουν αποτυπώματα καταλόγου ${satellitePassAreaLabel} · έλεγχος ${satellitePassCheckedTime}`,
              )
            : localize(
                language,
                `CMR FireMask catalog coverage · checked ${satellitePassCheckedTime}`,
                `Κάλυψη καταλόγου CMR FireMask · έλεγχος ${satellitePassCheckedTime}`,
              );
  const thermalPollMinutes = Math.max(
    1,
    Math.round(
      (thermalData?.source.appPollSeconds ??
        DEMAND_INTERVALS_MS.incident.thermal / 1_000) / 60,
    ),
  );
  const thermalHistoricalCoverage = !isLive
    ? (thermalData?.query.requestedUtcDates?.join(" + ") ??
      thermalRequestDate ??
      utcDate(effectiveEpoch))
    : null;
  const updatesRetrievedTime = formatAreaDateTime(
    updatesData?.retrievedAt,
    language,
  );
  const fireServiceCheckedTime = formatAreaDateTime(
    updatesData?.fireServiceIncident?.fetchedAt,
    language,
  );
  const sourceHealth = isLive ? updatesData?.sourceSummary : null;
  const thermalLayerDetail = !isLive
    ? thermalLoading
      ? localize(
          language,
          `Loading historical FIRMS UTC coverage ${thermalHistoricalCoverage}`,
          `Φόρτωση ιστορικής κάλυψης FIRMS UTC ${thermalHistoricalCoverage}`,
        )
      : thermalUnavailable
        ? localize(
            language,
            `No historical thermal response available for UTC coverage ${thermalHistoricalCoverage}`,
            `Δεν υπάρχει ιστορική θερμική απόκριση για κάλυψη UTC ${thermalHistoricalCoverage}`,
          )
        : localize(
            language,
            `Historical FIRMS UTC coverage ${thermalHistoricalCoverage} · observation time ≤ ${asOfLabel}`,
            `Ιστορική κάλυψη FIRMS UTC ${thermalHistoricalCoverage} · χρόνος παρατήρησης ≤ ${asOfLabel}`,
          )
    : thermalLoading
      ? localize(
          language,
          "Loading FIRMS point feed",
          "Φόρτωση σημειακής ροής FIRMS",
        )
      : thermalUnavailable
      ? localize(
          language,
          "FIRMS point feed unavailable",
          "Η σημειακή ροή FIRMS δεν είναι διαθέσιμη",
        )
      : thermalStaleSnapshot
        ? localize(
            language,
            `Last response · refresh failed · ${thermalLatestAge}`,
            `Τελευταία απόκριση · αποτυχία ανανέωσης · ${thermalLatestAge}`,
          )
      : thermalData?.status === "partial"
        ? localize(
            language,
            `Partial FIRMS response · ${thermalLatestAge}`,
            `Μερική απόκριση FIRMS · ${thermalLatestAge}`,
          )
        : localize(
            language,
            `NASA FIRMS · ${thermalLatestAge}`,
            `NASA FIRMS · ${thermalLatestAge}`,
          );
  const thermalWindowName = {
    latest: localize(
      language,
      "latest detecting pass",
      "νεότερη διέλευση με ανιχνεύσεις",
    ),
    "6h": localize(language, "last 6 hours", "τελευταίες 6 ώρες"),
    "24h": localize(language, "last 24 hours", "τελευταίες 24 ώρες"),
  }[thermalWindow];
  const officialVerifiedAt =
    updatesData?.officialAlert.lastManuallyVerifiedAt ?? null;
  const officialVerifiedTime = formatAreaDateTime(
    officialVerifiedAt,
    language,
  );
  const officialReviewLabel = officialVerifiedAt
    ? localize(
        language,
        `ARCHIVE CHECKED · ${officialVerifiedTime}`,
        `ΕΛΕΓΧΟΣ ΑΡΧΕΙΟΥ · ${officialVerifiedTime}`,
      )
    : localize(
        language,
        "ARCHIVE CHECK TIME UNAVAILABLE",
        "Η ΩΡΑ ΕΛΕΓΧΟΥ ΑΡΧΕΙΟΥ ΔΕΝ ΕΙΝΑΙ ΔΙΑΘΕΣΙΜΗ",
      );
  const officialStatus = localizeFireStatus(
    updatesData?.fireServiceIncident?.status ?? null,
    updatesData?.fireServiceIncident?.statusLabel,
    language,
  );
  const cachedSnapshotSources = [
    ...(["wind", "updates", "thermal"] as const).filter(
      (source) => snapshotSources[source],
    ),
    ...(satellitePassArea.cachedSnapshot ? (["satellite"] as const) : []),
  ];
  const cachedSnapshotLabel = cachedSnapshotSources
    .map(
      (source) =>
        ({
          wind: localize(language, "wind", "άνεμος"),
          updates: localize(language, "updates", "ενημερώσεις"),
          thermal: localize(language, "thermal", "θερμικά"),
          satellite: localize(
            language,
            "satellite catalog",
            "κατάλογος δορυφόρου",
          ),
        })[source],
    )
    .join(" · ");
  const officialFallbackSources = [
    {
      id: "fire-service-board",
      label: localize(
        language,
        "Fire Service incident board",
        "Πίνακας συμβάντων Πυροσβεστικής",
      ),
      href: "https://www.fireservice.gr/apps/fire2019/symvanta/page.php",
    },
    {
      id: "civil-protection",
      label: localize(
        language,
        "Civil Protection press releases / RSS",
        "Δελτία Τύπου / RSS Πολιτικής Προστασίας",
      ),
      href: "https://civilprotection.gov.gr/deltia-tupou.rss",
    },
    {
      id: "hellenic-fire-service",
      label: "@pyrosvestiki",
      href: "https://x.com/pyrosvestiki",
    },
    {
      id: "civil-protection-x",
      label: "@CivPro_GR",
      href: "https://x.com/CivPro_GR",
    },
  ].flatMap((source) => {
    if (
      updatesData?.collectionMode === "feeds-only" &&
      ["hellenic-fire-service", "civil-protection-x"].includes(source.id)
    ) {
      return [];
    }
    const snapshot = updatesData?.sources.find(
      (candidate) => candidate.id === source.id,
    );
    const unavailable =
      updatesStaleSnapshot ||
      (updatesData !== null && snapshot?.status !== "ok");
    if (!unavailable) return [];

    const reason = updatesStaleSnapshot
      ? localize(
          language,
          "live refresh failed",
          "αποτυχία ζωντανής ανανέωσης",
        )
      : snapshot?.errorCode === "upstream_forbidden"
        ? localize(
            language,
            "source denied automatic retrieval",
            "η πηγή απέρριψε την αυτόματη ανάκτηση",
          )
        : snapshot?.errorCode === "authentication"
          ? localize(
              language,
              "X API authentication failed",
              "αποτυχία ελέγχου ταυτότητας X API",
            )
          : snapshot?.status === "unconfigured"
            ? localize(
                language,
                "automatic retrieval is not configured",
                "η αυτόματη ανάκτηση δεν έχει ρυθμιστεί",
              )
            : localize(
                language,
                "automatic retrieval failed",
                "η αυτόματη ανάκτηση απέτυχε",
              );
    return [{ ...source, reason }];
  });

  const recordSnapshotResponses = useCallback(
    (source: SnapshotSource, responses: readonly Response[]) => {
      const isSnapshot = responses.some(
        (response) =>
          response.headers.get(SNAPSHOT_HEADER) === "offline-cache",
      );
      setSnapshotSources((current) =>
        current[source] === isSnapshot
          ? current
          : { ...current, [source]: isSnapshot },
      );
    },
    [],
  );

  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    document.documentElement.lang = nextLanguage;
    window.localStorage.setItem("firewatch-language", nextLanguage);
  };

  const closePanels = () => {
    setPanelOpen(false);
  };

  const updateAsOfFromRange = (value: number) => {
    const next = asOfEpochFromRangeValue(
      value,
      INCIDENT_STARTED_EPOCH,
      ageEpoch,
      AS_OF_STEP_MS,
    );
    pendingThermalAsOfEpoch.current = next;
    setAsOfEpoch(next);
  };

  const commitAsOfScrub = () => {
    setIsScrubbing(false);
    setCommittedThermalAsOfEpoch(pendingThermalAsOfEpoch.current);
  };

  const beginAsOfPointerScrub = (
    event: ReactPointerEvent<HTMLInputElement>,
  ) => {
    setIsScrubbing(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Some embedded browsers do not expose pointer capture on range inputs.
    }
  };

  const finishAsOfPointerScrub = (
    event: ReactPointerEvent<HTMLInputElement>,
  ) => {
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser on cancel.
    }
    commitAsOfScrub();
  };

  const isAsOfRangeKey = (key: string) =>
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key === "Home" ||
    key === "End";

  const onAsOfKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!isAsOfRangeKey(event.key)) return;
    setIsScrubbing(true);
    if (event.key === "End") {
      event.preventDefault();
      updateAsOfFromRange(ageEpoch);
    }
  };

  const onAsOfKeyUp = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isAsOfRangeKey(event.key)) commitAsOfScrub();
  };

  const clampPanelPosition = useCallback(
    (
      position: { x: number; y: number },
      size?: { width: number; height: number },
    ) => {
      const rect = panelElement.current?.getBoundingClientRect();
      const width = size?.width ?? rect?.width ?? 336;
      const height = size?.height ?? rect?.height ?? 120;
      const maxX = Math.max(
        DESKTOP_PANEL_GAP,
        window.innerWidth - width - DESKTOP_PANEL_GAP,
      );
      const maxY = Math.max(
        DESKTOP_PANEL_TOP,
        window.innerHeight -
          height -
          DESKTOP_PANEL_BOTTOM -
          DESKTOP_PANEL_GAP,
      );
      return {
        x: Math.min(Math.max(position.x, DESKTOP_PANEL_GAP), maxX),
        y: Math.min(Math.max(position.y, DESKTOP_PANEL_TOP), maxY),
      };
    },
    [],
  );

  const reclampPanel = useCallback(() => {
    setPanelPos((current) => {
      if (!current) return current;
      const next = clampPanelPosition(current);
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [clampPanelPosition]);

  // Pointer-capture drag for the desktop panel: the move button owns the
  // pointer for the whole gesture, so no window-level listeners are needed.
  const onPanelDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (compact) return;
    const panel = panelElement.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    panelDrag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPanelDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = panelDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPanelPos(
      clampPanelPosition(
        {
          x: event.clientX - drag.offsetX,
          y: event.clientY - drag.offsetY,
        },
        { width: drag.width, height: drag.height },
      ),
    );
  };

  const onPanelDragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (panelDrag.current?.pointerId === event.pointerId) {
      panelDrag.current = null;
    }
  };

  const onPanelMoveKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (compact) return;
    if (event.key === "Home") {
      event.preventDefault();
      setPanelPos(null);
      return;
    }

    const step = event.shiftKey ? 40 : 10;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowLeft") deltaX = -step;
    else if (event.key === "ArrowRight") deltaX = step;
    else if (event.key === "ArrowUp") deltaY = -step;
    else if (event.key === "ArrowDown") deltaY = step;
    else return;

    event.preventDefault();
    const rect = panelElement.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelPos((current) =>
      clampPanelPosition(
        {
          x: (current?.x ?? rect.left) + deltaX,
          y: (current?.y ?? rect.top) + deltaY,
        },
        { width: rect.width, height: rect.height },
      ),
    );
  };

  const selectLayerTab = (tab: LayerTab) => {
    setLayerTab(tab);
    if (tab === "updates") setWireBadge(false);
  };

  const onLayerTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentTab: LayerTab,
  ) => {
    const currentIndex = LAYER_TABS.indexOf(currentTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % LAYER_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + LAYER_TABS.length) % LAYER_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = LAYER_TABS.length - 1;
    }
    if (nextIndex === null) return;

    const nextTab = LAYER_TABS[nextIndex];
    if (!nextTab) return;
    event.preventDefault();
    selectLayerTab(nextTab);
    (
      document.getElementById(`layers-tab-${nextTab}`) as
        | HTMLButtonElement
        | null
    )?.focus();
  };

  const setAlertCollapsedPersistent = (collapsed: boolean) => {
    setAlertCollapsed(collapsed);
    window.localStorage.setItem(
      "firewatch-alert-collapsed",
      collapsed ? "1" : "0",
    );
  };

  // Watching never moves the map: someone already looking at their own area
  // must not lose their view, and a remote viewer must not be flown away from
  // the incident. Centering is a separate, explicit button in the readout.
  const startWatch = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    if (geoWatchId.current !== null) return;
    let watchId: number | null = null;
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (watchId === null || geoWatchId.current !== watchId) return;
        setUserPosition({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        });
        setGeoStatus("on");
      },
      (positionError) => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        if (geoWatchId.current === watchId) geoWatchId.current = null;
        setUserPosition(null);
        setGeoStatus(
          positionError.code === positionError.PERMISSION_DENIED
            ? "denied"
            : "error",
        );
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    geoWatchId.current = watchId;
  }, []);

  const stopLocate = () => {
    if (geoWatchId.current !== null) {
      navigator.geolocation.clearWatch(geoWatchId.current);
    }
    geoWatchId.current = null;
    setUserPosition(null);
    setGeoStatus("off");
    if (layerTab === "location") {
      setLayerTab("layers");
      setPanelOpen(false);
    }
  };

  const toggleLocate = () => {
    if (
      geoWatchId.current !== null ||
      geoStatus === "on" ||
      geoStatus === "locating"
    ) {
      stopLocate();
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeoStatus("error");
      return;
    }
    setGeoStatus("locating");
    startWatch();
  };

  useEffect(() => {
    const tick = () => setClockEpoch(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
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
      const nextLanguage =
        stored === "en" || stored === "el"
          ? stored
          : navigator.language.toLowerCase().startsWith("el")
            ? "el"
            : "en";
      setLanguage(nextLanguage);
      document.documentElement.lang = nextLanguage;
      setAlertCollapsed(
        initialArchivedAlertCollapsed(
          window.localStorage.getItem("firewatch-alert-collapsed"),
          window.matchMedia("(max-width: 1180px)").matches,
        ),
      );
      setAlertPreferenceReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1180px)");
    const sync = () => {
      setCompact(query.matches);
      if (query.matches) {
        setPanelOpen(false);
      } else {
        setPanelOpen(true);
      }
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Keep local time filtering responsive while the range thumb moves, then
  // commit one date-qualified FIRMS read after the interaction settles.
  useEffect(() => {
    if (isScrubbing) return;
    const timer = window.setTimeout(
      () => setCommittedThermalAsOfEpoch(asOfEpoch),
      200,
    );
    return () => window.clearTimeout(timer);
  }, [asOfEpoch, isScrubbing]);

  useEffect(() => {
    if (compact || !panelOpen) return;
    const frame = window.requestAnimationFrame(reclampPanel);
    window.addEventListener("resize", reclampPanel);
    const observer =
      typeof ResizeObserver === "undefined" || !panelElement.current
        ? null
        : new ResizeObserver(reclampPanel);
    if (panelElement.current) observer?.observe(panelElement.current);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", reclampPanel);
      observer?.disconnect();
    };
  }, [compact, layerTab, panelOpen, reclampPanel]);

  // Location access is opt-in. Always release the active watch on unmount.
  useEffect(
    () => () => {
      if (geoWatchId.current !== null) {
        navigator.geolocation.clearWatch(geoWatchId.current);
        geoWatchId.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort; the app works without it */
    });
  }, []);

  // Retain every unseen action-required item until it is individually viewed
  // or dismissed. The first payload also surfaces its current actionable item
  // instead of silently treating a first-time visitor as already notified.
  useEffect(() => {
    if (!updatesData || snapshotSources.updates) return;
    const actionItems = updatesData.items.filter(
      (item) => item.actionRequired,
    );
    const initialPayload = seenActionIds.current === null;
    const seen = seenActionIds.current ?? new Set<string>();
    seenActionIds.current = seen;
    const fresh = actionItems.filter((item) => !seen.has(item.id));
    actionItems.forEach((item) => seen.add(item.id));
    // On first load, surface the newest current instruction without replaying
    // every older post in the lookback. Later polls retain every unseen item.
    const alertsToQueue = initialPayload ? fresh.slice(0, 1) : fresh;
    if (alertsToQueue.length > 0) {
      setActionAlerts((current) => {
        const queuedIds = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...alertsToQueue.filter((item) => !queuedIds.has(item.id)),
        ];
      });
      setWireBadge(true);
      if (!initialPayload && "vibrate" in navigator) {
        navigator.vibrate([250, 120, 250]);
      }
    }
  }, [snapshotSources.updates, updatesData]);

  const advanceActionAlert = () => {
    const hasMore = actionAlerts.length > 1;
    setActionAlerts((current) => current.slice(1));
    setWireBadge(hasMore);
  };

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
    let inFlight = false;
    const refreshWind = async (allowOfflineSnapshot = false) => {
      if (
        cancelled ||
        inFlight ||
        !clientPollingAvailable(allowOfflineSnapshot)
      ) return;
      inFlight = true;
      try {
        const response = await fetch("/api/wind");
        recordSnapshotResponses("wind", [response]);
        if (!response.ok) throw new Error("wind request failed");
        const payload = (await response.json()) as WindPayload;
        if (!cancelled) {
          setWindData(payload);
          setWindError(false);
        }
      } catch {
        if (!cancelled) setWindError(true);
      } finally {
        inFlight = false;
      }
    };
    const initial = window.setTimeout(() => void refreshWind(true), 0);
    const timer = window.setInterval(
      () => void refreshWind(),
      DEMAND_INTERVALS_MS.incident.wind,
    );
    const resume = () => void refreshWind();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [recordSnapshotResponses]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refreshUpdates = async (allowOfflineSnapshot = false) => {
      if (
        cancelled ||
        inFlight ||
        !clientPollingAvailable(allowOfflineSnapshot)
      ) return;
      inFlight = true;
      try {
        // Public reads remain feeds-only. Realtime providers stay disabled
        // until the persisted scheduled collector is provisioned.
        const response = await fetch("/api/updates");
        recordSnapshotResponses("updates", [response]);
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
      } finally {
        inFlight = false;
      }
    };
    const initial = window.setTimeout(() => void refreshUpdates(true), 0);
    const timer = window.setInterval(
      () => void refreshUpdates(),
      DEMAND_INTERVALS_MS.incident.updates,
    );
    const resume = () => void refreshUpdates();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [recordSnapshotResponses]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refreshThermal = async (allowOfflineSnapshot = false) => {
      if (
        cancelled ||
        inFlight ||
        !clientPollingAvailable(allowOfflineSnapshot)
      ) return;
      inFlight = true;
      try {
        const requestedDates = thermalRequestDate
          ? historicalThermalDates(thermalRequestDate)
          : [];
        const requestUrls = requestedDates.length
          ? requestedDates.map(
              (date) => `/api/thermal?date=${encodeURIComponent(date)}`,
            )
          : ["/api/thermal"];
        const responses = await Promise.all(
          requestUrls.map((url) => fetch(url)),
        );
        if (cancelled) return;
        recordSnapshotResponses("thermal", responses);
        if (responses.some((response) => !response.ok)) {
          throw new Error("thermal request failed");
        }
        const payloads = await Promise.all(
          responses.map(
            async (response) => (await response.json()) as ThermalPayload,
          ),
        );
        const livePayload = payloads[0];
        const payload = thermalRequestDate
          ? mergeHistoricalThermalPayloads(
              payloads,
              requestedDates,
              thermalRequestDate,
            )
          : livePayload;
        if (!payload) throw new Error("thermal response was empty");
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
      } finally {
        inFlight = false;
      }
    };
    const initial = window.setTimeout(() => {
      if (cancelled) return;
      setThermalData(null);
      setThermalError(false);
      setSnapshotSources((current) =>
        current.thermal ? { ...current, thermal: false } : current,
      );
      void refreshThermal(true);
    }, 0);
    const timer =
      thermalRequestDate === null
        ? window.setInterval(
            () => void refreshThermal(),
            DEMAND_INTERVALS_MS.incident.thermal,
          )
        : null;
    const resume = () => void refreshThermal();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [recordSnapshotResponses, thermalRequestDate]);

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
        // Half-step zoom and a higher wheel threshold tame trackpad-pinch
        // and scroll zoom, which otherwise jump several levels per gesture.
        zoomSnap: 0.5,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 140,
      }).setView([38.988, 26.383], 13);
      mapRef.current = map;
      L.control.zoom({ position: "topleft" }).addTo(map);
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
    const map = mapRef.current;
    const previousLayer = baseLayerRef.current;
    const config = BASEMAPS[baseMode];
    const nextLayer = L.tileLayer(config.url, {
      maxZoom: config.maxZoom,
      attribution: config.attribution,
      subdomains: config.subdomains,
      className: "firewatch-basemap-tile",
      keepBuffer: 1,
      updateWhenIdle: true,
    });
    let firstTileLoaded = false;
    const markReady = () => {
      if (firstTileLoaded) return;
      firstTileLoaded = true;
      setBaseTilesReady(true);
      setBaseTilesFailed(false);
    };
    const markFailed = () => {
      if (firstTileLoaded) return;
      setBaseTilesFailed(true);
    };
    const finishSwap = () => {
      if (!firstTileLoaded) {
        setBaseTilesFailed(true);
        if (map.hasLayer(nextLayer)) map.removeLayer(nextLayer);
        if (baseLayerRef.current === nextLayer) {
          baseLayerRef.current = previousLayer;
        }
        return;
      }
      if (previousLayer && map.hasLayer(previousLayer)) {
        map.removeLayer(previousLayer);
      }
    };
    nextLayer.once("tileload", markReady);
    nextLayer.once("load", finishSwap);
    nextLayer.once("tileerror", markFailed);
    nextLayer.addTo(map);
    nextLayer.bringToBack();
    baseLayerRef.current = nextLayer;

    // Keep the previous basemap visible until the replacement has finished,
    // instead of flashing the empty map background during a style switch.
    if (previousLayer) previousLayer.bringToBack();

    return () => {
      nextLayer.off("tileload", markReady);
      nextLayer.off("load", finishSwap);
      nextLayer.off("tileerror", markFailed);
    };
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

    }

    if (layers.evacRoute && showArchivedOfficialAlert) {
      L.polyline(EVACUATION_ROUTE, {
        color: "#55ddff",
        weight: 8,
        opacity: 0.18,
        lineCap: "round",
      }).addTo(group);
      L.polyline(EVACUATION_ROUTE, {
        color: "#55ddff",
        weight: 3,
        opacity: 0.95,
        dashArray: "10 8",
      })
        .bindTooltip(
          localize(
            language,
            `App-drawn archived road reference between the endpoints named by the 112 instruction issued ${officialAlertIssuedLabel}. It is not an official evacuation route. Follow any newer instruction and authorities on the ground.`,
            `Αρχειοθετημένη οδική αναφορά σχεδιασμένη από την εφαρμογή μεταξύ των σημείων της οδηγίας 112 που εκδόθηκε ${officialAlertIssuedLabel}. Δεν αποτελεί επίσημη διαδρομή απομάκρυνσης. Ακολουθείτε κάθε νεότερη οδηγία και τις επί τόπου Αρχές.`,
          ),
          { sticky: true },
        )
        .addTo(group);
      L.marker(
        EVACUATION_ROUTE[Math.floor(EVACUATION_ROUTE.length / 2)] ??
          midpoint(PLOMARI_BEACH, AGIOS_ISIDOROS),
        {
        interactive: false,
        icon: L.divIcon({
          className: "marker-shell route-arrow-shell",
          html: markerHtml(
            "arrow",
            localize(language, "APP ROAD REF", "ΟΔΙΚΗ ΑΝΑΦΟΡΑ"),
          ),
          iconSize: [130, 30],
          iconAnchor: [18, 15],
        }),
      }).addTo(group);
    }

    if (layers.satelliteRaster && isLive) {
      const thermalDate = utcDate(satelliteEpoch);
      [
        "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
        "VIIRS_NOAA21_Thermal_Anomalies_375m_All",
        "VIIRS_SNPP_Thermal_Anomalies_375m_All",
      ].forEach((layerName) => {
        L.tileLayer
          .wms(
            "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi",
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

    if (layers.satelliteCoverage && isLive && satellitePassData) {
      satellitePassData.passes.forEach((pass) => {
        footprintLeafletPolygons(pass.coverage.footprint).forEach((polygon) => {
          const popup = document.createElement("div");
          popup.className = "popup-copy";
          const title = document.createElement("strong");
          title.textContent = localize(
            language,
            "CMR CATALOG COVERAGE FOOTPRINT",
            "ΑΠΟΤΥΠΩΜΑ ΚΑΛΥΨΗΣ ΚΑΤΑΛΟΓΟΥ CMR",
          );
          const source = document.createElement("span");
          source.textContent = `${pass.satellite} · ${pass.sensor} · ${pass.product}`;
          const observed = document.createElement("time");
          observed.dateTime =
            zonedDateTimeAttribute(pass.times.observedTo) ?? "";
          observed.textContent = localize(
            language,
            `OBSERVED INTERVAL · ${formatAreaDateTime(pass.times.observedFrom, language)} → ${formatAreaDateTime(pass.times.observedTo, language)}`,
            `ΔΙΑΣΤΗΜΑ ΠΑΡΑΤΗΡΗΣΗΣ · ${formatAreaDateTime(pass.times.observedFrom, language)} → ${formatAreaDateTime(pass.times.observedTo, language)}`,
          );
          const caveat = document.createElement("span");
          caveat.textContent = localize(
            language,
            "Catalog footprint only. The granule intersects this coarse area; its pixels have not been assessed here for a thermal anomaly.",
            "Μόνο αποτύπωμα καταλόγου. Το δορυφορικό αρχείο τέμνει αυτή την ευρεία περιοχή· τα εικονοστοιχεία του δεν έχουν αξιολογηθεί εδώ για θερμική ανωμαλία.",
          );
          popup.append(
            title,
            document.createElement("br"),
            source,
            document.createElement("br"),
            observed,
            document.createElement("br"),
            caveat,
          );
          const leafletPolygon = polygon.map((ring) =>
            ring.map(([latitude, longitude]) =>
              [latitude, longitude] as LatLngTuple,
            ),
          );
          L.polygon(leafletPolygon, {
            color: satellitePassStale ? "#ffb347" : "#55ddff",
            weight: 1.4,
            opacity: satellitePassStale ? 0.58 : 0.74,
            fillColor: satellitePassStale ? "#ffb347" : "#55ddff",
            fillOpacity: 0.025,
            dashArray: satellitePassStale ? "4 8" : "8 7",
          })
            .bindPopup(popup)
            .addTo(group);
        });
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
            )}</strong><br><time datetime="${zonedDateTimeAttribute(
              detection.observedAt,
            ) ?? ""}">${localize(
              language,
              "OBSERVED",
              "ΠΑΡΑΤΗΡΗΘΗΚΕ",
            )} · ${formatAreaDateTime(detection.observedAt, language)}</time> · ${ageLabel(
              ageMinutesFromTimestamp(detection.observedAt, effectiveEpoch) ??
                detection.ageMinutes,
              language,
              isLive ? "now" : "selected",
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

    if (layers.local && showFieldReport) {
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
                  ? `One local report referenced scattered activity near Agios Antonios on ${fieldReportLabel}.`
                  : "The same report described activity in the direction of Megalochori; this second area is a broad reference zone.",
                index === 0
                  ? `Μία τοπική αναφορά περιέγραψε διάσπαρτη δραστηριότητα κοντά στον Άγιο Αντώνιο στις ${fieldReportLabel}.`
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
              `FIELD REPORT · ${fieldReportPrimary.toLocaleUpperCase("en-GB")} · ARCHIVED`,
              `ΑΝΑΦΟΡΑ ΠΕΔΙΟΥ · ${fieldReportPrimary.toLocaleUpperCase("el-GR")} · ΑΡΧΕΙΟ`,
            ),
          ),
          iconSize: [170, 30],
          iconAnchor: [16, 15],
        }),
      }).addTo(group);
    }

    if (
      layers.wind &&
      isLive &&
      fireWind &&
      downwindHeading !== null
    ) {
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
          color: "#39f2c5",
          weight: label === "10 m" ? 3 : 2,
          opacity,
          dashArray: label === "10 m" ? "5 7" : "3 9",
        })
          .bindTooltip(
            localize(
              language,
              `${label} height · Open-Meteo point model: from ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) toward ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · model valid ${windObservedTime}`,
              `Ύψος ${label} · σημειακό μοντέλο Open-Meteo: από ${String(Math.round(vector.directionDeg)).padStart(3, "0")}° (${compass(vector.directionDeg, language)}) προς ${compass(toward, language)} · ${vector.speedKmh.toFixed(1)} km/h · μοντέλο για ${windObservedTime}`,
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
            `10 m ${localize(language, "HEIGHT", "ΥΨΟΣ")} → ${compass(downwindHeading, language)} · ${fireWind.wind10.speedKmh.toFixed(0)} km/h`,
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
              `Observed ${formatAreaDateTime(metar.observedAt, language)} at Mytilene airport; conditions at the fire can differ.`,
              `Παρατήρηση ${formatAreaDateTime(metar.observedAt, language)} στο αεροδρόμιο Μυτιλήνης· οι συνθήκες στην πυρκαγιά μπορεί να διαφέρουν.`,
            )}<br>${metar.raw}</span></div>`,
          )
          .addTo(group);
      }
    }

    if (layers.smokeObserved && isLive) {
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

    if (
      layers.smoke &&
      isLive &&
      smokeDistance !== null &&
      downwindHeading !== null
    ) {
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
            `Modeled smoke-transport proxy · horizon +${smokeMinutes} min · ${smokeDistance.toFixed(1)} km at 10 m-height model wind · not measured PM2.5 or fire spread`,
            `Ενδεικτικό μοντέλο μεταφοράς καπνού · ορίζοντας +${smokeMinutes} λεπτά · ${smokeDistance.toFixed(1)} km με μοντέλο ανέμου σε ύψος 10 m · όχι μέτρηση PM2.5 ούτε πρόγνωση εξάπλωσης πυρκαγιάς`,
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

    if (userPosition) {
      L.circle([userPosition.lat, userPosition.lon], {
        radius: userPosition.accuracyM,
        color: "#39f2c5",
        weight: 1,
        fillColor: "#39f2c5",
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(group);
      L.marker([userPosition.lat, userPosition.lon], {
        interactive: false,
        icon: L.divIcon({
          className: "marker-shell",
          html: markerHtml("you", localize(language, "YOU", "ΕΣΕΙΣ")),
          iconSize: [90, 26],
          iconAnchor: [8, 13],
        }),
      }).addTo(group);
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
    satellitePassData,
    satellitePassStale,
    thermalDetections,
    effectiveEpoch,
    isLive,
    officialAlertIssuedLabel,
    fieldReportLabel,
    fieldReportPrimary,
    showArchivedOfficialAlert,
    showFieldReport,
    language,
    userPosition,
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

  const hasLocationFeedback =
    userReadout !== null ||
    geoStatus === "locating" ||
    geoStatus === "denied" ||
    geoStatus === "error";
  const locationSheetOpen =
    compact && panelOpen && layerTab === "location";
  const openLocationSheet = () => {
    setLayerTab("location");
    setPanelOpen(true);
  };
  const centerMapOnUser = () => {
    if (!userPosition) return;
    focusPoint([userPosition.lat, userPosition.lon], 14);
    if (compact) closePanels();
  };
  const locationUnavailableMessage =
    geoStatus === "locating"
      ? localize(
          language,
          "Acquiring location on this device…",
          "Εντοπισμός θέσης σε αυτή τη συσκευή…",
        )
      : geoStatus === "denied"
        ? localize(
            language,
            "Location permission denied — allow it in browser settings to see distances.",
            "Η άδεια τοποθεσίας απορρίφθηκε — ενεργοποιήστε την στις ρυθμίσεις του προγράμματος περιήγησης για αποστάσεις.",
          )
        : localize(
            language,
            "Location unavailable on this device.",
            "Η τοποθεσία δεν είναι διαθέσιμη σε αυτή τη συσκευή.",
          );
  const locationSummaryDetail = userReadout?.nearest
    ? `${userReadout.nearestKm.toFixed(1)} km ${
        userReadout.nearestDir ? `${userReadout.nearestDir} · ` : ""
      }${localize(language, "nearest hotspot", "πλησιέστερη εστία")}`
    : userReadout
      ? localize(
          language,
          "No hotspots in the current window",
          "Καμία εστία στο τρέχον παράθυρο",
        )
      : locationUnavailableMessage;
  const locationDetailContent =
    userReadout && userPosition ? (
      <>
        <strong>
          GPS ±{Math.round(userPosition.accuracyM)} m ·{" "}
          {localize(
            language,
            `exact fix stays on this device; Firewatch receives only a versioned ${Math.round(satelliteAreaCell.minimumSpanM / 1_000)}+ km coarse-area cell for local coverage, while centering can request nearby tiles from Carto, Esri, OpenTopoMap, or NASA`,
            `η ακριβής θέση παραμένει στη συσκευή· το Firewatch λαμβάνει μόνο ένα έκδοση-ελεγχόμενο κελί ευρείας περιοχής ${Math.round(satelliteAreaCell.minimumSpanM / 1_000)}+ km για τοπική κάλυψη, ενώ το κεντράρισμα μπορεί να ζητήσει κοντινά πλακίδια από Carto, Esri, OpenTopoMap ή NASA`,
          )}
        </strong>
        {userReadout.nearest ? (
          <span>
            {userReadout.nearestKm.toFixed(1)} km{" "}
            {userReadout.nearestDir ? `${userReadout.nearestDir} → ` : ""}
            {localize(
              language,
              "nearest satellite hotspot",
              "πλησιέστερη δορυφορική εστία",
            )}{" "}
            (
            {ageLabel(
              ageMinutesFromTimestamp(
                userReadout.nearest.observedAt,
                effectiveEpoch,
              ) ?? userReadout.nearest.ageMinutes,
              language,
              isLive ? "now" : "selected",
            )}
            )
          </span>
        ) : (
          <span>
            {localize(
              language,
              "No satellite hotspots in the current window",
              "Καμία δορυφορική εστία στο τρέχον παράθυρο",
            )}
          </span>
        )}
        <span>
          {userReadout.routeKm.toFixed(1)} km{" "}
          {userReadout.routeDir ? `${userReadout.routeDir} → ` : ""}
          {localize(
            language,
            `app-drawn archived road reference (${officialAlertIssuedLabel})`,
            `αρχειοθετημένη οδική αναφορά εφαρμογής (${officialAlertIssuedLabel})`,
          )}
        </span>
        <span>
          {userReadout.incidentKm.toFixed(1)} km{" "}
          {userReadout.incidentDir ? `${userReadout.incidentDir} → ` : ""}
          {localize(
            language,
            "incident reference point",
            "σημείο αναφοράς συμβάντος",
          )}
        </span>
        <small>
          {localize(
            language,
            "Distances are straight-line, not road distance.",
            "Οι αποστάσεις είναι σε ευθεία γραμμή, όχι οδικές.",
          )}
        </small>
        <div className="locate-readout__actions">
          <button
            type="button"
            className="locate-readout__center"
            onClick={centerMapOnUser}
          >
            {localize(
              language,
              "CENTER MAP ON ME",
              "ΚΕΝΤΡΑΡΙΣΜΑ ΣΤΗ ΘΕΣΗ ΜΟΥ",
            )}
          </button>
          <button
            type="button"
            className="locate-readout__center"
            onClick={stopLocate}
          >
            {localize(
              language,
              "STOP USING POSITION",
              "ΔΙΑΚΟΠΗ ΧΡΗΣΗΣ ΘΕΣΗΣ",
            )}
          </button>
        </div>
      </>
    ) : (
      <>
        <span>{locationUnavailableMessage}</span>
        <button
          type="button"
          className="locate-readout__center"
          onClick={geoStatus === "locating" ? stopLocate : toggleLocate}
        >
          {geoStatus === "locating"
            ? localize(
                language,
                "STOP USING POSITION",
                "ΔΙΑΚΟΠΗ ΧΡΗΣΗΣ ΘΕΣΗΣ",
              )
            : localize(
                language,
                "TRY POSITION AGAIN",
                "ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ ΘΕΣΗΣ",
              )}
        </button>
      </>
    );

  const mobileSheetOpen = compact && panelOpen;

  return (
    <main
      className={`command-shell${alertPreferenceReady ? " alert-preference-ready" : ""}${mobileSheetOpen ? " has-mobile-sheet" : ""}${layers.simulation ? " has-scenario" : ""}${isLive ? " is-live" : " is-historical"}${isScrubbing ? " is-scrubbing" : ""}${showArchivedOfficialAlert ? "" : " without-archived-alert"}${showArchivedOfficialAlert && alertCollapsed ? " alert-collapsed" : ""}${hasLocationFeedback ? " has-locate-readout" : ""}${actionAlert ? " has-action-alert" : ""}`}
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
        {(!ready || (!baseTilesReady && !baseTilesFailed)) && (
          <div className="map-loading" role="status" aria-live="polite">
            {localize(
              language,
              ready ? "LOADING SATELLITE MAP…" : "ACQUIRING MAP…",
              ready ? "ΦΟΡΤΩΣΗ ΔΟΡΥΦΟΡΙΚΟΥ ΧΑΡΤΗ…" : "ΦΟΡΤΩΣΗ ΧΑΡΤΗ…",
            )}
          </div>
        )}
        {baseTilesFailed && (
          <div className="map-tile-warning" role="status">
            {localize(
              language,
              "SOME MAP TILES ARE DELAYED",
              "ΚΑΘΥΣΤΕΡΟΥΝ ΟΡΙΣΜΕΝΑ ΠΛΑΚΙΔΙΑ ΧΑΡΤΗ",
            )}
          </div>
        )}
        <div className="scanline" aria-hidden="true" />
        <div className="reticle" aria-hidden="true">
          <span />
        </div>
      </div>

      {(!online || cachedSnapshotSources.length > 0) && (
        <div className="offline-banner" role="status" aria-live="polite">
          {cachedSnapshotSources.length > 0
            ? localize(
                language,
                `CACHED SNAPSHOT — LIVE REFRESH FAILED (${cachedSnapshotLabel}) · CHECK DISPLAYED SOURCE TIMES`,
                `ΑΠΟΘΗΚΕΥΜΕΝΟ ΣΤΙΓΜΙΟΤΥΠΟ — ΑΠΟΤΥΧΙΑ ΖΩΝΤΑΝΗΣ ΑΝΑΝΕΩΣΗΣ (${cachedSnapshotLabel}) · ΕΛΕΓΞΤΕ ΤΙΣ ΩΡΕΣ ΠΗΓΩΝ`,
              )
            : localize(
                language,
                "OFFLINE — DISPLAYING THE LAST AVAILABLE SNAPSHOT",
                "ΕΚΤΟΣ ΣΥΝΔΕΣΗΣ — ΠΡΟΒΟΛΗ ΤΟΥ ΤΕΛΕΥΤΑΙΟΥ ΔΙΑΘΕΣΙΜΟΥ ΣΤΙΓΜΙΟΤΥΠΟΥ",
              )}
        </div>
      )}

      {actionAlert && (
        <div className="alert-toast" role="alert">
          <button
            type="button"
            className="alert-toast__body"
            onClick={() => {
              setActiveIntel(`feed-${actionAlert.id}`);
              setPanelOpen(true);
              setLayerTab("updates");
              advanceActionAlert();
            }}
          >
            <span>
              {localize(
                language,
                "NEW ACTION-REQUIRED UPDATE",
                "ΝΕΑ ΕΝΗΜΕΡΩΣΗ ΠΟΥ ΑΠΑΙΤΕΙ ΕΝΕΡΓΕΙΑ",
              )}
            </span>
            <strong>{actionAlert.title}</strong>
          </button>
          <button
            type="button"
            className="alert-toast__dismiss"
            onClick={advanceActionAlert}
            aria-label={localize(
              language,
              "Dismiss alert",
              "Απόρριψη ειδοποίησης",
            )}
          >
            ×
          </button>
        </div>
      )}

      <header className="top-hud">
        <div className="brand-lockup">
          <div className="brand-line">
            <span
              className={`live-dot${isLive ? "" : " live-dot--historical"}`}
              aria-hidden="true"
            />
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
          {isLive
            ? `${localize(language, "FIRE SERVICE", "ΠΥΡΟΣΒΕΣΤΙΚΟ ΣΩΜΑ")} // ${officialStatus}`
            : `${localize(language, "HISTORICAL VIEW", "ΙΣΤΟΡΙΚΗ ΠΡΟΒΟΛΗ")} // ${asOfLabel}`}
        </div>

        <div className="clock-block">
          <span>
            {localize(
              language,
              "AREA TIME · PLOMARI",
              "ΩΡΑ ΠΕΡΙΟΧΗΣ · ΠΛΩΜΑΡΙ",
            )}
          </span>
          <div className="clock-line">
            <time dateTime={clockIso ?? undefined}>
              <strong aria-live="polite">
                {clockEpoch === null ? "—" : clock}
              </strong>
            </time>
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
              isLive
                ? "FIRE BOARD AUTO · 112 MANUAL"
                : "CLOCK IS CURRENT · MAP IS HISTORICAL",
              isLive
                ? "ΑΥΤΟΜΑΤΗ ΕΝΗΜΕΡΩΣΗ Π.Σ. · ΧΕΙΡΟΚΙΝΗΤΗ ΕΠΑΛΗΘΕΥΣΗ 112"
                : "ΤΡΕΧΟΝ ΡΟΛΟΪ · ΙΣΤΟΡΙΚΟΣ ΧΑΡΤΗΣ",
            )}
          </small>
        </div>
      </header>

      <section
        className="time-scrubber"
        aria-label={localize(
          language,
          "Global incident time",
          "Καθολικός χρόνος συμβάντος",
        )}
      >
        <div className="time-scrubber__meta">
          <span>
            {localize(language, "MAP CUTOFF", "ΧΡΟΝΙΚΟ ΟΡΙΟ ΧΑΡΤΗ")}
          </span>
          <strong>
            {isLive
              ? `${localize(language, "NOW", "ΤΩΡΑ")} · ${
                  clockEpoch === null ? "—" : clock
                }`
              : `${localize(language, "AS OF", "ΕΩΣ")} ${asOfLabel}`}
          </strong>
          <small>
            {localize(
              language,
              isLive ? "AUTO-REFRESH ON" : "AUTO-REFRESH PAUSED",
              isLive ? "ΑΥΤΟΜΑΤΗ ΑΝΑΝΕΩΣΗ ΕΝΕΡΓΗ" : "ΑΥΤΟΜΑΤΗ ΑΝΑΝΕΩΣΗ ΣΕ ΠΑΥΣΗ",
            )}
          </small>
        </div>
        <label className="time-scrubber__range">
          <span className="sr-only">
            {localize(
              language,
              "Show incident data as of a selected time",
              "Προβολή δεδομένων συμβάντος έως επιλεγμένη ώρα",
            )}
          </span>
          <input
            type="range"
            min={INCIDENT_STARTED_EPOCH}
            max={ageEpoch}
            step={AS_OF_STEP_MS}
            value={asOfEpoch ?? ageEpoch}
            suppressHydrationWarning
            aria-valuetext={
              isLive
                ? localize(language, "Live, current time", "Ζωντανά, τρέχουσα ώρα")
                : `${localize(language, "As of", "Έως")} ${asOfLabel}`
            }
            onChange={(event) =>
              updateAsOfFromRange(Number(event.currentTarget.value))
            }
            onPointerDown={beginAsOfPointerScrub}
            onPointerUp={finishAsOfPointerScrub}
            onPointerCancel={finishAsOfPointerScrub}
            onKeyDown={onAsOfKeyDown}
            onKeyUp={onAsOfKeyUp}
            onBlur={commitAsOfScrub}
          />
          <span className="time-scrubber__bounds">
            <small>
              {localize(language, "INCIDENT START", "ΕΝΑΡΞΗ ΣΥΜΒΑΝΤΟΣ")} ·{" "}
              <time dateTime={INCIDENT_STARTED_AT}>{incidentStartedLabel}</time>
            </small>
            <small>
              {localize(
                language,
                "RANGE END · NOW",
                "ΤΕΛΟΣ ΕΥΡΟΥΣ · ΤΩΡΑ",
              )}{" "}
              ·{" "}
              {clockEpoch === null ? "—" : clock}
            </small>
          </span>
        </label>
        <button
          type="button"
          className={isLive ? "is-active" : ""}
          onClick={() => {
            pendingThermalAsOfEpoch.current = null;
            setAsOfEpoch(null);
            setCommittedThermalAsOfEpoch(null);
          }}
          aria-pressed={isLive}
        >
          {localize(language, "RETURN TO NOW", "ΕΠΙΣΤΡΟΦΗ ΣΤΟ ΤΩΡΑ")}
        </button>
      </section>

      {showArchivedOfficialAlert && (alertCollapsed ? (
        <button
          type="button"
          className="evacuation-collapsed"
          onClick={() => setAlertCollapsedPersistent(false)}
          aria-expanded={false}
        >
          <b>112</b>
          <span>
            {localize(
              language,
              `ARCHIVED 112 · ISSUED ${officialAlertIssuedLabel} · SHOW`,
              `ΑΡΧΕΙΟ 112 · ΕΚΔΟΘΗΚΕ ${officialAlertIssuedLabel} · ΕΜΦΑΝΙΣΗ`,
            )}
          </span>
        </button>
      ) : (
      <section
        className="evacuation-banner"
        aria-label={localize(
          language,
          `Archived 112 instruction issued ${officialAlertIssuedLabel}; not a current verification`,
          `Αρχειοθετημένη οδηγία 112 που εκδόθηκε ${officialAlertIssuedLabel}· όχι τρέχουσα επαλήθευση`,
        )}
      >
        <button
          type="button"
          className="evacuation-hide"
          onClick={() => setAlertCollapsedPersistent(true)}
          aria-label={localize(
            language,
            "Collapse archived 112 banner",
            "Σύμπτυξη αρχειοθετημένου πλαισίου 112",
          )}
        >
          ×
        </button>
        <div className="evacuation-code">112</div>
        <div className="evacuation-copy">
          <span className="evacuation-archive-tag">
            {localize(language, "ARCHIVED 112 · ISSUED", "ΑΡΧΕΙΟ 112 · ΕΚΔΟΘΗΚΕ")}{" "}
            <time dateTime={OFFICIAL_ALERT_ISSUED_AT}>
              {officialAlertIssuedLabel}
            </time>{" "}
            · {localize(language, "NOT LIVE", "ΟΧΙ ΖΩΝΤΑΝΗ ΕΝΗΜΕΡΩΣΗ")}
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
            {localize(
              language,
              isLive
                ? `Original alert issued ${officialAlertIssuedLabel} · ${officialReviewLabel}. This banner reproduces that instruction; it is not proof that it remains current. Follow any newer 112 message and authorities on the ground.`
                : `Original alert issued ${officialAlertIssuedLabel}. It is shown because its source time is at or before the selected time; no later verification is imported into this view.`,
              isLive
                ? `Η αρχική ειδοποίηση εκδόθηκε ${officialAlertIssuedLabel} · ${officialReviewLabel}. Το πλαίσιο αναπαράγει εκείνη την οδηγία· δεν αποδεικνύει ότι παραμένει σε ισχύ. Ακολουθείτε κάθε νεότερο μήνυμα 112 και τις επί τόπου οδηγίες των Αρχών.`
                : `Η αρχική ειδοποίηση εκδόθηκε ${officialAlertIssuedLabel}. Εμφανίζεται επειδή ο χρόνος πηγής είναι έως την επιλεγμένη στιγμή· δεν εισάγεται μεταγενέστερη επαλήθευση.`,
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
      ))}

      <nav
        className="view-controls"
        aria-label={localize(language, "Map style", "Υπόβαθρο χάρτη")}
      >
        {(["satellite", "terrain", "dark"] as BaseMode[]).map((mode) => (
          <button
            type="button"
            key={mode}
            className={baseMode === mode ? "is-active" : ""}
            onClick={() => {
              setBaseTilesFailed(false);
              setBaseMode(mode);
            }}
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

      <GlobalDiscoveryLink language={language} variant="desktop" />

      <button
        type="button"
        className={`locate-control${
          geoStatus === "on" || geoStatus === "locating" ? " is-active" : ""
        }`}
        onClick={toggleLocate}
        aria-pressed={geoStatus === "on" || geoStatus === "locating"}
      >
        {geoStatus === "locating"
          ? localize(language, "LOCATING…", "ΕΝΤΟΠΙΣΜΟΣ…")
          : localize(language, "MY POSITION", "Η ΘΕΣΗ ΜΟΥ")}
      </button>

      {hasLocationFeedback && !compact && (
        <div
          className={`locate-readout${userReadout ? "" : " locate-readout--error"}`}
          role="status"
        >
          {locationDetailContent}
        </div>
      )}

      {hasLocationFeedback && compact && (
        <MobileLocationSummary
          title={
            userPosition
              ? `GPS ±${Math.round(userPosition.accuracyM)} m`
              : geoStatus === "locating"
                ? localize(language, "LOCATING", "ΕΝΤΟΠΙΣΜΟΣ")
                : localize(
                    language,
                    "LOCATION UNAVAILABLE",
                    "Η ΘΕΣΗ ΔΕΝ ΕΙΝΑΙ ΔΙΑΘΕΣΙΜΗ",
                  )
          }
          detail={locationSummaryDetail}
          actionLabel={localize(language, "DETAILS", "ΛΕΠΤΟΜΕΡΕΙΕΣ")}
          accessibleLabel={localize(
            language,
            `Open location details. ${locationSummaryDetail}`,
            `Άνοιγμα λεπτομερειών θέσης. ${locationSummaryDetail}`,
          )}
          expanded={locationSheetOpen}
          onOpen={openLocationSheet}
        />
      )}

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
        onClick={() => setPanelOpen((value) => !value)}
        aria-expanded={panelOpen}
        aria-controls="layers-sheet"
      >
        {panelOpen
          ? localize(language, "HIDE PANEL", "ΑΠΟΚΡΥΨΗ ΠΙΝΑΚΑ")
          : localize(language, "PANEL", "ΠΙΝΑΚΑΣ")}
        {wireBadge && (
          <>
            <i className="wire-badge" aria-hidden="true" />
            <span className="sr-only">
              {localize(
                language,
                "Unread action update",
                "Μη αναγνωσμένη ενημέρωση ενέργειας",
              )}
            </span>
          </>
        )}
      </button>

      <aside
        ref={panelElement}
        className="layer-hud"
        id="layers-sheet"
        hidden={!panelOpen}
        aria-label={
          layerTab === "location"
            ? localize(language, "Location details", "Λεπτομέρειες θέσης")
            : localize(language, "Data layers", "Επίπεδα δεδομένων")
        }
        style={
          panelPos && !compact
            ? {
                left: panelPos.x,
                top: panelPos.y,
                right: "auto",
                bottom: "auto",
                maxHeight: `calc(100dvh - ${panelPos.y + DESKTOP_PANEL_BOTTOM + DESKTOP_PANEL_GAP}px)`,
              }
            : undefined
        }
      >
          <div className="hud-heading">
            <div>
              <span>
                {
                  {
                    layers: localize(
                      language,
                      "DATA LAYERS",
                      "ΕΠΙΠΕΔΑ ΔΕΔΟΜΕΝΩΝ",
                    ),
                    thermal: localize(
                      language,
                      "SATELLITE THERMAL",
                      "ΔΟΡΥΦΟΡΙΚΑ ΘΕΡΜΙΚΑ",
                    ),
                    wind: localize(
                      language,
                      "WIND MODEL",
                      "ΜΟΝΤΕΛΟ ΑΝΕΜΟΥ",
                    ),
                    updates: localize(
                      language,
                      "LOCAL FEED READER",
                      "ΤΟΠΙΚΟΣ ΑΝΑΓΝΩΣΤΗΣ ΡΟΩΝ",
                    ),
                    location: localize(
                      language,
                      "MY LOCATION",
                      "Η ΘΕΣΗ ΜΟΥ",
                    ),
                  }[layerTab]
                }
              </span>
              <small>
                {layerTab === "location"
                  ? localize(
                      language,
                      "EXACT FIX ON DEVICE · COARSE AREA ONLY TO FIREWATCH",
                      "ΑΚΡΙΒΕΣ ΣΗΜΕΙΟ ΣΤΗ ΣΥΣΚΕΥΗ · ΜΟΝΟ ΕΥΡΕΙΑ ΠΕΡΙΟΧΗ ΣΤΟ FIREWATCH",
                    )
                  : layerTab === "updates"
                  ? !isLive
                    ? localize(
                        language,
                        `DATED ITEMS ≤ ${asOfLabel}`,
                        `ΧΡΟΝΟΛΟΓΗΜΕΝΑ ΣΤΟΙΧΕΙΑ ≤ ${asOfLabel}`,
                      )
                    : updatesStaleSnapshot
                      ? localize(
                          language,
                          "GREECE TIME // SNAPSHOT · RETRYING",
                          "ΩΡΑ ΕΛΛΑΔΑΣ // ΣΤΙΓΜΙΟΤΥΠΟ · ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ",
                        )
                      : localize(
                          language,
                          `GREECE TIME // SHARED SNAPSHOT ${updatesRetrievedTime}`,
                          `ΩΡΑ ΕΛΛΑΔΑΣ // ΚΟΙΝΟ ΣΤΙΓΜΙΟΤΥΠΟ ${updatesRetrievedTime}`,
                        )
                  : localize(
                      language,
                      "10 LAYERS // SOURCE + FRESHNESS VISIBLE",
                      "10 ΕΠΙΠΕΔΑ // ΟΡΑΤΗ ΠΗΓΗ + ΩΡΑ ΕΝΗΜΕΡΩΣΗΣ",
                    )}
              </small>
            </div>
            <div className="hud-heading__actions">
              {layerTab === "updates" && (
                <span
                  className={`recording-dot${isLive ? "" : " recording-dot--historical"}`}
                >
                  {isLive
                    ? localize(language, "REC", "ΖΩΝΤΑΝΑ")
                    : localize(language, "AS OF", "ΕΩΣ")}
                </span>
              )}
              {layerTab !== "location" && (
                <>
                  <button
                    type="button"
                    className="panel-move"
                    onPointerDown={onPanelDragStart}
                    onPointerMove={onPanelDragMove}
                    onPointerUp={onPanelDragEnd}
                    onPointerCancel={onPanelDragEnd}
                    onKeyDown={onPanelMoveKeyDown}
                    onDoubleClick={() => setPanelPos(null)}
                    aria-label={localize(
                      language,
                      "Move panel with arrow keys; Home or double-click resets position",
                      "Μετακίνηση πίνακα με τα βέλη· Home ή διπλό κλικ για επαναφορά",
                    )}
                    title={localize(
                      language,
                      "Drag or use arrow keys · Home/double-click resets",
                      "Σύρετε ή χρησιμοποιήστε τα βέλη · Home/διπλό κλικ για επαναφορά",
                    )}
                  >
                    ✥
                  </button>
                  <button type="button" onClick={showOperationalView}>
                    {localize(language, "FRAME", "ΠΡΟΒΟΛΗ")}
                  </button>
                </>
              )}
              <button
                type="button"
                className="sheet-close"
                onClick={closePanels}
                aria-label={localize(
                  language,
                  layerTab === "location"
                    ? "Close location details"
                    : "Close layers",
                  layerTab === "location"
                    ? "Κλείσιμο λεπτομερειών θέσης"
                    : "Κλείσιμο επιπέδων",
                )}
              >
                ×
              </button>
            </div>
          </div>

          {layerTab !== "location" && (
            <div
              className="hud-tabs"
              role="tablist"
              aria-orientation="horizontal"
              aria-label={localize(
                language,
                "Layer panel sections",
                "Ενότητες πίνακα επιπέδων",
              )}
            >
            {(
              [
                ["layers", localize(language, "LAYERS", "ΕΠΙΠΕΔΑ")],
                ["thermal", localize(language, "THERMAL", "ΘΕΡΜΙΚΑ")],
                ["wind", localize(language, "WIND", "ΑΝΕΜΟΣ")],
                ["updates", localize(language, "FEEDS", "ΡΟΕΣ")],
              ] as Array<[LayerTab, string]>
            ).map(([tab, label]) => (
              <button
                type="button"
                key={tab}
                id={`layers-tab-${tab}`}
                role="tab"
                aria-selected={layerTab === tab}
                aria-controls={`layers-panel-${tab}`}
                tabIndex={layerTab === tab ? 0 : -1}
                className={layerTab === tab ? "is-active" : ""}
                onClick={() => selectLayerTab(tab)}
                onKeyDown={(event) => onLayerTabKeyDown(event, tab)}
              >
                {label}
                {tab === "updates" && wireBadge && (
                  <>
                    <i className="wire-badge" aria-hidden="true" />
                    <span className="sr-only">
                      {localize(
                        language,
                        "Unread action update",
                        "Μη αναγνωσμένη ενημέρωση ενέργειας",
                      )}
                    </span>
                  </>
                )}
              </button>
            ))}
            </div>
          )}

          <section
            className="location-context"
            aria-label={localize(
              language,
              "Device location context",
              "Πληροφορίες θέσης συσκευής",
            )}
            hidden={layerTab !== "location"}
          >
            {locationDetailContent}
          </section>

          <div
            id="layers-panel-layers"
            className="hud-tabpanel"
            role="tabpanel"
            aria-labelledby="layers-tab-layers"
            hidden={layerTab !== "layers"}
          >
          <div className="layer-stack">
            {[
              {
                key: "evacRoute" as LayerKey,
                accent: "#55ddff",
                icon: "→",
                label: localize(
                  language,
                  "App-drawn archived road reference",
                  "Αρχειοθετημένη οδική αναφορά εφαρμογής",
                ),
                detail: localize(
                  language,
                  showArchivedOfficialAlert
                    ? "Between 112 endpoints · not an official route"
                    : "112 not yet issued at this time",
                  showArchivedOfficialAlert
                    ? "Μεταξύ σημείων 112 · όχι επίσημη διαδρομή"
                    : "Το 112 δεν είχε ακόμη εκδοθεί",
                ),
                count: showArchivedOfficialAlert ? "3 km" : "—",
              },
              {
                key: "official" as LayerKey,
                accent: "#f59e0b",
                icon: "◉",
                label: localize(
                  language,
                  "Incident area (official)",
                  "Περιοχή συμβάντος (επίσημη)",
                ),
                detail: localize(
                  language,
                  "Landfill site · perimeter not published",
                  "Θέση ΧΑΔΑ · δεν έχει δημοσιευθεί περίμετρος",
                ),
                count: "1",
              },
              {
                key: "satellite" as LayerKey,
                accent: "#ff4d32",
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
                key: "satelliteCoverage" as LayerKey,
                accent: satellitePassStale ? "#ffb347" : "#55ddff",
                icon: "◇",
                label: localize(
                  language,
                  "Satellite catalog coverage",
                  "Κάλυψη δορυφορικού καταλόγου",
                ),
                detail: satellitePassLayerDetail,
                count: !isLive
                  ? "LIVE"
                  : satellitePassArea.loading || satellitePassUnavailable
                    ? "—"
                    : satellitePassCount,
              },
              {
                key: "satelliteRaster" as LayerKey,
                accent: "#ff9f1c",
                icon: "▧",
                label: localize(
                  language,
                  "Daily thermal raster",
                  "Ημερήσιο θερμικό επίπεδο",
                ),
                detail: localize(
                  language,
                  isLive
                    ? `REQUESTED IMAGE DATE · ${requestedImageDate} · ACQUISITION TIME UNKNOWN`
                    : "Current-only daily composite · hidden",
                  isLive
                    ? `ΗΜΕΡΟΜΗΝΙΑ ΖΗΤΟΥΜΕΝΗΣ ΕΙΚΟΝΑΣ · ${requestedImageDate} · ΑΓΝΩΣΤΗ ΩΡΑ ΛΗΨΗΣ`
                    : "Τρέχον ημερήσιο σύνθετο · κρυφό",
                ),
                count: isLive ? "IMG" : "LIVE",
              },
              {
                key: "local" as LayerKey,
                accent: "#ffb347",
                icon: "△",
                label: localize(
                  language,
                  "Field-reported areas (approx.)",
                  "Περιοχές αναφοράς πεδίου (κατά προσ.)",
                ),
                detail: localize(
                  language,
                  showFieldReport
                    ? `1 report · 2 reference areas · reported ${fieldReportLabel}`
                    : `No eligible field area yet · report at ${fieldReportLabel}`,
                  showFieldReport
                    ? `1 αναφορά · 2 περιοχές αναφοράς · αναφέρθηκε ${fieldReportLabel}`
                    : `Καμία επιλέξιμη περιοχή ακόμη · αναφορά ${fieldReportLabel}`,
                ),
                count: showFieldReport ? "1R/2A" : "—",
              },
              {
                key: "wind" as LayerKey,
                accent: "#39f2c5",
                icon: "↙",
                label: localize(
                  language,
                  "Wind profile",
                  "Προφίλ ανέμου",
                ),
                detail: localize(
                  language,
                  isLive
                    ? fireWind
                      ? `MODEL VALID · ${windObservedTime} · checks every 5 min`
                      : windError
                        ? "MODEL UNAVAILABLE · no fallback values shown"
                        : "CHECKING MODEL · no fallback values shown"
                    : "Current-only model · hidden in history",
                  isLive
                    ? fireWind
                      ? `ΜΟΝΤΕΛΟ ΓΙΑ · ${windObservedTime} · έλεγχος κάθε 5 λεπτά`
                      : windError
                        ? "ΤΟ ΜΟΝΤΕΛΟ ΔΕΝ ΕΙΝΑΙ ΔΙΑΘΕΣΙΜΟ · χωρίς εφεδρικές τιμές"
                        : "ΕΛΕΓΧΟΣ ΜΟΝΤΕΛΟΥ · χωρίς εφεδρικές τιμές"
                    : "Μόνο τρέχον μοντέλο · κρυφό στο ιστορικό",
                ),
                count: isLive && fireWind ? "4" : "—",
              },
              {
                key: "smokeObserved" as LayerKey,
                accent: "#d4c7ff",
                icon: "◌",
                label: localize(
                  language,
                  "Satellite aerosol / smoke",
                  "Δορυφορικό αερόλυμα / καπνός",
                ),
                detail: localize(
                  language,
                  isLive
                    ? "NASA VIIRS NRT · daylight snapshot"
                    : "Current-only daily composite · hidden",
                  isLive
                    ? "NASA VIIRS NRT · ημερήσιο στιγμιότυπο"
                    : "Τρέχον ημερήσιο σύνθετο · κρυφό",
                ),
                count: isLive ? "NRT" : "LIVE",
              },
              {
                key: "smoke" as LayerKey,
                accent: "#b9a4ff",
                icon: "≈",
                label: localize(
                  language,
                  "Smoke transport proxy",
                  "Ενδεικτική μεταφορά καπνού",
                ),
                detail: localize(
                  language,
                  isLive
                    ? fireWind
                      ? "Modeled wind envelope · not PM2.5"
                      : "Waiting for dated wind model · hidden"
                    : "Depends on current wind · hidden",
                  isLive
                    ? fireWind
                      ? "Μοντελοποιημένη ζώνη ανέμου · όχι μέτρηση PM2.5"
                      : "Αναμονή χρονολογημένου μοντέλου ανέμου · κρυφή"
                    : "Βασίζεται στον τρέχοντα άνεμο · κρυφή",
                ),
                count:
                  isLive && fireWind ? `H+${smokeMinutes} MIN` : "—",
              },
              {
                key: "simulation" as LayerKey,
                accent: "#ffcf4a",
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
            ].map((layer) => {
              const currentOnly =
                !isLive && CURRENT_ONLY_LAYER_KEYS.has(layer.key);
              return (
                <button
                  type="button"
                  className={`layer-control${layers[layer.key] && !currentOnly ? " is-enabled" : ""}${currentOnly ? " is-current-only" : ""}`}
                  key={layer.key}
                  onClick={() => toggleLayer(layer.key)}
                  aria-pressed={currentOnly ? false : layers[layer.key]}
                  disabled={currentOnly}
                  style={{ "--accent": layer.accent } as CSSProperties}
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
              );
            })}
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
          </div>

          <section
            id="layers-panel-thermal"
            className="thermal-key"
            role="tabpanel"
            aria-labelledby="layers-tab-thermal"
            hidden={layerTab !== "thermal"}
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
                    : isLive &&
                        (thermalData?.status === "partial" ||
                          thermalStaleSnapshot)
                      ? "is-partial"
                      : ""
                }
              >
                {thermalLoading
                  ? localize(language, "LOADING", "ΦΟΡΤΩΣΗ")
                  : thermalUnavailable
                    ? localize(language, "UNAVAILABLE", "ΜΗ ΔΙΑΘΕΣΙΜΗ")
                    : !isLive
                      ? localize(language, "AS-OF FILTER", "ΦΙΛΤΡΟ ΕΩΣ")
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
                  {localize(language, "OBSERVED", "ΠΑΡΑΤΗΡΗΘΗΚΕ")} ·{" "}
                  <time
                    dateTime={zonedDateTimeAttribute(thermalLatestObservedAt)}
                  >
                    {thermalLatestTime}
                  </time>{" "}
                  · {thermalLatestAge}
                </small>
              </div>
            )}

            <div
              className={`thermal-summary satellite-coverage-summary${satellitePassStale ? " is-stale" : ""}`}
            >
              <strong>
                {localize(
                  language,
                  "CMR PASS COVERAGE · CATALOG METADATA",
                  "ΚΑΛΥΨΗ ΔΙΕΛΕΥΣΕΩΝ CMR · ΜΕΤΑΔΕΔΟΜΕΝΑ ΚΑΤΑΛΟΓΟΥ",
                )}
              </strong>
              <small>
                {satellitePassPresentation === "current-only-withheld"
                  ? localize(
                      language,
                      "CURRENT-ONLY · WITHHELD AT THE SELECTED HISTORICAL TIME",
                      "ΜΟΝΟ ΤΡΕΧΟΥΣΑ · ΑΠΟΚΡΥΠΤΕΤΑΙ ΣΤΗΝ ΕΠΙΛΕΓΜΕΝΗ ΙΣΤΟΡΙΚΗ ΩΡΑ",
                    )
                  : satellitePassPresentation === "loading"
                    ? localize(
                        language,
                        "CHECKING PERSISTED COVERAGE",
                        "ΕΛΕΓΧΟΣ ΑΠΟΘΗΚΕΥΜΕΝΗΣ ΚΑΛΥΨΗΣ",
                      )
                    : satellitePassPresentation === "unavailable"
                      ? localize(
                          language,
                          "PERSISTED COVERAGE UNAVAILABLE",
                          "Η ΑΠΟΘΗΚΕΥΜΕΝΗ ΚΑΛΥΨΗ ΔΕΝ ΕΙΝΑΙ ΔΙΑΘΕΣΙΜΗ",
                        )
                      : satellitePassPresentation === "stale" ||
                          satellitePassPresentation === "stale-valid-empty"
                        ? localize(
                            language,
                            satellitePassPresentation === "stale-valid-empty"
                              ? "CACHED OR STALE SNAPSHOT · ITS LAST COMPLETED WINDOW HAD NO CATALOG FOOTPRINT INTERSECTIONS"
                              : "CACHED, STALE, OR INCOMPLETE CATALOG COVERAGE · DO NOT TREAT AS CURRENT",
                            satellitePassPresentation === "stale-valid-empty"
                              ? "ΑΠΟΘΗΚΕΥΜΕΝΟ Ή ΠΑΛΙΟ ΣΤΙΓΜΙΟΤΥΠΟ · ΣΤΟ ΤΕΛΕΥΤΑΙΟ ΟΛΟΚΛΗΡΩΜΕΝΟ ΠΑΡΑΘΥΡΟ ΤΟΥ ΔΕΝ ΥΠΗΡΧΑΝ ΤΟΜΕΣ ΑΠΟΤΥΠΩΜΑΤΩΝ ΚΑΤΑΛΟΓΟΥ"
                              : "ΑΠΟΘΗΚΕΥΜΕΝΗ, ΠΑΛΙΑ Ή ΕΛΛΙΠΗΣ ΚΑΛΥΨΗ ΚΑΤΑΛΟΓΟΥ · ΜΗΝ ΤΗ ΘΕΩΡΕΙΤΕ ΤΡΕΧΟΥΣΑ",
                          )
                        : satellitePassPresentation === "valid-empty"
                          ? localize(
                              language,
                              "NO CATALOG FOOTPRINT INTERSECTIONS IN THE COMPLETED WINDOW",
                              "ΚΑΜΙΑ ΤΟΜΗ ΑΠΟΤΥΠΩΜΑΤΟΣ ΚΑΤΑΛΟΓΟΥ ΣΤΟ ΟΛΟΚΛΗΡΩΜΕΝΟ ΠΑΡΑΘΥΡΟ",
                            )
                          : satellitePassPresentation === "indeterminate-empty"
                            ? localize(
                                language,
                                "EMPTY RESULT INDETERMINATE · COVERAGE IS INCOMPLETE OR NOT ELIGIBLE",
                                "ΑΠΡΟΣΔΙΟΡΙΣΤΟ ΚΕΝΟ ΑΠΟΤΕΛΕΣΜΑ · Η ΚΑΛΥΨΗ ΕΙΝΑΙ ΕΛΛΙΠΗΣ Ή ΜΗ ΕΠΙΛΕΞΙΜΗ",
                              )
                            : localize(
                                language,
                                `${satellitePassData?.page.truncated ? "AT LEAST " : ""}${satellitePasses.length} CATALOG FOOTPRINTS`,
                                `${satellitePassData?.page.truncated ? "ΤΟΥΛΑΧΙΣΤΟΝ " : ""}${satellitePasses.length} ΑΠΟΤΥΠΩΜΑΤΑ ΚΑΤΑΛΟΓΟΥ`,
                              )}
              </small>
              {isLive && satellitePassData && (
                <small>
                  {localize(language, "SCAN CHECKED", "ΕΛΕΓΧΟΣ ΣΑΡΩΣΗΣ")} ·{" "}
                  <time
                    dateTime={zonedDateTimeAttribute(
                      satellitePassData.scan.freshness.scanCheckedAt ??
                        satellitePassData.scan.freshness.checkedAt,
                    )}
                  >
                    {satellitePassCheckedTime}
                  </time>
                  {" · "}
                  {localize(
                    language,
                    "LATEST SOURCE OBSERVED IN RETURNED SCAN",
                    "ΝΕΟΤΕΡΗ ΠΑΡΑΤΗΡΗΣΗ ΠΗΓΗΣ ΣΤΗ ΣΑΡΩΣΗ",
                  )}
                  {" · "}
                  <time
                    dateTime={zonedDateTimeAttribute(
                      latestSatellitePass?.times.observedTo ??
                        satellitePassData.scan.freshness.latestSourceObservedAt,
                    )}
                  >
                    {satellitePassObservedTime}
                  </time>
                </small>
              )}
              <small className="satellite-coverage-caveat">
                {localize(
                  language,
                  "ANOMALIES NOT ASSESSED · A FOOTPRINT IS COVERAGE, NOT A HOTSPOT, AND DOES NOT CLEAR AN OLDER DETECTION.",
                  "ΔΕΝ ΕΓΙΝΕ ΑΞΙΟΛΟΓΗΣΗ ΑΝΩΜΑΛΙΩΝ · ΤΟ ΑΠΟΤΥΠΩΜΑ ΕΙΝΑΙ ΚΑΛΥΨΗ, ΟΧΙ ΘΕΡΜΟ ΣΗΜΕΙΟ, ΚΑΙ ΔΕΝ ΑΝΑΙΡΕΙ ΠΑΛΑΙΟΤΕΡΗ ΑΝΙΧΝΕΥΣΗ.",
                )}
              </small>
            </div>

            {!thermalLoading &&
              !thermalUnavailable &&
              thermalDetections.length > 0 && (
                <p className="thermal-message thermal-message--status" role="status">
                  {localize(
                    language,
                    `LATEST DETECTION · ${thermalLatestTime}. FEED CHECKED · ${thermalRetrievedTime}. No newer detection is listed; this hotspot feed cannot tell whether a later pass saw no anomaly.`,
                    `ΝΕΟΤΕΡΗ ΑΝΙΧΝΕΥΣΗ · ${thermalLatestTime}. ΕΛΕΓΧΟΣ ΡΟΗΣ · ${thermalRetrievedTime}. Δεν καταγράφεται νεότερη ανίχνευση· αυτή η ροή θερμών σημείων δεν μπορεί να δείξει αν μεταγενέστερη διέλευση δεν βρήκε ανωμαλία.`,
                  )}
                </p>
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
                <p className="thermal-message thermal-message--status" role="status">
                  {localize(
                    language,
                    `NO THERMAL DETECTIONS RETURNED · CHECKED ${thermalRetrievedTime}. This is not an all-clear; clouds, satellite timing, missing coverage, and sensor limits can hide activity.`,
                    `ΔΕΝ ΕΠΙΣΤΡΑΦΗΚΑΝ ΘΕΡΜΙΚΕΣ ΑΝΙΧΝΕΥΣΕΙΣ · ΕΛΕΓΧΟΣ ${thermalRetrievedTime}. Αυτό δεν αποτελεί λήξη συναγερμού· νέφη, χρόνος διέλευσης, έλλειψη κάλυψης και περιορισμοί αισθητήρων μπορεί να αποκρύπτουν δραστηριότητα.`,
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
              {localize(
                language,
                isLive
                  ? `RETRIEVED · ${thermalRetrievedTime} · active-incident check every ${thermalPollMinutes} min while this tab is visible; satellite passes are not continuous`
                  : `Historical FIRMS UTC coverage ${thermalHistoricalCoverage} · RETRIEVED · ${thermalRetrievedTime} · exact as-of and 24-hour filters are applied locally; a complete historical archive is not guaranteed`,
                isLive
                  ? `ΑΝΑΚΤΗΣΗ · ${thermalRetrievedTime} · έλεγχος ενεργού συμβάντος κάθε ${thermalPollMinutes} λεπτά όσο η καρτέλα είναι ορατή· οι δορυφορικές διελεύσεις δεν είναι συνεχείς`
                  : `Ιστορική κάλυψη FIRMS UTC ${thermalHistoricalCoverage} · ΑΝΑΚΤΗΣΗ · ${thermalRetrievedTime} · τα ακριβή φίλτρα χρονικής στιγμής και 24 ωρών εφαρμόζονται τοπικά· δεν διασφαλίζεται πλήρες ιστορικό αρχείο`,
              )}
            </small>
          </section>

          <div
            id="layers-panel-wind"
            className={`wind-readout${isLive ? "" : " wind-readout--withheld"}`}
            role="tabpanel"
            aria-labelledby="layers-tab-wind"
            hidden={layerTab !== "wind"}
          >
            {isLive && fireWind && downwindHeading !== null ? (
              <>
                <div className="wind-readout__head">
              <span>
                {localize(
                  language,
                  "FIRE-GRID WIND MODEL",
                  "ΜΟΝΤΕΛΟ ΑΝΕΜΟΥ ΣΤΗΝ ΕΣΤΙΑ",
                )}
              </span>
              <strong className={windStaleSnapshot ? "is-stale" : ""}>
                {windStaleSnapshot
                  ? localize(
                      language,
                      "SNAPSHOT / RETRYING",
                      "ΣΤΙΓΜΙΟΤΥΠΟ / ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ",
                    )
                  : localize(
                      language,
                      `MODEL VALID · ${windObservedTime}`,
                      `ΜΟΝΤΕΛΟ ΓΙΑ · ${windObservedTime}`,
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
                    "LGMT OBSERVED",
                    "LGMT · ΠΑΡΑΤΗΡΗΘΗΚΕ",
                  )}{" "}
                  ·{" "}
                  <time
                    dateTime={zonedDateTimeAttribute(
                      windData.metar.observedAt,
                    )}
                  >
                    {formatAreaDateTime(
                      windData.metar.observedAt,
                      language,
                    )}
                  </time>
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
                  +{smokeMinutes} {localize(language, "MIN", "ΛΕΠΤΑ")}
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
                `From ${compass(fireWind.wind10.directionDeg, language)} toward ${compass(downwindHeading, language)}. Point-model wind is not fire spread; terrain and gusts can change local flow. FETCHED · ${retrievedTime} · checks every 5 min.`,
                `Από ${compass(fireWind.wind10.directionDeg, language)} προς ${compass(downwindHeading, language)}. Το μοντέλο ανέμου σε σημείο δεν προβλέπει την εξάπλωση της φωτιάς· το ανάγλυφο και οι ριπές μπορούν να μεταβάλουν την τοπική ροή. ΑΝΑΚΤΗΣΗ · ${retrievedTime} · έλεγχος κάθε 5 λεπτά.`,
              )}
                </p>
              </>
            ) : (
              <div className="current-only-notice">
                <strong>
                  {localize(
                    language,
                    isLive
                      ? windError
                        ? "MODEL UNAVAILABLE"
                        : "CHECKING MODEL"
                      : "CURRENT-ONLY WIND WITHHELD",
                    isLive
                      ? windError
                        ? "ΤΟ ΜΟΝΤΕΛΟ ΔΕΝ ΕΙΝΑΙ ΔΙΑΘΕΣΙΜΟ"
                        : "ΕΛΕΓΧΟΣ ΜΟΝΤΕΛΟΥ"
                      : "ΑΠΟΚΡΥΨΗ ΤΡΕΧΟΝΤΟΣ ΑΝΕΜΟΥ",
                  )}
                </strong>
                <p>
                  {localize(
                    language,
                    isLive
                      ? "No fallback wind values are displayed. The map will add vectors when a dated model response is available."
                      : "This endpoint returns the latest model and airport observation, not a historical series. Return to now to view it.",
                    isLive
                      ? "Δεν εμφανίζονται εφεδρικές τιμές ανέμου. Ο χάρτης θα προσθέσει διανύσματα όταν υπάρχει χρονολογημένη απόκριση μοντέλου."
                      : "Αυτή η πηγή επιστρέφει το νεότερο μοντέλο και την παρατήρηση αεροδρομίου, όχι ιστορική σειρά. Επιστρέψτε στο τώρα.",
                  )}
                </p>
              </div>
            )}
          </div>
          <div
            id="layers-panel-updates"
            className="hud-tabpanel"
            role="tabpanel"
            aria-labelledby="layers-tab-updates"
            hidden={layerTab !== "updates"}
          >
          <div className="feed-reader-status" role="status">
            <span>
              {localize(
                language,
                "LOCAL RSS + OFFICIAL READER",
                "ΤΟΠΙΚΟΣ ΑΝΑΓΝΩΣΤΗΣ RSS + ΕΠΙΣΗΜΩΝ ΡΟΩΝ",
              )}
            </span>
            <strong>
              {updatesData
                ? localize(
                    language,
                    `${updatesData.items.length} INCIDENT-MATCHED ITEMS · ${updatesData.sourceSummary.online}/${updatesData.sourceSummary.total} SOURCES REACHABLE`,
                    `${updatesData.items.length} ΣΧΕΤΙΚΑ ΣΤΟΙΧΕΙΑ · ${updatesData.sourceSummary.online}/${updatesData.sourceSummary.total} ΠΗΓΕΣ ΠΡΟΣΒΑΣΙΜΕΣ`,
                  )
                : localize(language, "CHECKING SHARED FEED SNAPSHOT", "ΕΛΕΓΧΟΣ ΚΟΙΝΟΥ ΣΤΙΓΜΙΟΤΥΠΟΥ ΡΟΩΝ")}
            </strong>
            <small>
              {localize(
                language,
                "Headlines, timestamps, and direct source links come from one server-curated cached snapshot; your browser does not fan out to publishers.",
                "Οι τίτλοι, οι χρονικές σημάνσεις και οι άμεσοι σύνδεσμοι προέρχονται από ένα κοινό στιγμιότυπο διακομιστή· ο φυλλομετρητής δεν καλεί ξεχωριστά κάθε εκδότη.",
              )}
            </small>
          </div>
          <div className="intel-list">
            {displayIntel.map((item) => (
              <div
                key={item.id}
                className={item.id === active.id ? "intel-item is-active" : "intel-item"}
              >
                <button
                  type="button"
                  className="intel-item__select"
                  onClick={() => setActiveIntel(item.id)}
                >
                  <time
                    dateTime={
                      item.dateOnly
                        ? item.occurredAt?.slice(0, 10)
                        : zonedDateTimeAttribute(item.occurredAt)
                    }
                  >
                    <span>{item.timeKind}</span>
                    <small>{item.time}</small>
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
                {item.sourceUrl && (
                  <a
                    className="intel-item__link"
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${localize(language, "Open source", "Άνοιγμα πηγής")}: ${
                      item.sourceLabel ??
                      localize(language, "article", "άρθρο")
                    }`}
                  >
                    ↗
                  </a>
                )}
              </div>
            ))}
          </div>

          <div className={`intel-detail intel-detail--${active.confidence}`}>
            <div className="intel-detail__meta">
              <time
                className="intel-detail__time"
                dateTime={
                  active.dateOnly
                    ? active.occurredAt?.slice(0, 10)
                    : zonedDateTimeAttribute(active.occurredAt)
                }
              >
                {active.timeKind} · {active.time}
              </time>
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

          {officialFallbackSources.length > 0 && (
            <div
              className="official-fallbacks"
              role="group"
              aria-label={localize(
                language,
                "Official direct-source fallbacks",
                "Εναλλακτικοί απευθείας επίσημοι σύνδεσμοι",
              )}
            >
              <span>
                {localize(
                  language,
                  "AUTOMATIC RETRIEVAL UNAVAILABLE — CHECK EACH OFFICIAL SOURCE DIRECTLY",
                  "Η ΑΥΤΟΜΑΤΗ ΑΝΑΚΤΗΣΗ ΔΕΝ ΕΙΝΑΙ ΔΙΑΘΕΣΙΜΗ — ΕΛΕΓΞΤΕ ΚΑΘΕ ΕΠΙΣΗΜΗ ΠΗΓΗ ΑΠΕΥΘΕΙΑΣ",
                )}
              </span>
              {officialFallbackSources.map((source) => (
                <a
                  key={source.id}
                  href={source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  <strong>{source.label}</strong>
                  <small>
                    {localize(
                      language,
                      "Automatic retrieval unavailable",
                      "Η αυτόματη ανάκτηση δεν είναι διαθέσιμη",
                    )}
                    {` · ${source.reason} · `}
                    {localize(language, "open direct ↗", "άνοιγμα πηγής ↗")}
                  </small>
                </a>
              ))}
            </div>
          )}

          <div className="source-health">
            <span>
              {localize(language, "SOURCE HEALTH", "ΚΑΤΑΣΤΑΣΗ ΠΗΓΩΝ")}
            </span>
            {!isLive ? (
              <>
                <strong>
                  {localize(
                    language,
                    "CURRENT-ONLY · NOT RECONSTRUCTED",
                    "ΜΟΝΟ ΤΡΕΧΟΥΣΑ · ΔΕΝ ΑΝΑΚΑΤΑΣΚΕΥΑΖΕΤΑΙ",
                  )}
                </strong>
                <small>
                  {localize(
                    language,
                    "Source reachability reflects the latest poll, so it is withheld from historical view.",
                    "Η προσβασιμότητα πηγών αφορά τον νεότερο έλεγχο και αποκρύπτεται από την ιστορική προβολή.",
                  )}
                </small>
              </>
            ) : sourceHealth ? (
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
            {isLive && (
              <small>
                {localize(
                  language,
                  "Reachable means the source responded—not that it published a new Plomari update.",
                  "Προσβάσιμη σημαίνει ότι η πηγή ανταποκρίθηκε—όχι ότι δημοσίευσε νέα ενημέρωση για το Πλωμάρι.",
                )}
              </small>
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
          </div>
      </aside>

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
          className={!panelOpen ? "is-active" : ""}
          onClick={closePanels}
          aria-pressed={!panelOpen}
        >
          <span aria-hidden="true">◎</span>
          <b>{localize(language, "MAP", "ΧΑΡΤΗΣ")}</b>
        </button>
        <button
          type="button"
          className={
            panelOpen && layerTab !== "updates" && layerTab !== "location"
              ? "is-active"
              : ""
          }
          onClick={() => {
            if (
              panelOpen &&
              layerTab !== "updates" &&
              layerTab !== "location"
            ) {
              setPanelOpen(false);
              return;
            }
            setLayerTab("layers");
            setPanelOpen(true);
          }}
          aria-expanded={
            panelOpen && layerTab !== "updates" && layerTab !== "location"
          }
          aria-controls="layers-sheet"
        >
          <span aria-hidden="true">☷</span>
          <b>{localize(language, "LAYERS", "ΕΠΙΠΕΔΑ")}</b>
        </button>
        <button
          type="button"
          className={panelOpen && layerTab === "updates" ? "is-active" : ""}
          onClick={() => {
            setWireBadge(false);
            if (panelOpen && layerTab === "updates") {
              setPanelOpen(false);
              return;
            }
            setLayerTab("updates");
            setPanelOpen(true);
          }}
          aria-expanded={panelOpen && layerTab === "updates"}
          aria-controls="layers-sheet"
        >
          <span aria-hidden="true">≡</span>
          <b>{localize(language, "UPDATES", "ΕΝΗΜΕΡΩΣΕΙΣ")}</b>
          {wireBadge && (
            <>
              <i className="wire-badge" aria-hidden="true" />
              <span className="sr-only">
                {localize(
                  language,
                  "Unread action update",
                  "Μη αναγνωσμένη ενημέρωση ενέργειας",
                )}
              </span>
            </>
          )}
        </button>
        <GlobalDiscoveryLink language={language} variant="mobile" />
      </nav>

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
              onChange={(event) => {
                const value = Number(event.target.value);
                if (isBeaufort(value)) setBeaufort(value);
              }}
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
                  isLive ? "SW · modeled downwind" : "SW · scenario heading",
                  isLive
                    ? "ΝΔ · μοντελοποιημένη υπήνεμη κατεύθυνση"
                    : "ΝΔ · κατεύθυνση σεναρίου",
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
          isLive ? "Current operating picture" : "Historical operating picture",
          isLive
            ? "Τρέχουσα επιχειρησιακή εικόνα"
            : "Ιστορική επιχειρησιακή εικόνα",
        )}
      >
        <div className="mission-primary">
          <span>
            {localize(
              language,
              isLive ? "OFFICIAL STATUS" : "OFFICIAL STATUS · CURRENT-ONLY",
              isLive
                ? "ΕΠΙΣΗΜΗ ΚΑΤΑΣΤΑΣΗ"
                : "ΕΠΙΣΗΜΗ ΚΑΤΑΣΤΑΣΗ · ΜΟΝΟ ΤΡΕΧΟΥΣΑ",
            )}
          </span>
          <strong>
            {isLive
              ? officialStatus
              : localize(language, "NOT RECONSTRUCTED", "ΔΕΝ ΑΝΑΚΑΤΑΣΚΕΥΑΖΕΤΑΙ")}
          </strong>
          <small>
            {localize(
              language,
              isLive
                ? `Fire Service CHECKED · ${fireServiceCheckedTime} · latest 112 instruction remains manual`
                : "Latest Fire Service board state is withheld from history",
              isLive
                ? `Πυροσβεστική ΕΛΕΓΧΘΗΚΕ · ${fireServiceCheckedTime} · χειροκίνητη επαλήθευση τελευταίας οδηγίας 112`
                : "Η νεότερη κατάσταση του πίνακα Π.Σ. αποκρύπτεται από το ιστορικό",
            )}
          </small>
        </div>
        <div>
          <span>
            {localize(language, "SATELLITE THERMAL · OBSERVED", "ΔΟΡΥΦΟΡΙΚΑ ΘΕΡΜΙΚΑ · ΠΑΡΑΤΗΡΗΘΗΚΕ")} ·{" "}
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
                : localize(
                    language,
                    `${thermalDetections.length} RECORDS · ${visibleThermalPasses} DETECTING PASSES`,
                    `${thermalDetections.length} ΕΓΓΡΑΦΕΣ · ${visibleThermalPasses} ΔΙΕΛΕΥΣΕΙΣ ΜΕ ΑΝΙΧΝΕΥΣΕΙΣ`,
                  )}
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
                    `NO DETECTIONS RETURNED · CHECKED ${thermalRetrievedTime} · NOT AN ALL-CLEAR`,
                    `ΔΕΝ ΕΠΙΣΤΡΑΦΗΚΑΝ ΑΝΙΧΝΕΥΣΕΙΣ · ΕΛΕΓΧΟΣ ${thermalRetrievedTime} · ΟΧΙ ΛΗΞΗ ΣΥΝΑΓΕΡΜΟΥ`,
                  )
                : localize(
                    language,
                    `${thermalWindowName} · ${thermalLatestAge} · FEED CHECKED ${thermalRetrievedTime}`,
                    `${thermalWindowName} · ${thermalLatestAge} · ΕΛΕΓΧΟΣ ΡΟΗΣ ${thermalRetrievedTime}`,
                  )}
          </small>
        </div>
        <div>
          <span>
            {localize(
              language,
              isLive ? "FIRE-GRID MODEL" : "FIRE-GRID MODEL · CURRENT-ONLY",
              isLive
                ? "ΜΟΝΤΕΛΟ ΑΝΕΜΟΥ ΣΤΗΝ ΕΣΤΙΑ"
                : "ΜΟΝΤΕΛΟ ΑΝΕΜΟΥ · ΜΟΝΟ ΤΡΕΧΟΝ",
            )}{" "}
            {isLive && fireWind ? `· MODEL VALID · ${windObservedTime}` : ""}
          </span>
          <strong>
            {isLive && fireWind && downwindHeading !== null
              ? `${compass(fireWind.wind10.directionDeg, language)} → ${compass(downwindHeading, language)} · ${fireWind.wind10.speedKmh.toFixed(0)} km/h`
              : isLive
                ? windError
                  ? localize(language, "MODEL UNAVAILABLE", "ΤΟ ΜΟΝΤΕΛΟ ΔΕΝ ΕΙΝΑΙ ΔΙΑΘΕΣΙΜΟ")
                  : localize(language, "CHECKING MODEL", "ΕΛΕΓΧΟΣ ΜΟΝΤΕΛΟΥ")
                : localize(language, "NOT RECONSTRUCTED", "ΔΕΝ ΑΝΑΚΑΤΑΣΚΕΥΑΖΕΤΑΙ")}
          </strong>
          <small>
            {isLive && fireWind
              ? `${localize(language, "Gust", "Ριπή")} ${fireWind.gustKmh.toFixed(0)} km/h · ${localize(language, "model, not sensor", "μοντέλο, όχι αισθητήρας")}`
              : isLive
                ? localize(
                    language,
                    "No fallback values shown",
                    "Δεν εμφανίζονται εφεδρικές τιμές",
                  )
              : localize(
                  language,
                  "Latest-only endpoint withheld",
                  "Απόκρυψη πηγής που δίνει μόνο την τελευταία τιμή",
                )}
          </small>
        </div>
        <div>
          <span>
            {localize(
              language,
              isLive ? "INCIDENT WIRE · LAST SOURCE POLL" : "INCIDENT WIRE · MAP CUTOFF",
              isLive ? "ΡΟΗ ΣΥΜΒΑΝΤΟΣ · ΤΕΛΕΥΤΑΙΟΣ ΕΛΕΓΧΟΣ ΠΗΓΩΝ" : "ΡΟΗ ΣΥΜΒΑΝΤΟΣ · ΧΡΟΝΙΚΟ ΟΡΙΟ ΧΑΡΤΗ",
            )}
            {isLive ? ` · ${updatesRetrievedTime}` : ` · ${asOfLabel}`}
          </span>
          <strong>
            {!isLive
              ? localize(
                  language,
                  "DATED ITEMS ONLY",
                  "ΜΟΝΟ ΧΡΟΝΟΛΟΓΗΜΕΝΑ ΣΤΟΙΧΕΙΑ",
                )
              : updatesStaleSnapshot
                ? localize(
                    language,
                    "SNAPSHOT / RETRYING",
                    "ΣΤΙΓΜΙΟΤΥΠΟ / ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ",
                  )
                : localize(
                    language,
                    "POLLING 5 MINUTES",
                    "ΕΛΕΓΧΟΣ ΚΑΘΕ 5 ΛΕΠΤΑ",
                  )}
          </strong>
          <small>
            {!isLive
              ? localize(
                  language,
                  "Unknown and later timestamps withheld",
                  "Απόκρυψη άγνωστων και μεταγενέστερων χρόνων",
                )
              : localize(
                  language,
                  sourceHealth
                    ? `${sourceHealth.online}/${sourceHealth.total} sources reachable · Greece timestamps`
                    : "Checking official and local sources · Greece timestamps",
                  sourceHealth
                    ? `${sourceHealth.online}/${sourceHealth.total} πηγές προσβάσιμες · ώρες Ελλάδας`
                    : "Έλεγχος επίσημων και τοπικών πηγών · ώρες Ελλάδας",
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
