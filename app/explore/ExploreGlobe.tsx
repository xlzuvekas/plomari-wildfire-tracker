"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapOptions,
  Marker as MapLibreMarker,
} from "maplibre-gl";

import type { DiscoverySelection } from "../../components/firewatch/discovery-presentation";
import type { ExploreDiscoveryResponse } from "../../lib/firewatch/v3";
import {
  candidateAreaFeatureCollection,
  candidateMapMarker,
  describeExploreMapSnapshot,
} from "./explore-globe-model";
import styles from "./ExploreGlobe.module.css";

const CANDIDATE_SOURCE_ID = "firewatch-aggregate-candidate-cells";
const CANDIDATE_FILL_LAYER_ID = "firewatch-aggregate-candidate-fill";
const CANDIDATE_LINE_LAYER_ID = "firewatch-aggregate-candidate-outline";
export const MAPLIBRE_WORKER_URL =
  "/vendor/maplibre-gl/6.1.0/maplibre-gl-worker.mjs";
const ESRI_ATTRIBUTION =
  "Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community";

const WORLD_IMAGERY_STYLE = {
  version: 8,
  sources: {
    "esri-world-imagery": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION,
    },
    [CANDIDATE_SOURCE_ID]: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    },
  },
  layers: [
    {
      id: "esri-world-imagery",
      type: "raster",
      source: "esri-world-imagery",
      paint: { "raster-fade-duration": 0 },
    },
    {
      id: CANDIDATE_FILL_LAYER_ID,
      type: "fill",
      source: CANDIDATE_SOURCE_ID,
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["get", "selected"], false],
          "#ffb347",
          "#ff5a43",
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["get", "selected"], false],
          0.34,
          0.18,
        ],
      },
    },
    {
      id: CANDIDATE_LINE_LAYER_ID,
      type: "line",
      source: CANDIDATE_SOURCE_ID,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["get", "selected"], false],
          "#fff1bd",
          "#ff6a52",
        ],
        "line-opacity": 0.96,
        "line-width": [
          "case",
          ["boolean", ["get", "selected"], false],
          3,
          1.5,
        ],
      },
    },
  ],
} satisfies Exclude<MapOptions["style"], string | null | undefined>;

type RequestStatus = "loading" | "ready" | "error";

export type ExploreGlobeProps = Readonly<{
  requestStatus: RequestStatus;
  response: ExploreDiscoveryResponse | null;
  selected: DiscoverySelection | null;
  onSelectionChange: (selection: DiscoverySelection) => void;
}>;

type RuntimeState =
  | Readonly<{ kind: "checking"; label: string }>
  | Readonly<{ kind: "ready"; label: string }>
  | Readonly<{ kind: "degraded"; label: string }>
  | Readonly<{ kind: "unsupported"; label: string }>;

function supportsWebGl2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2", {
      failIfMajorPerformanceCaveat: true,
    }) !== null;
  } catch {
    return false;
  }
}

function selectedCandidateId(
  selected: DiscoverySelection | null,
): string | null {
  return selected?.kind === "candidate" ? selected.candidateId : null;
}

export function ExploreGlobe({
  requestStatus,
  response,
  selected,
  onSelectionChange,
}: ExploreGlobeProps) {
  const headingId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const [mapRevision, setMapRevision] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeState>({
    kind: "checking",
    label: "Loading globe renderer",
  });
  const notice = useMemo(
    () => describeExploreMapSnapshot({ requestStatus, response }),
    [requestStatus, response],
  );
  const selectionId = selectedCandidateId(selected);
  const featureCollection = useMemo(
    () => candidateAreaFeatureCollection(response, selectionId),
    [response, selectionId],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let disposed = false;
    let initializationFailed = false;
    let mountedMap: MapLibreMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let loadTimer: number | null = null;

    const teardownMapRuntime = () => {
      const timer = loadTimer;
      loadTimer = null;
      if (timer !== null) {
        try {
          window.clearTimeout(timer);
        } catch {
          // Continue releasing the remaining renderer resources.
        }
      }
      const observer = resizeObserver;
      resizeObserver = null;
      try {
        observer?.disconnect();
      } catch {
        // Continue releasing the remaining renderer resources.
      }
      const markers = markersRef.current;
      markersRef.current = [];
      for (const marker of markers) {
        try {
          marker.remove();
        } catch {
          // Continue releasing the remaining renderer resources.
        }
      }
      const map = mountedMap ?? mapRef.current;
      mountedMap = null;
      mapRef.current = null;
      maplibreRef.current = null;
      try {
        map?.remove();
      } catch {
        // A partially initialized renderer must not block the safe list fallback.
      }
    };

    const mountMap = async () => {
      if (!supportsWebGl2()) {
        setRuntime({
          kind: "unsupported",
          label:
            "This browser cannot start the WebGL 2 globe. Use the complete candidate list below.",
        });
        return;
      }
      try {
        const maplibre = await import("maplibre-gl");
        if (disposed) return;
        maplibre.setWorkerUrl(MAPLIBRE_WORKER_URL);
        maplibreRef.current = maplibre;
        const map = new maplibre.Map({
          container,
          style: WORLD_IMAGERY_STYLE,
          center: [12, 18],
          zoom: 1.35,
          minZoom: 0.8,
          maxZoom: 12,
          dragRotate: false,
          touchPitch: false,
          cooperativeGestures: true,
          renderWorldCopies: false,
          attributionControl: false,
          maplibreLogo: false,
          canvasContextAttributes: {
            contextType: "webgl2",
            failIfMajorPerformanceCaveat: true,
            powerPreference: "high-performance",
          },
        });
        mountedMap = map;
        mapRef.current = map;
        map.setProjection({ type: "globe" });
        map.addControl(
          new maplibre.NavigationControl({
            showCompass: false,
            showZoom: true,
            visualizePitch: false,
          }),
          "top-right",
        );
        map.on("load", () => {
          if (disposed || initializationFailed) return;
          if (loadTimer !== null) window.clearTimeout(loadTimer);
          loadTimer = null;
          setRuntime({ kind: "ready", label: "Globe ready" });
          setMapRevision((revision) => revision + 1);
        });
        map.on("error", () => {
          if (disposed || initializationFailed) return;
          setRuntime({
            kind: "degraded",
            label:
              "Satellite imagery or map styling is unavailable. Candidate details remain available in the list.",
          });
        });
        resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(container);
        loadTimer = window.setTimeout(() => {
          if (disposed || initializationFailed) return;
          setRuntime({
            kind: "degraded",
            label:
              "The globe is taking longer than expected. Candidate details remain available in the list.",
          });
        }, 12_000);
      } catch {
        initializationFailed = true;
        teardownMapRuntime();
        if (disposed) return;
        setRuntime({
          kind: "unsupported",
          label:
            "The globe renderer could not start. Use the complete candidate list below.",
        });
      }
    };

    void mountMap();
    return () => {
      disposed = true;
      teardownMapRuntime();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (map === null || maplibre === null || !map.isStyleLoaded()) return;
    const source = map.getSource(CANDIDATE_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    source?.setData(featureCollection);

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = (response?.candidates ?? []).map((candidate) => {
      const markerModel = candidateMapMarker(candidate);
      const isSelected = candidate.candidateId === selectionId;
      const button = document.createElement("button");
      button.type = "button";
      button.className = styles.marker!;
      button.dataset.selected = isSelected ? "true" : "false";
      button.setAttribute("aria-pressed", String(isSelected));
      button.setAttribute(
        "aria-label",
        `${isSelected ? "Selected" : "Select"} unconfirmed candidate in aggregate cell ${candidate.displayArea.cell}`,
      );
      button.addEventListener("click", () => {
        onSelectionChange({
          kind: "candidate",
          candidateId: candidate.candidateId,
          cell: candidate.displayArea.cell,
        });
      });
      return new maplibre.Marker({
        element: button,
        anchor: "center",
        opacityWhenCovered: 0,
      })
        .setLngLat(markerModel.center)
        .addTo(map);
    });
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [featureCollection, mapRevision, onSelectionChange, response, selectionId]);

  useEffect(() => {
    if (selectionId === null || response === null) return;
    const selectedCandidate = response.candidates.find(
      (candidate) => candidate.candidateId === selectionId,
    );
    if (selectedCandidate === undefined) return;
    const map = mapRef.current;
    if (map === null) return;
    map.jumpTo({
      center: candidateMapMarker(selectedCandidate).center,
      zoom: Math.max(map.getZoom(), 4),
    });
  }, [mapRevision, response, selectionId]);

  return (
    <section className={styles.shell} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>EXPLORE // AGGREGATE GLOBE</p>
          <h2 id={headingId}>Global candidate cells</h2>
        </div>
        <span className={styles.runtime} data-state={runtime.kind} role="status">
          {runtime.label}
        </span>
      </header>

      <div className={styles.dataStatus} data-tone={notice.tone} role="status">
        <strong>{notice.title}</strong>
        <span>{notice.detail}</span>
      </div>

      <div className={styles.viewport} data-runtime={runtime.kind}>
        <div
          ref={containerRef}
          className={styles.map}
          aria-label="Interactive globe of aggregate Firewatch candidate cells"
        />
        {runtime.kind === "unsupported" ? (
          <div className={styles.webglFallback} role="note">
            <strong>Globe unavailable</strong>
            <span>
              The candidate list remains the authoritative, keyboard-accessible
              view. No discovery result is hidden by this renderer failure.
            </span>
          </div>
        ) : null}
      </div>

      <footer className={styles.footer}>
        <span>{ESRI_ATTRIBUTION}</span>
        <span>
          Outlines are Firewatch aggregate display-cell bounds · MapLibre GL
        </span>
      </footer>
    </section>
  );
}

export default ExploreGlobe;
