"use client";

import { useId, type ReactNode } from "react";

import type {
  DiscoveryCoverage,
  ExploreDiscoveryResponse,
  GlobalDiscoveryClientResult,
  GlobalDiscoveryTransport,
  NearbyDiscoveryResponse,
  PublicDiscoveryTime,
} from "@/lib/firewatch/v3";

import {
  discoverySelectionKey,
  humanizeDiscoveryToken,
  localizedIncidentName,
  presentDiscoveryTime,
  type DiscoverySelection,
  type ValidatedDiscoveryOffset,
} from "./discovery-presentation";
import styles from "./DiscoveryPanel.module.css";

export const defaultDiscoveryPanelMessages = {
  eyebrow: "GLOBAL DISCOVERY // V3",
  exploreTitle: "Explore signals",
  exploreSubtitle: "Unconfirmed candidates · bounded page",
  nearbyTitle: "Nearby incidents",
  nearbySubtitle: "Adjudicated incident records · coarse area",
  loading: "Loading discovery snapshot",
  refreshing: "Refreshing · showing last-good snapshot",
  lastGood: "Last-good snapshot",
  live: "Live read",
  revalidated: "Revalidated cache",
  fixture: "Synthetic fixture",
  coverageComplete: "Coverage complete",
  coverageStale: "Coverage stale",
  coveragePartial: "Coverage partial",
  coverageUnavailable: "Discovery unavailable",
  coverageDisabled: "Discovery disabled",
  coverageUnconfigured: "Discovery unconfigured",
  coverageNotAssessed: "Coverage not assessed",
  coveragePartitions: "policy partitions checked",
  checkedAt: "Checked",
  freshThrough: "Fresh through",
  freshnessExpired: "Freshness expired",
  coveredWindow: "Event window covered",
  lastCompleteAt: "Last complete",
  retryAfter: "Retry after",
  seconds: "seconds",
  disabledDetail: "Discovery is intentionally disabled for this policy.",
  unconfiguredDetail:
    "No discovery source pack is configured for this policy.",
  notAssessedDetail:
    "Persisted public records may be shown, but this response does not prove the area was fully checked.",
  noCandidates: "No known candidates in this observation window.",
  noIncidents: "No known incidents in this coarse area and observation window.",
  notAllClear: "This is not an all-clear or proof that no wildfire exists.",
  indeterminate: "The available coverage cannot support an empty finding.",
  clientInvalidRequest: "The discovery request was rejected.",
  clientInvalidResponse: "The response failed the discovery contract.",
  clientUnavailable: "The discovery service cannot be reached right now.",
  clientCancelled: "The discovery request was cancelled.",
  candidate: "Unconfirmed candidate",
  candidateTitle: "Wildfire signal",
  incident: "Incident record",
  firstObserved: "First observed",
  latestObserved: "Latest observed",
  started: "Started",
  asOf: "Events as of",
  knownAt: "Knowledge as of",
  windowStart: "Observation window starts",
  observations: "observations",
  sources: "sources",
  select: "Select",
  selected: "Selected",
  pageBounded: "Bounded discovery page",
  moreAvailable: "More results available through the opaque cursor.",
  results: "results",
} as const;

type MessageKey = keyof typeof defaultDiscoveryPanelMessages;
export type DiscoveryPanelMessages = Record<MessageKey, string>;

type ClientIssue = Exclude<
  GlobalDiscoveryClientResult<never>,
  { kind: "snapshot" }
>["kind"];

type DiscoveryPanelStateFor<
  Mode extends "explore-candidates" | "nearby-incidents",
  Response,
> =
  | Readonly<{
      status: "loading";
      mode: Mode;
      lastGood?: Response;
    }>
  | Readonly<{
      status: "ready";
      mode: Mode;
      response: Response;
      transport: GlobalDiscoveryTransport;
    }>
  | Readonly<{
      status: "error";
      mode: Mode;
      issue: ClientIssue;
      lastGood?: Response;
    }>;

export type DiscoveryPanelState =
  | DiscoveryPanelStateFor<"explore-candidates", ExploreDiscoveryResponse>
  | DiscoveryPanelStateFor<"nearby-incidents", NearbyDiscoveryResponse>;

export type DiscoveryPanelProps = Readonly<{
  state: DiscoveryPanelState;
  selected?: DiscoverySelection | null;
  onSelectionChange: (selection: DiscoverySelection) => void;
  locale?: string;
  messages?: Partial<DiscoveryPanelMessages>;
  formatToken?: (value: string) => string;
  presentTime?: typeof presentDiscoveryTime;
  density?: "comfortable" | "compact";
  className?: string;
}>;

function coveragePresentation(
  coverage: DiscoveryCoverage,
  messages: DiscoveryPanelMessages,
  timeZone: string,
  locale: string | undefined,
  presentTime: typeof presentDiscoveryTime,
): Readonly<{ label: string; detail: string; tone: string }> {
  const timestamp = (instant: string) => {
    const presented = presentTime(
      { precision: "exact", instant },
      timeZone,
      locale,
    );
    return `${presented.primary} · ${presented.context}`;
  };
  switch (coverage.state) {
    case "complete":
      return {
        label: messages.coverageComplete,
        detail:
          `${coverage.completedPartitionCount}/${coverage.requiredPartitionCount} ` +
          `${messages.coveragePartitions}. ${messages.checkedAt} ` +
          `${timestamp(coverage.checkedAt)}. ${messages.freshThrough} ` +
          `${timestamp(coverage.freshnessDeadline)}.`,
        tone: "positive",
      };
    case "stale":
      return {
        label: messages.coverageStale,
        detail:
          `${coverage.completedPartitionCount}/${coverage.requiredPartitionCount} ` +
          `${messages.coveragePartitions}. ${messages.checkedAt} ` +
          `${timestamp(coverage.checkedAt)}. ${messages.freshnessExpired} ` +
          `${timestamp(coverage.freshnessDeadline)}. ` +
          `${messages.lastCompleteAt} ${timestamp(coverage.lastCompleteAt)}. ` +
          `${messages.coveredWindow} ` +
          `${timestamp(coverage.coveredEventWindow.from)} → ` +
          `${timestamp(coverage.coveredEventWindow.through)}.`,
        tone: "warning",
      };
    case "partial":
      return {
        label: messages.coveragePartial,
        detail:
          `${coverage.completedPartitionCount}/${coverage.requiredPartitionCount} ` +
          `${messages.coveragePartitions}. ${messages.checkedAt} ` +
          `${timestamp(coverage.checkedAt)}.`,
        tone: "warning",
      };
    case "unavailable":
      return {
        label: messages.coverageUnavailable,
        detail:
          coverage.retryAfterSeconds === null
            ? `${messages.checkedAt} ${timestamp(coverage.checkedAt)}.`
            : `${messages.checkedAt} ${timestamp(coverage.checkedAt)}. ` +
              `${messages.retryAfter} ${coverage.retryAfterSeconds} ` +
              `${messages.seconds}.`,
        tone: "critical",
      };
    case "disabled":
      return {
        label: messages.coverageDisabled,
        detail: messages.disabledDetail,
        tone: "neutral",
      };
    case "unconfigured":
      return {
        label: messages.coverageUnconfigured,
        detail: messages.unconfiguredDetail,
        tone: "neutral",
      };
    case "not_assessed":
      return {
        label: messages.coverageNotAssessed,
        detail: messages.notAssessedDetail,
        tone: "warning",
      };
  }
}

function issueMessage(
  issue: ClientIssue,
  messages: DiscoveryPanelMessages,
): string {
  switch (issue) {
    case "invalid-request":
      return messages.clientInvalidRequest;
    case "invalid-response":
      return messages.clientInvalidResponse;
    case "unavailable":
      return messages.clientUnavailable;
    case "cancelled":
      return messages.clientCancelled;
  }
}

function transportLabel(
  transport: GlobalDiscoveryTransport,
  messages: DiscoveryPanelMessages,
): string {
  switch (transport) {
    case "live":
      return messages.live;
    case "revalidated-cache":
      return messages.revalidated;
    case "cache-fallback":
      return messages.lastGood;
    case "fixture":
      return messages.fixture;
  }
}

function SemanticTime({
  label,
  value,
  timeZone,
  locale,
  validatedOffset,
  presentTime,
}: Readonly<{
  label: string;
  value: PublicDiscoveryTime;
  timeZone: string;
  locale?: string;
  validatedOffset?: ValidatedDiscoveryOffset;
  presentTime: typeof presentDiscoveryTime;
}>) {
  const presented = presentTime(
    value,
    timeZone,
    locale,
    validatedOffset,
  );
  const content = (
    <>
      <span className={styles.timePrimary}>{presented.primary}</span>
      <span className={styles.timeContext}>{presented.context}</span>
    </>
  );
  return (
    <div className={styles.timeRow}>
      <dt>{label}</dt>
      <dd>
        {presented.dateTime === undefined ? (
          <span className={styles.timeValue} title={presented.title}>
            {content}
          </span>
        ) : (
          <time dateTime={presented.dateTime} title={presented.title}>
            {content}
          </time>
        )}
      </dd>
    </div>
  );
}

function EmptyState({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={styles.emptyState}>{children}</div>;
}

export function DiscoveryPanel({
  state,
  selected,
  onSelectionChange,
  locale,
  messages: messageOverrides,
  formatToken = humanizeDiscoveryToken,
  presentTime = presentDiscoveryTime,
  density = "comfortable",
  className,
}: DiscoveryPanelProps) {
  const headingId = useId();
  const messages: DiscoveryPanelMessages = {
    ...defaultDiscoveryPanelMessages,
    ...messageOverrides,
  };
  const selectedKey = discoverySelectionKey(selected);
  const response =
    state.status === "ready" ? state.response : state.lastGood ?? null;
  const isExplore = state.mode === "explore-candidates";
  const title = isExplore ? messages.exploreTitle : messages.nearbyTitle;
  const subtitle = isExplore
    ? messages.exploreSubtitle
    : messages.nearbySubtitle;
  const loadingWithoutData = state.status === "loading" && response === null;
  const coverage = response
    ? coveragePresentation(
        response.coverage,
        messages,
        response.time.timeZone.id,
        locale,
        presentTime,
      )
    : null;

  let boundaryNotice: string | null = null;
  if (state.status === "loading" && response) {
    boundaryNotice = messages.refreshing;
  }
  if (state.status === "error" && response) {
    boundaryNotice = `${messages.lastGood} · ${issueMessage(state.issue, messages)}`;
  }
  if (
    state.status === "ready" &&
    (state.transport === "cache-fallback" || state.transport === "fixture")
  ) {
    boundaryNotice = transportLabel(state.transport, messages);
  }

  const candidates =
    response?.kind === "explore-candidates" ? response.candidates : [];
  const incidents =
    response?.kind === "nearby-incidents" ? response.incidents : [];
  const itemCount = candidates.length + incidents.length;

  return (
    <section
      className={[styles.panel, className].filter(Boolean).join(" ")}
      data-density={density}
      data-mode={state.mode}
      aria-labelledby={headingId}
      aria-busy={state.status === "loading"}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{messages.eyebrow}</p>
          <h2 id={headingId}>{title}</h2>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        <span
          className={styles.count}
          aria-label={`${itemCount} ${messages.results}`}
        >
          {String(itemCount).padStart(2, "0")}
        </span>
      </header>

      <div className={styles.statusRegion} role="status" aria-live="polite">
        {coverage ? (
          <>
            <span className={styles.statusBadge} data-tone={coverage.tone}>
              {coverage.label}
            </span>
            <span className={styles.statusDetail}>{coverage.detail}</span>
          </>
        ) : (
          <span className={styles.statusDetail}>
            {state.status === "loading"
              ? messages.loading
              : state.status === "error"
                ? issueMessage(state.issue, messages)
                : messages.loading}
          </span>
        )}
      </div>

      <div className={styles.transportSlot}>
        {boundaryNotice ? (
          <p className={styles.boundaryNotice}>{boundaryNotice}</p>
        ) : state.status === "ready" ? (
          <p className={styles.transportNotice}>
            {transportLabel(state.transport, messages)}
          </p>
        ) : (
          <span className={styles.transportPlaceholder} aria-hidden="true" />
        )}
      </div>

      <div className={styles.content}>
        {loadingWithoutData ? (
          <div className={styles.skeletonList} aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div className={styles.skeletonRow} data-loading-row key={row}>
                <span className={styles.skeletonShort} />
                <span className={styles.skeletonLong} />
                <span className={styles.skeletonMedium} />
              </div>
            ))}
          </div>
        ) : response === null ? (
          <EmptyState>
            <strong>
              {state.status === "error"
                ? issueMessage(state.issue, messages)
                : messages.loading}
            </strong>
          </EmptyState>
        ) : response.result.state === "valid-empty" ? (
          <EmptyState>
            <strong>
              {response.kind === "explore-candidates"
                ? messages.noCandidates
                : messages.noIncidents}
            </strong>
            <span>{messages.notAllClear}</span>
          </EmptyState>
        ) : itemCount === 0 ? (
          <EmptyState>
            <strong>{messages.indeterminate}</strong>
            <span>{messages.notAllClear}</span>
          </EmptyState>
        ) : (
          <ul className={styles.list}>
            {candidates.map((candidate) => {
              const key = `candidate:${candidate.candidateId}`;
              const isSelected = key === selectedKey;
              const timeDescriptionId =
                `${headingId}-${candidate.candidateId}-times`;
              const selectionLabel = `${
                isSelected ? messages.selected : messages.select
              }: ${messages.candidate}, ${candidate.displayArea.cell}`;
              const selection: DiscoverySelection = {
                kind: "candidate",
                candidateId: candidate.candidateId,
                cell: candidate.displayArea.cell,
              };
              return (
                <li key={candidate.candidateId}>
                  <article
                    className={styles.itemCard}
                    data-selected={isSelected || undefined}
                  >
                    <button
                      type="button"
                      className={styles.itemButton}
                      aria-pressed={isSelected}
                      aria-describedby={timeDescriptionId}
                      aria-label={selectionLabel}
                      onClick={() => onSelectionChange(selection)}
                    >
                      <span className={styles.itemTopline}>
                        <span className={styles.itemKind}>
                          {messages.candidate}
                        </span>
                        <span className={styles.cell}>
                          {candidate.displayArea.cell}
                        </span>
                      </span>
                      <span className={styles.itemTitle}>
                        {messages.candidateTitle}
                      </span>
                      <span className={styles.itemMeta}>
                        {candidate.basis.signalKinds
                          .map(formatToken)
                          .join(" · ")}
                        {` · ${candidate.basis.observationCount} ${messages.observations}`}
                        {` · ${candidate.basis.sourceCount} ${messages.sources}`}
                      </span>
                    </button>
                    <dl className={styles.times} id={timeDescriptionId}>
                      <SemanticTime
                        label={messages.firstObserved}
                        value={candidate.times.firstObservedAt}
                        timeZone={candidate.displayArea.timeZone}
                        locale={locale}
                        presentTime={presentTime}
                      />
                      <SemanticTime
                        label={messages.latestObserved}
                        value={candidate.times.latestObservedAt}
                        timeZone={candidate.displayArea.timeZone}
                        locale={locale}
                        presentTime={presentTime}
                      />
                      <SemanticTime
                        label={messages.knownAt}
                        value={{
                          precision: "exact",
                          instant: candidate.times.knownAt,
                        }}
                        timeZone={candidate.displayArea.timeZone}
                        locale={locale}
                        presentTime={presentTime}
                      />
                    </dl>
                  </article>
                </li>
              );
            })}

            {incidents.map((incident) => {
              if (response.kind !== "nearby-incidents") return null;
              const key = `incident:${incident.incidentId}`;
              const isSelected = key === selectedKey;
              const name = localizedIncidentName(incident, locale);
              const timeDescriptionId =
                `${headingId}-${incident.incidentId}-times`;
              const selectionLabel = `${
                isSelected ? messages.selected : messages.select
              }: ${name}`;
              const selection: DiscoverySelection = {
                kind: "incident",
                incidentId: incident.incidentId,
                slug: incident.slug,
                cell: response.scope.cell,
              };
              return (
                <li key={incident.incidentId}>
                  <article
                    className={styles.itemCard}
                    data-selected={isSelected || undefined}
                  >
                    <button
                      type="button"
                      className={styles.itemButton}
                      aria-pressed={isSelected}
                      aria-describedby={timeDescriptionId}
                      aria-label={selectionLabel}
                      onClick={() => onSelectionChange(selection)}
                    >
                      <span className={styles.itemTopline}>
                        <span className={styles.itemKind}>
                          {messages.incident}
                        </span>
                        <span className={styles.lifecycle}>
                          {formatToken(incident.lifecycle)}
                        </span>
                      </span>
                      <span className={styles.itemTitle}>{name}</span>
                      <span className={styles.itemMeta}>
                        {response.scope.cell} · {response.scope.timeZone}
                      </span>
                    </button>
                    <dl className={styles.times} id={timeDescriptionId}>
                      <SemanticTime
                        label={messages.started}
                        value={incident.times.startedAt}
                        timeZone={response.scope.timeZone}
                        locale={locale}
                        presentTime={presentTime}
                      />
                      <SemanticTime
                        label={messages.latestObserved}
                        value={incident.times.latestObservedAt}
                        timeZone={response.scope.timeZone}
                        locale={locale}
                        presentTime={presentTime}
                      />
                      <SemanticTime
                        label={messages.knownAt}
                        value={{
                          precision: "exact",
                          instant: incident.times.knownAt,
                        }}
                        timeZone={response.scope.timeZone}
                        locale={locale}
                        presentTime={presentTime}
                      />
                    </dl>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {response ? (
        <footer className={styles.footer}>
          <dl className={styles.snapshotTimes}>
            <SemanticTime
              label={messages.asOf}
              value={{ precision: "exact", instant: response.time.asOf }}
              timeZone={response.time.timeZone.id}
              locale={locale}
              presentTime={presentTime}
              validatedOffset={{
                at: response.time.asOf,
                minutes: response.time.timeZone.utcOffsetMinutesAtAsOf,
              }}
            />
            <SemanticTime
              label={messages.knownAt}
              value={{ precision: "exact", instant: response.time.knownAt }}
              timeZone={response.time.timeZone.id}
              locale={locale}
              presentTime={presentTime}
            />
            <SemanticTime
              label={messages.windowStart}
              value={{
                precision: "exact",
                instant: response.time.observedWindow.from,
              }}
              timeZone={response.time.timeZone.id}
              locale={locale}
              presentTime={presentTime}
            />
          </dl>
          <p className={styles.pageNote}>
            {messages.pageBounded} · {itemCount}/{response.page.limit}
            {response.page.hasMore ? ` · ${messages.moreAvailable}` : ""}
          </p>
        </footer>
      ) : null}
    </section>
  );
}
