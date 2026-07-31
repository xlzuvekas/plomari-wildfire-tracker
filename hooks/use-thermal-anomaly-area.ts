"use client";

import { useEffect, useMemo, useReducer } from "react";

import {
  createHttpThermalAnomalyClient,
  type NormalizedThermalAnomalyFirstPageRequest,
  type ThermalAnomalyClient,
  type ThermalAnomalyClientResult,
  type ThermalAnomalyFirstPageRequest,
} from "../lib/firewatch/v3/thermal-anomaly-http-client";
import type { ThermalAnomalyPayload } from "../lib/firewatch/v3/thermal-anomaly-contract";

export type ThermalAnomalyAreaInput = Readonly<{
  enabled: boolean;
  cell: string | null;
  asOf: string | null;
  knownAt: string | null;
  limit?: number;
}>;

export type ThermalAnomalyAreaTarget = Readonly<{
  cell: string;
  asOf: string;
  knownAt: string;
  limit: number;
}>;

export type ThermalAnomalyAreaIssue = Exclude<
  ThermalAnomalyClientResult,
  { kind: "snapshot" } | { kind: "cancelled" }
>["kind"];

export type ThermalAnomalyAreaState =
  | Readonly<{
      status: "idle";
      reason: "disabled" | "incomplete-target";
      target: null;
    }>
  | Readonly<{
      status: "loading";
      target: ThermalAnomalyAreaTarget;
    }>
  | Readonly<{
      status: "ready";
      target: NormalizedThermalAnomalyFirstPageRequest;
      data: ThermalAnomalyPayload;
    }>
  | Readonly<{
      status: "error";
      target: ThermalAnomalyAreaTarget;
      issue: ThermalAnomalyAreaIssue;
      retryable: boolean;
      restartFromFirstPage: boolean;
    }>;

export type ThermalAnomalyAreaAction =
  | Readonly<{
      type: "reset";
      reason: "disabled" | "incomplete-target";
    }>
  | Readonly<{ type: "load"; target: ThermalAnomalyAreaTarget }>
  | Readonly<{
      type: "settle";
      target: ThermalAnomalyAreaTarget;
      result: ThermalAnomalyClientResult;
    }>;

export function initialThermalAnomalyAreaState(
  reason: "disabled" | "incomplete-target" = "disabled",
): ThermalAnomalyAreaState {
  return Object.freeze({ status: "idle", reason, target: null });
}

function sameTarget(
  left: ThermalAnomalyAreaTarget,
  right: ThermalAnomalyAreaTarget,
) {
  return (
    left.cell === right.cell &&
    left.asOf === right.asOf &&
    left.knownAt === right.knownAt &&
    left.limit === right.limit
  );
}

/**
 * Keeps stale cell/cutoff responses from winning a newer request and never
 * carries a not-assessed snapshot into loading or error state.
 */
export function reduceThermalAnomalyAreaState(
  state: ThermalAnomalyAreaState,
  action: ThermalAnomalyAreaAction,
): ThermalAnomalyAreaState {
  if (action.type === "reset") {
    return initialThermalAnomalyAreaState(action.reason);
  }
  if (action.type === "load") {
    return Object.freeze({ status: "loading", target: action.target });
  }
  if (
    state.status !== "loading" ||
    !sameTarget(state.target, action.target) ||
    action.result.kind === "cancelled"
  ) {
    return state;
  }
  if (action.result.kind === "snapshot") {
    if (
      action.result.data.scope.cell !== action.target.cell ||
      action.result.data.time.asOf !== action.target.asOf ||
      action.result.data.time.knownAt !== action.target.knownAt ||
      action.result.data.page.limit !== action.target.limit ||
      !action.result.data.page.isFirstPage
    ) {
      return Object.freeze({
        status: "error",
        target: action.target,
        issue: "invalid-response",
        retryable: true,
        restartFromFirstPage: false,
      });
    }
    return Object.freeze({
      status: "ready",
      target: action.target,
      data: action.result.data,
    });
  }
  return Object.freeze({
    status: "error",
    target: action.target,
    issue: action.result.kind,
    retryable: action.result.retryable,
    restartFromFirstPage: action.result.kind === "snapshot-changed",
  });
}

export function thermalAnomalyAreaTarget(
  input: ThermalAnomalyAreaInput,
): ThermalAnomalyAreaTarget | null {
  if (
    !input.enabled ||
    input.cell === null ||
    input.asOf === null ||
    input.knownAt === null
  ) {
    return null;
  }
  return Object.freeze({
    cell: input.cell,
    asOf: input.asOf,
    knownAt: input.knownAt,
    limit: input.limit ?? 50,
  });
}

/**
 * Runs exactly one first-page read for the complete cell/cutoff tuple. It does
 * not poll, retry, consult online state, or preserve an offline/last-good page.
 */
export function useThermalAnomalyArea(
  input: ThermalAnomalyAreaInput,
  injectedClient?: ThermalAnomalyClient,
): ThermalAnomalyAreaState {
  const { enabled, cell, asOf, knownAt, limit } = input;
  const client = useMemo(
    () =>
      injectedClient ??
      createHttpThermalAnomalyClient({
        fetch: (path, init) => globalThis.fetch(path, init),
      }),
    [injectedClient],
  );
  const target = useMemo(
    () => thermalAnomalyAreaTarget({ enabled, cell, asOf, knownAt, limit }),
    [asOf, cell, enabled, knownAt, limit],
  );
  const [state, dispatch] = useReducer(
    reduceThermalAnomalyAreaState,
    undefined,
    () =>
      initialThermalAnomalyAreaState(
        enabled ? "incomplete-target" : "disabled",
      ),
  );

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: "reset", reason: "disabled" });
      return;
    }
    if (target === null) {
      dispatch({ type: "reset", reason: "incomplete-target" });
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    dispatch({ type: "load", target });
    void client
      .readFirstPage(target as ThermalAnomalyFirstPageRequest, {
        signal: controller.signal,
      })
      .then((result) => {
        if (!disposed && result.kind !== "cancelled") {
          dispatch({ type: "settle", target, result });
        }
      })
      .catch(() => {
        if (!disposed) {
          dispatch({
            type: "settle",
            target,
            result: { kind: "unavailable", retryable: true },
          });
        }
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [client, enabled, target]);

  if (
    !enabled &&
    (state.status !== "idle" || state.reason !== "disabled")
  ) {
    return initialThermalAnomalyAreaState("disabled");
  }
  if (
    target === null &&
    (state.status !== "idle" || state.reason !== "incomplete-target")
  ) {
    return initialThermalAnomalyAreaState("incomplete-target");
  }
  if (target !== null && state.status === "idle") {
    return Object.freeze({ status: "loading", target });
  }
  if (
    target !== null &&
    state.status !== "idle" &&
    !sameTarget(state.target, target)
  ) {
    return Object.freeze({ status: "loading", target });
  }
  return state;
}
