"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import {
  DiscoveryPanel,
  type DiscoveryPanelState,
} from "../../components/firewatch/DiscoveryPanel";
import type { DiscoverySelection } from "../../components/firewatch/discovery-presentation";
import {
  coarseAreaCellForLocation,
  parseAreaCellKey,
} from "../../lib/firewatch/map-context";
import {
  GlobalDiscoveryController,
  createHttpGlobalDiscoveryClient,
  millisecondsUntilNextDiscoveryBucket,
  shouldRefreshDiscoveryOnVisible,
  type GlobalDiscoveryClient,
  type GlobalDiscoveryControllerSnapshot,
} from "../../lib/firewatch/v3";

import styles from "./ExplorePage.module.css";

type ExplorePageClientProps = Readonly<{
  fixtureMode: boolean;
  initialSuggestedCell: string | null;
}>;

type PageMode = "explore" | "nearby";

type LocationStatus =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "requesting" }>
  | Readonly<{ state: "ready"; cell: string }>
  | Readonly<{ state: "error"; message: string }>;

function createLazyDevelopmentClient(): GlobalDiscoveryClient {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Synthetic discovery is restricted to development.");
  }
  let clientPromise: Promise<GlobalDiscoveryClient> | null = null;
  const load = () => {
    clientPromise ??= import(
      "../../lib/firewatch/v3/development-discovery-client"
    ).then(({ createDevelopmentGlobalDiscoveryClient }) =>
      createDevelopmentGlobalDiscoveryClient({ environment: "development" }),
    );
    return clientPromise;
  };
  return {
    async exploreCandidates(request, options) {
      return (await load()).exploreCandidates(request, options);
    },
    async nearbyIncidents(request, options) {
      return (await load()).nearbyIncidents(request, options);
    },
  };
}

function explorePanelState(
  snapshot: GlobalDiscoveryControllerSnapshot,
): DiscoveryPanelState {
  if (
    snapshot.status === "idle" ||
    snapshot.target.mode !== "explore-candidates"
  ) {
    return { status: "loading", mode: "explore-candidates" };
  }
  if (snapshot.status === "loading") {
    return {
      status: "loading",
      mode: "explore-candidates",
      ...(snapshot.lastGood?.kind === "explore-candidates"
        ? { lastGood: snapshot.lastGood }
        : {}),
    };
  }
  if (snapshot.status === "ready") {
    if (snapshot.response.kind !== "explore-candidates") {
      return { status: "loading", mode: "explore-candidates" };
    }
    return {
      status: "ready",
      mode: "explore-candidates",
      response: snapshot.response,
      transport: snapshot.transport,
    };
  }
  return {
    status: "error",
    mode: "explore-candidates",
    issue: snapshot.issue,
    ...(snapshot.lastGood?.kind === "explore-candidates"
      ? { lastGood: snapshot.lastGood }
      : {}),
  };
}

function nearbyPanelState(
  snapshot: GlobalDiscoveryControllerSnapshot,
  cell: string,
): DiscoveryPanelState {
  if (
    snapshot.status === "idle" ||
    snapshot.target.mode !== "nearby-incidents" ||
    snapshot.target.cell !== cell
  ) {
    return { status: "loading", mode: "nearby-incidents" };
  }
  if (snapshot.status === "loading") {
    return {
      status: "loading",
      mode: "nearby-incidents",
      ...(snapshot.lastGood?.kind === "nearby-incidents"
        ? { lastGood: snapshot.lastGood }
        : {}),
    };
  }
  if (snapshot.status === "ready") {
    if (snapshot.response.kind !== "nearby-incidents") {
      return { status: "loading", mode: "nearby-incidents" };
    }
    return {
      status: "ready",
      mode: "nearby-incidents",
      response: snapshot.response,
      transport: snapshot.transport,
    };
  }
  return {
    status: "error",
    mode: "nearby-incidents",
    issue: snapshot.issue,
    ...(snapshot.lastGood?.kind === "nearby-incidents"
      ? { lastGood: snapshot.lastGood }
      : {}),
  };
}

function locationErrorMessage(code: number): string {
  if (code === 1) {
    return "Location permission was not granted. You can enter a coarse cell instead.";
  }
  if (code === 3) {
    return "The location request timed out. Try again or enter a coarse cell.";
  }
  return "Your location is unavailable. Try again or enter a coarse cell.";
}

export function ExplorePageClient({
  fixtureMode,
  initialSuggestedCell,
}: ExplorePageClientProps) {
  const client = useMemo(
    () =>
      fixtureMode
        ? createLazyDevelopmentClient()
        : createHttpGlobalDiscoveryClient({ fetch: globalThis.fetch }),
    [fixtureMode],
  );
  const controller = useMemo(
    () => new GlobalDiscoveryController({ client }),
    [client],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [mode, setMode] = useState<PageMode>("explore");
  const [confirmedCell, setConfirmedCell] = useState<string | null>(null);
  const [cellInput, setCellInput] = useState(initialSuggestedCell ?? "");
  const [cellError, setCellError] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>({
    state: "idle",
  });
  const [selected, setSelected] = useState<DiscoverySelection | null>(null);
  const locationIntent = useRef(0);
  const visibleExploreResponse =
    snapshot.status === "ready" &&
    snapshot.response.kind === "explore-candidates"
      ? snapshot.response
      : (snapshot.status === "loading" || snapshot.status === "error") &&
          snapshot.lastGood?.kind === "explore-candidates"
        ? snapshot.lastGood
        : null;
  const candidateCell =
    selected?.kind === "candidate" &&
    visibleExploreResponse?.candidates.some(
      (candidate) =>
        candidate.candidateId === selected.candidateId &&
        candidate.displayArea.cell === selected.cell,
    )
      ? selected.cell
      : null;

  useEffect(() => {
    if (mode === "explore") {
      void controller.activate({ mode: "explore-candidates" });
      return;
    }
    if (confirmedCell) {
      void controller.activate({
        mode: "nearby-incidents",
        cell: confirmedCell,
      });
      return;
    }
    controller.pause();
  }, [confirmedCell, controller, mode]);

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Offline support is best-effort; discovery remains usable without it. */
    });
  }, []);

  useEffect(
    () => () => {
      locationIntent.current += 1;
    },
    [],
  );

  useEffect(() => {
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clearTimer();
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        timer = null;
        if (document.visibilityState !== "visible") return;
        if (
          shouldRefreshDiscoveryOnVisible(
            Date.now(),
            controller.getLastRequestedCutoff(),
          )
        ) {
          void controller.refresh();
        }
        schedule();
      }, millisecondsUntilNextDiscoveryBucket(Date.now()));
    };
    const handleVisibility = () => {
      clearTimer();
      if (document.visibilityState !== "visible") {
        controller.suspend();
        return;
      }
      if (
        shouldRefreshDiscoveryOnVisible(
          Date.now(),
          controller.getLastRequestedCutoff(),
        )
      ) {
        void controller.refresh();
      }
      schedule();
    };
    const handleOnline = () => {
      if (document.visibilityState !== "visible") return;
      void controller.refresh();
      schedule();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    handleVisibility();
    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
    };
  }, [controller]);

  const confirmCell = useCallback(
    (value: string) => {
      locationIntent.current += 1;
      const normalized = value.trim();
      const parsed = parseAreaCellKey(normalized);
      if (parsed?.cellKey !== normalized) {
        setCellError("Enter a canonical cell such as wm/10/587/391.");
        return false;
      }
      setCellInput(normalized);
      setCellError(null);
      setConfirmedCell(normalized);
      setSelected(null);
      setMode("nearby");
      return true;
    },
    [],
  );

  const submitCell = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    confirmCell(cellInput);
  };

  const useDeviceArea = () => {
    const intent = locationIntent.current + 1;
    locationIntent.current = intent;
    setCellError(null);
    if (!("geolocation" in navigator)) {
      setLocationStatus({
        state: "error",
        message: "This browser does not provide location access.",
      });
      return;
    }
    setLocationStatus({ state: "requesting" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (locationIntent.current !== intent) return;
        try {
          const coarseCell = coarseAreaCellForLocation(
            position.coords.latitude,
            position.coords.longitude,
          );
          setLocationStatus({ state: "ready", cell: coarseCell.cellKey });
        } catch {
          setLocationStatus({
            state: "error",
            message: "The browser returned an unusable location.",
          });
        }
      },
      (error) => {
        if (locationIntent.current !== intent) return;
        setLocationStatus({
          state: "error",
          message: locationErrorMessage(error.code),
        });
      },
      {
        enableHighAccuracy: false,
        maximumAge: 5 * 60_000,
        timeout: 10_000,
      },
    );
  };

  const hasActiveTarget = mode === "explore" || confirmedCell !== null;
  const isLoading = snapshot.status === "loading";
  const panelState =
    mode === "explore"
      ? explorePanelState(snapshot)
      : confirmedCell
        ? nearbyPanelState(snapshot, confirmedCell)
        : null;
  const refreshCurrentTarget = () => {
    if (mode === "explore") {
      void controller.activate({ mode: "explore-candidates" });
      return;
    }
    if (confirmedCell) {
      void controller.activate({
        mode: "nearby-incidents",
        cell: confirmedCell,
      });
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>FIREWATCH // GLOBAL DISCOVERY</p>
          <h1>Wildfire discovery</h1>
          <p className={styles.lede}>
            Bounded global candidate reads and coarse-area incident context,
            with coverage and time uncertainty kept visible.
          </p>
        </div>
        <div className={styles.headerActions}>
          {fixtureMode ? (
            <span className={styles.fixtureFlag}>Synthetic development data</span>
          ) : (
            <span className={styles.liveFlag}>Persisted HTTP reads</span>
          )}
          <Link className={styles.mapLink} href="/">
            Incident map
          </Link>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.controls} aria-label="Discovery controls">
          <section className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <span>01</span>
              <div>
                <h2>Choose a view</h2>
                <p>Switching views aborts any stale request.</p>
              </div>
            </div>
            <div
              className={styles.modeControl}
              role="group"
              aria-label="Discovery view"
            >
              <button
                type="button"
                aria-pressed={mode === "explore"}
                data-active={mode === "explore" || undefined}
                onClick={() => {
                  locationIntent.current += 1;
                  setSelected(null);
                  setMode("explore");
                }}
              >
                Explore
                <span>Global candidates</span>
              </button>
              <button
                type="button"
                aria-pressed={mode === "nearby"}
                data-active={mode === "nearby" || undefined}
                onClick={() => {
                  locationIntent.current += 1;
                  setSelected(null);
                  setMode("nearby");
                }}
              >
                Nearby
                <span>Confirmed coarse area</span>
              </button>
            </div>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <span>02</span>
              <div>
                <h2>Confirm a coarse area</h2>
                <p>Nearby never sends an exact device position.</p>
              </div>
            </div>

            <button
              type="button"
              className={styles.locationButton}
              onClick={useDeviceArea}
              disabled={locationStatus.state === "requesting"}
            >
              {locationStatus.state === "requesting"
                ? "Converting location locally…"
                : "Find my coarse area"}
            </button>
            <p className={styles.privacyNote}>
              Your browser converts the location to a canonical cell before
              any request. Only that cell key leaves this device.
            </p>

            {locationStatus.state === "ready" ? (
              <div className={styles.locationPreview}>
                <p className={styles.inlineStatus} role="status">
                  Device area ready: <code>{locationStatus.cell}</code>
                </p>
                <button
                  type="button"
                  onClick={() => confirmCell(locationStatus.cell)}
                >
                  Confirm this area for Nearby
                </button>
              </div>
            ) : locationStatus.state === "error" ? (
              <p className={styles.inlineError} role="alert">
                {locationStatus.message}
              </p>
            ) : null}

            <form className={styles.cellForm} onSubmit={submitCell}>
              <label htmlFor="discovery-cell">Canonical coarse cell</label>
              <div>
                <input
                  id="discovery-cell"
                  name="cell"
                  value={cellInput}
                  onChange={(event) => setCellInput(event.target.value)}
                  placeholder="wm/10/587/391"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="discovery-cell-help"
                  aria-invalid={cellError !== null}
                />
                <button type="submit">Confirm</button>
              </div>
              <p id="discovery-cell-help">
                A shared link or confirmed map/place selection can provide this
                cell without exposing coordinates.
              </p>
            </form>
            {cellError ? (
              <p className={styles.inlineError} role="alert">
                {cellError}
              </p>
            ) : null}

            {candidateCell ? (
              <div className={styles.suggestion}>
                <span>Selected candidate area</span>
                <code>{candidateCell}</code>
                <button type="button" onClick={() => confirmCell(candidateCell)}>
                  Confirm for Nearby
                </button>
              </div>
            ) : initialSuggestedCell && confirmedCell !== initialSuggestedCell ? (
              <div className={styles.suggestion}>
                <span>Suggested area from this link</span>
                <code>{initialSuggestedCell}</code>
                <button
                  type="button"
                  onClick={() => confirmCell(initialSuggestedCell)}
                >
                  Confirm suggestion
                </button>
              </div>
            ) : null}

            {confirmedCell ? (
              <p className={styles.confirmedCell}>
                Active Nearby area <code>{confirmedCell}</code>
              </p>
            ) : null}
          </section>

          <section className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <span>03</span>
              <div>
                <h2>Refresh policy</h2>
                <p>Canonical five-minute UTC snapshots.</p>
              </div>
            </div>
            <button
              type="button"
              className={styles.refreshButton}
              disabled={!hasActiveTarget || isLoading}
              onClick={refreshCurrentTarget}
            >
              {isLoading ? "Refreshing…" : "Refresh now"}
            </button>
            <p className={styles.privacyNote}>
              Automatic refresh pauses while this tab is hidden and resumes on
              the next five-minute snapshot when visible.
            </p>
          </section>
        </aside>

        <section
          className={styles.results}
          id="discovery-results"
          aria-label="Discovery results"
        >
          {panelState ? (
            <DiscoveryPanel
              className={styles.discoveryPanel}
              state={panelState}
              selected={selected}
              onSelectionChange={setSelected}
              locale="en-GB"
              density="compact"
            />
          ) : (
            <div className={styles.nearbyPrompt}>
              <p className={styles.eyebrow}>NEARBY // AREA REQUIRED</p>
              <h2>Confirm a coarse area to continue</h2>
              <p>
                Use your locally converted device area, a canonical cell from a
                shared link, or a selected candidate area. No exact GPS fix is
                sent to Firewatch.
              </p>
            </div>
          )}
          <p className={styles.dataBoundary}>
            These controls query Firewatch&apos;s persisted discovery API only.
            Not-assessed, unconfigured, partial, stale, and unavailable
            coverage remains explicit and is never presented as an all-clear.
          </p>
        </section>
      </div>
    </main>
  );
}
