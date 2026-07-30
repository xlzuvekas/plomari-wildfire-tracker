import { describe, expect, it } from "vitest";
import {
  NEWS_FEEDS,
  fireRelated,
  mergeNews,
  parseFeedItems,
} from "../app/api/regionnews/feeds";

const FEED = { id: "test", label: "Test", url: "https://example.org/rss" };

const rss = (items: string) => `<rss><channel>${items}</channel></rss>`;
const item = (title: string, date = "Wed, 30 Jul 2026 06:00:00 GMT") =>
  `<item><title><![CDATA[${title}]]></title><link>https://example.org/${encodeURIComponent(
    title,
  )}</link><pubDate>${date}</pubDate></item>`;

describe("fireRelated", () => {
  it("matches fire terms across the pack languages", () => {
    for (const headline of [
      "Incendie à Brignoles : 100 hectares parcourus",
      "El incendio de Fermoselle obliga a desalojar a 800 personas",
      "O lume de Maceda segue activo",
      "L'incendi de la Vall d'Uixó continua",
    ]) {
      expect(fireRelated(headline), headline).toBe(true);
    }
    expect(fireRelated("El equipo gana la liga")).toBe(false);
  });
});

describe("parseFeedItems", () => {
  it("keeps only fire-related items from general feeds", () => {
    const xml = rss(item("Incendio forestal en Zamora") + item("Nueva ópera"));
    const items = parseFeedItems(xml, FEED);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Incendio forestal en Zamora");
  });

  it("passes everything through for the prefiltered franceinfo feed", () => {
    const feed = NEWS_FEEDS.fr.find((f) => f.id === "franceinfo-fires")!;
    const xml = rss(item("Un titre sans mot-clé"));
    expect(parseFeedItems(xml, feed)).toHaveLength(1);
  });
});

describe("mergeNews", () => {
  it("reserves slots for older official items past the cap", () => {
    const media = Array.from({ length: 20 }, (_, i) =>
      parseFeedItems(
        rss(item(`Incendie média ${i}`, `Wed, 30 Jul 2026 ${String(6 + Math.floor(i / 10))}:${String(i % 10)}0:00 GMT`)),
        FEED,
      ),
    ).flat();
    const official = parseFeedItems(
      rss(item("Incendio: comunicado oficial", "Tue, 29 Jul 2026 12:00:00 GMT")),
      { id: "junta", label: "Junta", url: "https://example.org", official: true },
    );
    const merged = mergeNews([media, official], 16);
    expect(merged).toHaveLength(16);
    expect(merged.some((entry) => entry.official)).toBe(true);
  });

  it("dedupes by url and sorts newest first", () => {
    const a = parseFeedItems(
      rss(item("Incendie A", "Wed, 30 Jul 2026 04:00:00 GMT")),
      FEED,
    );
    const b = parseFeedItems(
      rss(
        item("Incendie B", "Wed, 30 Jul 2026 06:00:00 GMT") +
          item("Incendie A", "Wed, 30 Jul 2026 04:00:00 GMT"),
      ),
      FEED,
    );
    const merged = mergeNews([a, b]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.title).toBe("Incendie B");
  });
});
