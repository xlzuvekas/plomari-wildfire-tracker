"use client";

import { useEffect, useState } from "react";

import {
  buildSatellitePassUrl,
  parseSatellitePassPayload,
  satellitePassErrorSchema,
  type SatellitePassPayload,
} from "@/lib/firewatch/v3/satellite-pass-client";

const SNAPSHOT_HEADER = "X-Firewatch-Snapshot";
export const SATELLITE_PASS_POLL_MS = 5 * 60_000;

export type SatellitePassClientError =
  | "invalid-request"
  | "invalid-response"
  | "unavailable";

type SatellitePassAreaState = {
  cellKey: string;
  data: SatellitePassPayload | null;
  error: SatellitePassClientError | null;
  cachedSnapshot: boolean;
  loading: boolean;
};

function initialState(cellKey: string, loading: boolean): SatellitePassAreaState {
  return {
    cellKey,
    data: null,
    error: null,
    cachedSnapshot: false,
    loading,
  };
}

function pollingAvailable(allowCachedSnapshot: boolean) {
  return (
    document.visibilityState === "visible" &&
    (navigator.onLine || allowCachedSnapshot)
  );
}

/**
 * Reads current persisted CMR catalog coverage for one privacy-reduced cell.
 * Live data is deliberately withheld while the time scrubber is historical.
 */
export function useSatellitePassArea(cellKey: string, isLive: boolean) {
  const [state, setState] = useState<SatellitePassAreaState>(() =>
    initialState(cellKey, isLive),
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let inFlight = false;
    let invalidRequest = false;
    if (!isLive) return () => controller.abort();

    const refresh = async (allowCachedSnapshot = false) => {
      if (
        cancelled ||
        inFlight ||
        invalidRequest ||
        !pollingAvailable(allowCachedSnapshot)
      ) {
        return;
      }
      inFlight = true;
      try {
        const response = await fetch(buildSatellitePassUrl(cellKey), {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const cachedSnapshot =
          response.headers.get(SNAPSHOT_HEADER) === "offline-cache";
        const body: unknown = await response.json();
        if (!response.ok) {
          const error = satellitePassErrorSchema.safeParse(body);
          throw new Error(
            error.success && error.data.error.code === "invalid_request"
              ? "invalid-request"
              : "unavailable",
          );
        }
        let data: SatellitePassPayload;
        try {
          data = parseSatellitePassPayload(body);
        } catch {
          throw new Error("invalid-response");
        }
        if (data.scope.cell !== cellKey) {
          throw new Error("invalid-response");
        }
        if (cancelled) return;
        setState({
          cellKey,
          data,
          error: null,
          cachedSnapshot,
          loading: false,
        });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "unavailable";
        const clientError: SatellitePassClientError =
          message === "invalid-request"
            ? "invalid-request"
            : message === "invalid-response" || error instanceof SyntaxError
              ? "invalid-response"
              : "unavailable";
        if (clientError === "invalid-request") invalidRequest = true;
        setState((current) =>
          current.cellKey === cellKey
            ? {
                ...current,
                error: clientError,
                cachedSnapshot: current.cachedSnapshot || Boolean(current.data),
                loading: false,
              }
            : initialState(cellKey, false),
        );
      } finally {
        inFlight = false;
      }
    };

    const initial = window.setTimeout(() => void refresh(true), 0);
    const timer = window.setInterval(
      () => void refresh(),
      SATELLITE_PASS_POLL_MS,
    );
    const resume = () => void refresh();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [cellKey, isLive]);

  if (!isLive) {
    return {
      ...initialState(cellKey, false),
      currentOnlyWithheld: true,
    } as const;
  }
  const currentState =
    state.cellKey === cellKey ? state : initialState(cellKey, true);
  return { ...currentState, currentOnlyWithheld: false } as const;
}
