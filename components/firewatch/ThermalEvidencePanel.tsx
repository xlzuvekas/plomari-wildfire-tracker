import type { ThermalAnomalyAreaState } from "@/hooks/use-thermal-anomaly-area";
import type { ThermalAnomalyItem } from "@/lib/firewatch/v3";

import { presentDiscoveryTime } from "./discovery-presentation";
import {
  presentThermalAssessment,
  presentThermalConfidence,
  presentThermalPlatform,
} from "./thermal-anomaly-presentation";
import styles from "./ThermalEvidencePanel.module.css";

type ThermalEvidencePanelProps = Readonly<{
  state: ThermalAnomalyAreaState;
  timeZone: string;
  locale?: string;
}>;

function SemanticTime({
  label,
  instant,
  timeZone,
  locale,
}: Readonly<{
  label: string;
  instant: string;
  timeZone: string;
  locale?: string;
}>) {
  const presented = presentDiscoveryTime(
    { precision: "exact", instant },
    timeZone,
    locale,
  );
  return (
    <div className={styles.timeRow}>
      <dt>{label}</dt>
      <dd>
        <time dateTime={instant} title={presented.title}>
          <span className={styles.timePrimary}>{presented.primary}</span>
          <span className={styles.timeContext}>{presented.context}</span>
        </time>
      </dd>
    </div>
  );
}

function ThermalItem({
  anomaly,
  timeZone,
  locale,
}: Readonly<{
  anomaly: ThermalAnomalyItem;
  timeZone: string;
  locale?: string;
}>) {
  const assessment = presentThermalAssessment(anomaly);
  return (
    <li>
      <article className={styles.item}>
        <div className={styles.itemHeading}>
          <h3>{presentThermalPlatform(anomaly)}</h3>
          <span className={styles.badge} data-tone={assessment.tone}>
            {assessment.label}
          </span>
        </div>
        <p className={styles.itemMeta}>
          {presentThermalConfidence(anomaly)} · {anomaly.measurements.frpMw} MW
          FRP · {anomaly.pixel.scanKm} × {anomaly.pixel.trackKm} km source
          dimensions
        </p>
        <p className={styles.assessmentDetail}>{assessment.detail}</p>
        <dl className={styles.times}>
          <SemanticTime
            label="Observed"
            instant={anomaly.times.acquiredAt}
            timeZone={timeZone}
            locale={locale}
          />
          {anomaly.times.publishedAt ? (
            <SemanticTime
              label="Published"
              instant={anomaly.times.publishedAt}
              timeZone={timeZone}
              locale={locale}
            />
          ) : null}
          <SemanticTime
            label="Retrieved"
            instant={anomaly.times.retrievedAt}
            timeZone={timeZone}
            locale={locale}
          />
          <SemanticTime
            label="Assessment known"
            instant={anomaly.assessment.knownAt}
            timeZone={timeZone}
            locale={locale}
          />
        </dl>
      </article>
    </li>
  );
}

function statusMessage(
  state: Extract<ThermalAnomalyAreaState, { status: "error" }>,
) {
  switch (state.issue) {
    case "invalid-request":
      return "The persisted thermal request was rejected. No thermal assessment is shown.";
    case "invalid-response":
      return "The persisted thermal response failed its safety contract and was hidden.";
    case "snapshot-changed":
      return "The evidence snapshot changed during the read. Refresh Nearby to restart from the first page.";
    case "unavailable":
      return "Persisted thermal evidence is unavailable. No thermal assessment can be made right now.";
  }
}

function snapshotMessage(data: Extract<ThermalAnomalyAreaState, { status: "ready" }>["data"]) {
  const count = data.anomalies.length;
  if (count === 0) {
    return "No assessed thermal-pixel rows are visible at these cutoffs. Coverage remains not assessed; this is not an all-clear.";
  }
  return `This bounded page contains ${count} persisted thermal-pixel ${count === 1 ? "observation" : "observations"}. Area coverage remains not assessed.`;
}

export function ThermalEvidencePanel({
  state,
  timeZone,
  locale = "en-GB",
}: ThermalEvidencePanelProps) {
  const data = state.status === "ready" ? state.data : null;
  const observationCount = data?.anomalies.length;
  return (
    <section className={styles.panel} aria-label="Persisted thermal evidence">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SATELLITE THERMAL // PERSISTED V3</p>
          <h2>Thermal-pixel observations</h2>
        </div>
        <span
          className={styles.count}
          aria-label={
            observationCount === undefined
              ? "Observation count unavailable"
              : `${observationCount} ${observationCount === 1 ? "observation" : "observations"}`
          }
        >
          {observationCount === undefined
            ? "—"
            : String(observationCount).padStart(2, "0")}
        </span>
      </header>

      <div className={styles.status} role="status" aria-live="polite">
        <span className={styles.badge}>Coverage not assessed</span>
        <p>
          {state.status === "idle"
            ? "Waiting for a validated Nearby snapshot before requesting thermal evidence."
            : state.status === "loading"
              ? "Loading the first bounded page of persisted thermal evidence."
              : state.status === "error"
                ? statusMessage(state)
                : snapshotMessage(state.data)}
        </p>
      </div>

      {data ? (
        <div className={styles.snapshotContext}>
          <p className={styles.scopeRow}>
            <span>Coarse area</span>
            <code>{data.scope.cell}</code>
          </p>
          <dl className={styles.snapshotTimes}>
            <SemanticTime
              label="Window starts"
              instant={data.time.observedWindow.from}
              timeZone={timeZone}
              locale={locale}
            />
            <SemanticTime
              label="Events through"
              instant={data.time.asOf}
              timeZone={timeZone}
              locale={locale}
            />
            <SemanticTime
              label="Knowledge through"
              instant={data.time.knownAt}
              timeZone={timeZone}
              locale={locale}
            />
          </dl>
        </div>
      ) : null}

      {data && data.anomalies.length > 0 ? (
        <ul className={styles.list}>
          {data.anomalies.map((anomaly) => (
            <ThermalItem
              anomaly={anomaly}
              timeZone={timeZone}
              locale={locale}
              key={anomaly.detectionId}
            />
          ))}
        </ul>
      ) : data ? (
        <p className={styles.empty}>
          No assessed thermal-pixel rows are visible at these cutoffs. Coverage
          was not assessed, so this is not evidence that no wildfire exists.
        </p>
      ) : null}

      {data?.page.hasMore ? (
        <p className={styles.pageNote}>
          Additional observations exist. This safety-first view displays only
          the first bounded page.
        </p>
      ) : null}

      <p className={styles.safety}>
        Thermal pixels are observations, not flame locations, fire perimeters,
        incident confirmation, official status, protective guidance,
        containment, resolution, or an all-clear.
      </p>
    </section>
  );
}
