import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeInfoca } from "../app/api/spain-incidents/infoca";
import { normalizeInforcyl } from "../app/api/spain-incidents/inforcyl";

const infocaFixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "infoca-incidents.json"), "utf8"),
) as unknown;

// Fixture captured 2026-07-30; a since-date inside its window.
const SINCE = Date.parse("2026-07-16T00:00:00Z");

describe("normalizeInfoca", () => {
  it("extracts forest-fire incidents with status and coordinates", () => {
    const incidents = normalizeInfoca(infocaFixture, SINCE);
    expect(incidents.length).toBeGreaterThan(0);
    for (const incident of incidents) {
      expect(incident.source).toBe("INFOCA");
      expect(incident.status).toMatch(/ACTIVO|CONTROLADO|EXTINGUIDO/);
      expect(incident.lat).toBeGreaterThan(35);
      expect(incident.lat).toBeLessThan(39.5);
      expect(incident.lon).toBeGreaterThan(-8);
      expect(incident.lon).toBeLessThan(0);
      expect(incident.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("drops incidents older than the window", () => {
    const farFuture = Date.parse("2030-01-01T00:00:00Z");
    expect(normalizeInfoca(infocaFixture, farFuture)).toEqual([]);
  });

  it("drops non-fire incident types and malformed payloads", () => {
    expect(
      normalizeInfoca(
        {
          features: [
            {
              attributes: {
                TIPO_INCIDENTE: "SIMULACRO",
                FECHA: SINCE + 1,
                ESTADO: "ACTIVO",
              },
              geometry: { x: -4, y: 37 },
            },
          ],
        },
        SINCE,
      ),
    ).toEqual([]);
    expect(normalizeInfoca(null, SINCE)).toEqual([]);
  });
});

describe("normalizeInforcyl", () => {
  it("tags rows with the INFORCYL source", () => {
    const incidents = normalizeInforcyl({
      results: [
        {
          fecha_de_inicio: "2026-07-28",
          provincia: ["LEÓN"],
          termino_municipal: "TEST",
          situacion_actual: "ACTIVO",
          nivel: 2,
          nivel_maximo_alcanzado: 2,
          tipo_y_has_de_superficie_afectada: null,
          posicion: { lat: 42.7, lon: -5.9 },
        },
      ],
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.source).toBe("INFORCYL");
    expect(incidents[0]?.level).toBe(2);
  });
});
