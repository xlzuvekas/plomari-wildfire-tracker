import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DiscoveryPanel,
  discoverySelectionKey,
  presentDiscoveryTime,
  type DiscoveryPanelState,
  type DiscoverySelection,
} from "../components/firewatch";
import {
  GLOBAL_DISCOVERY_POLICY_VERSION,
  exploreDiscoveryResponseSchema,
} from "../lib/firewatch/v3";
import {
  SYNTHETIC_MARSEILLE_EXPLORE,
  SYNTHETIC_PARIS_VALID_EMPTY,
  SYNTHETIC_PLOMARI_NEARBY,
} from "./fixtures/global-discovery-v3";

function copy<Value>(value: Value): Value {
  return structuredClone(value);
}

function render(state: DiscoveryPanelState, selected?: DiscoverySelection) {
  return renderToStaticMarkup(
    <DiscoveryPanel
      state={state}
      selected={selected}
      locale="en-GB"
      onSelectionChange={() => undefined}
    />,
  );
}

describe("semantic global discovery panel", () => {
  it("renders candidates as native keyboard-safe controls with explicit time semantics", () => {
    const candidate = SYNTHETIC_MARSEILLE_EXPLORE.candidates[0];
    if (!candidate) throw new Error("Missing Marseille candidate");
    const selected: DiscoverySelection = {
      kind: "candidate",
      candidateId: candidate.candidateId,
      cell: candidate.displayArea.cell,
    };
    const markup = render(
      {
        status: "ready",
        mode: "explore-candidates",
        response: SYNTHETIC_MARSEILLE_EXPLORE,
        transport: "live",
      },
      selected,
    );

    expect(markup).toContain('<button type="button"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("</button><dl");
    expect(markup).not.toMatch(
      /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<dl/u,
    );
    expect(markup).toContain("wm/10/527/375");
    expect(markup).toContain("Europe/Paris · UTC+02:00");
    expect(markup).toContain("16:50:00 UTC");
    expect(markup).toContain('dateTime="2026-07-31T16:50:00.000Z"');
    expect(markup).toContain("Bounded discovery page");
    expect(markup).not.toContain("latitude");
    expect(markup).not.toContain("longitude");
    expect(discoverySelectionKey(selected)).toBe(
      `candidate:${candidate.candidateId}`,
    );
  });

  it("keeps incident records structurally and semantically distinct", () => {
    const incident = SYNTHETIC_PLOMARI_NEARBY.incidents[0];
    if (!incident) throw new Error("Missing Plomari incident");
    const markup = renderToStaticMarkup(
      <DiscoveryPanel
        locale="el-GR"
        onSelectionChange={() => undefined}
        state={{
          status: "ready",
          mode: "nearby-incidents",
          response: SYNTHETIC_PLOMARI_NEARBY,
          transport: "revalidated-cache",
        }}
        selected={{
          kind: "incident",
          incidentId: incident.incidentId,
          slug: incident.slug,
          cell: SYNTHETIC_PLOMARI_NEARBY.scope.cell,
        }}
      />,
    );
    expect(markup).toContain("Incident record");
    expect(markup).toContain("Συνθετικό συμβάν Πλωμαρίου");
    expect(markup).toContain("Europe/Athens · UTC+03:00");
    expect(markup).toContain("Revalidated cache");
    expect(markup).not.toContain("Unconfirmed candidate");
  });

  it("states valid-empty safely without implying an all-clear", () => {
    const markup = render({
      status: "ready",
      mode: "nearby-incidents",
      response: SYNTHETIC_PARIS_VALID_EMPTY,
      transport: "live",
    });
    expect(markup).toContain(
      "No known incidents in this coarse area and observation window.",
    );
    expect(markup).toContain(
      "This is not an all-clear or proof that no wildfire exists.",
    );
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain('aria-label="safe"');
  });

  it("labels fixture and cache-fallback transport separately from domain coverage", () => {
    const fixture = render({
      status: "ready",
      mode: "explore-candidates",
      response: SYNTHETIC_MARSEILLE_EXPLORE,
      transport: "fixture",
    });
    expect(fixture).toContain("Synthetic fixture");
    expect(fixture).toContain("Coverage complete");

    const lastGood = render({
      status: "ready",
      mode: "explore-candidates",
      response: SYNTHETIC_MARSEILLE_EXPLORE,
      transport: "cache-fallback",
    });
    expect(lastGood).toContain("Last-good snapshot");
    expect(lastGood).toContain("Coverage complete");
  });

  it("renders complete, stale, partial, unavailable, disabled, and unconfigured coverage explicitly", () => {
    const complete = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    const stale = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    stale.coverage = {
      state: "stale",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      freshnessDeadline: "2026-07-31T16:45:00.000Z",
      coveredEventWindow: {
        from: "2026-07-30T17:00:00.000Z",
        through: "2026-07-31T17:00:00.000Z",
      },
      lastCompleteAt: "2026-07-31T16:30:00.000Z",
      requiredPartitionCount: 3,
      completedPartitionCount: 3,
    };
    const partial = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    partial.coverage = {
      state: "partial",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      requiredPartitionCount: 3,
      completedPartitionCount: 2,
    };
    const unavailable = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    unavailable.coverage = {
      state: "unavailable",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      retryAfterSeconds: 300,
    };
    unavailable.result = { state: "indeterminate" };
    unavailable.candidates = [];
    const disabled = copy(unavailable);
    disabled.coverage = {
      state: "disabled",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
    };
    const unconfigured = copy(unavailable);
    unconfigured.coverage = {
      state: "unconfigured",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
    };

    const states = [
      [complete, "Coverage complete"],
      [stale, "Coverage stale"],
      [partial, "Coverage partial"],
      [unavailable, "Discovery unavailable"],
      [disabled, "Discovery disabled"],
      [unconfigured, "Discovery unconfigured"],
    ] as const;
    for (const [response, expected] of states) {
      const markup = render({
        status: "ready",
        mode: "explore-candidates",
        response,
        transport: "live",
      });
      expect(markup).toContain(expected);
      if (response.coverage.state === "complete") {
        expect(markup).toContain("Checked 31 Jul 2026");
        expect(markup).toContain("Fresh through 31 Jul 2026");
      }
      if (response.coverage.state === "partial") {
        expect(markup).toContain("Checked 31 Jul 2026");
      }
    }
  });

  it("keeps loading geometry stable and labels retained last-good data", () => {
    const loading = render({
      status: "loading",
      mode: "explore-candidates",
    });
    expect(loading).toContain('aria-busy="true"');
    expect(loading.match(/data-loading-row/g)).toHaveLength(3);

    const lastGood = render({
      status: "error",
      mode: "nearby-incidents",
      issue: "unavailable",
      lastGood: SYNTHETIC_PARIS_VALID_EMPTY,
    });
    expect(lastGood).toContain("Last-good snapshot");
    expect(lastGood).toContain("cannot be reached right now");
    expect(lastGood).toContain("not an all-clear");
  });

  it("preserves date-only and unknown precision without fabricating a clock", () => {
    expect(
      presentDiscoveryTime(
        { precision: "unknown" },
        "Europe/Paris",
        "en-GB",
      ),
    ).toEqual({
      dateTime: undefined,
      primary: "Time unknown",
      context: "No source timestamp supplied",
      title: "The source did not provide a usable event time.",
    });
    const dateOnly = presentDiscoveryTime(
      { precision: "date_only", date: "2026-07-31" },
      "Europe/Paris",
      "en-GB",
    );
    expect(dateOnly.primary).toBe("31 Jul 2026");
    expect(dateOnly.context).toContain("date only · no clock supplied");
    expect(dateOnly.context).not.toContain("00:00");
  });

  it("uses non-time markup when an item timestamp is unknown", () => {
    const response = copy(SYNTHETIC_PLOMARI_NEARBY);
    const incident = response.incidents[0];
    if (!incident) throw new Error("Missing Plomari incident");
    incident.times.startedAt = { precision: "unknown" };
    const markup = render({
      status: "ready",
      mode: "nearby-incidents",
      response,
      transport: "live",
    });
    expect(markup).toContain("Time unknown");
    expect(markup).not.toMatch(
      /<time\b[^>]*>(?:(?!<\/time>)[\s\S])*Time unknown/u,
    );
  });

  it("lets callers replace all visible status and time-presentation copy", () => {
    const markup = renderToStaticMarkup(
      <DiscoveryPanel
        locale="el-GR"
        onSelectionChange={() => undefined}
        presentTime={(value) => ({
          dateTime:
            value.precision === "exact"
              ? value.instant
              : value.precision === "date_only"
                ? value.date
                : undefined,
          primary: "31 Ιουλίου 2026, 18:00",
          context: "τοπική ώρα · επαληθευμένη ζώνη",
          title: "Πλήρης χρονική ένδειξη",
        })}
        messages={{
          eyebrow: "ΠΑΓΚΟΣΜΙΑ ΑΝΙΧΝΕΥΣΗ // V3",
          nearbyTitle: "Κοντινά συμβάντα",
          nearbySubtitle: "Επιβεβαιωμένα αρχεία · ευρεία περιοχή",
          coverageComplete: "Πλήρης κάλυψη",
          coveragePartitions: "τμήματα πολιτικής ελέγχθηκαν",
          checkedAt: "Ελέγχθηκε",
          freshThrough: "Ενημερωμένο έως",
          live: "Ζωντανή ανάγνωση",
          noIncidents: "Δεν βρέθηκαν γνωστά συμβάντα.",
          notAllClear: "Δεν αποτελεί δήλωση ασφάλειας.",
          asOf: "Συμβάντα έως",
          knownAt: "Γνώση έως",
          windowStart: "Αρχή παραθύρου",
          pageBounded: "Περιορισμένη σελίδα",
          results: "αποτελέσματα",
        }}
        state={{
          status: "ready",
          mode: "nearby-incidents",
          response: SYNTHETIC_PARIS_VALID_EMPTY,
          transport: "live",
        }}
      />,
    );
    expect(markup).toContain("Πλήρης κάλυψη");
    expect(markup).toContain("τοπική ώρα · επαληθευμένη ζώνη");
    expect(markup).not.toMatch(
      /GLOBAL DISCOVERY|Coverage complete|Checked|Fresh through|Live read|No known incidents|not an all-clear|Events as of|Knowledge as of|Observation window starts|Bounded discovery page/u,
    );
  });

  it("does not flatten offsets across an observation window DST transition", () => {
    const validatedCutoff = {
      at: "2026-03-29T02:00:00.000Z",
      minutes: 120,
    } as const;
    const cutoff = presentDiscoveryTime(
      { precision: "exact", instant: validatedCutoff.at },
      "Europe/Paris",
      "en-GB",
      validatedCutoff,
    );
    const windowStart = presentDiscoveryTime(
      { precision: "exact", instant: "2026-03-29T00:30:00.000Z" },
      "Europe/Paris",
      "en-GB",
      validatedCutoff,
    );
    expect(cutoff.context).toContain("UTC+02:00");
    expect(windowStart.context).toContain("UTC+01:00");
  });

  it("renders item timestamps on both sides of a DST transition", () => {
    const response = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    const candidate = response.candidates[0];
    if (!candidate || response.coverage.state !== "complete") {
      throw new Error("Missing complete Marseille candidate fixture");
    }
    response.time.asOf = "2026-03-29T02:00:00.000Z";
    response.time.knownAt = "2026-03-29T02:05:00.000Z";
    response.time.observedWindow = {
      from: "2026-03-28T02:00:00.000Z",
      to: "2026-03-29T02:00:00.000Z",
    };
    response.coverage.checkedAt = "2026-03-29T02:04:00.000Z";
    response.coverage.freshnessDeadline = "2026-03-29T02:20:00.000Z";
    response.coverage.coveredEventWindow = {
      from: "2026-03-28T02:00:00.000Z",
      through: "2026-03-29T02:00:00.000Z",
    };
    candidate.times.firstObservedAt = {
      precision: "exact",
      instant: "2026-03-29T00:30:00.000Z",
    };
    candidate.times.latestObservedAt = {
      precision: "exact",
      instant: "2026-03-29T02:00:00.000Z",
    };
    candidate.times.knownAt = "2026-03-29T02:01:00.000Z";

    expect(exploreDiscoveryResponseSchema.safeParse(response).success).toBe(
      true,
    );
    const markup = render({
      status: "ready",
      mode: "explore-candidates",
      response,
      transport: "live",
    });
    expect(markup).toContain("Europe/Paris · UTC+01:00");
    expect(markup).toContain("Europe/Paris · UTC+02:00");
  });
});
