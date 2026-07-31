import type { ThermalAnomalyItem } from "@/lib/firewatch/v3";

export type ThermalAssessmentPresentation = Readonly<{
  label: string;
  detail: string;
  tone: "observed" | "waiting" | "unknown";
}>;

export function presentThermalAssessment(
  anomaly: ThermalAnomalyItem,
): ThermalAssessmentPresentation {
  switch (anomaly.assessment.state) {
    case "detected":
      return {
        label: "Thermal anomaly observed",
        detail:
          "FIRMS returned a source-reported thermal-pixel anomaly. It is not a flame location, fire perimeter, or incident confirmation.",
        tone: "observed",
      };
    case "awaiting_later_assessment":
      return {
        label: "Waiting for a later assessment",
        detail:
          anomaly.assessment.reason ===
          "cmr_coverage_only_anomaly_not_assessed"
            ? "A later catalog footprint exists, but catalog coverage does not assess whether a thermal anomaly remains."
            : "No later, complete and assessable thermal result is available for this observation yet.",
        tone: "waiting",
      };
    case "unknown":
      return {
        label: "Latest assessment unknown",
        detail:
          "No later assessable thermal evidence is available. The original observation remains visible, but current conditions cannot be inferred.",
        tone: "unknown",
      };
  }
}

export function presentThermalConfidence(
  anomaly: ThermalAnomalyItem,
): string {
  return anomaly.confidence.encoding === "class"
    ? `${anomaly.confidence.value} confidence`
    : `${anomaly.confidence.value.toFixed(0)}% confidence`;
}

export function presentThermalPlatform(anomaly: ThermalAnomalyItem): string {
  return `${anomaly.product.platform} · ${anomaly.product.instrument}`;
}
