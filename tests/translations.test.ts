import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DE, ES, FR, IT } from "../app/translations";

const MAPS = [
  ["ES", ES],
  ["FR", FR],
  ["DE", DE],
  ["IT", IT],
] as const;

// localize(language, english, greek) resolves Spanish/French by looking the
// English argument up in the dictionaries. Extract every English string
// literal that can reach that lookup and require a translation for it.
function extractEnglishKeys(source: string): string[] {
  const keys: string[] = [];
  let index = 0;
  while (true) {
    index = source.indexOf("localize(", index);
    if (index < 0) break;
    let depth = 0;
    let end = index + "localize".length;
    while (end < source.length) {
      const char = source[end];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      end += 1;
    }
    const body = source.slice(index, end + 1);
    index = end;
    if (body.includes("Language")) continue; // the localize definition itself

    // Split top-level arguments, then collect double-quoted literals from
    // the English (second) argument only.
    const inner = body.slice(body.indexOf("(") + 1, -1);
    const args: string[] = [];
    let current = "";
    let quote: string | null = null;
    let nesting = 0;
    for (let i = 0; i < inner.length; i += 1) {
      const char = inner[i] as string;
      if (quote) {
        current += char;
        if (char === "\\") {
          current += inner[i + 1];
          i += 1;
        } else if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === "`") {
        quote = char;
        current += char;
      } else if ("([{".includes(char)) {
        nesting += 1;
        current += char;
      } else if (")]}".includes(char)) {
        nesting -= 1;
        current += char;
      } else if (char === "," && nesting === 0) {
        args.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) args.push(current.trim());
    const englishArg = args[1];
    if (!englishArg) continue;
    for (const match of englishArg.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      // Skip literals used as comparison operands, e.g.
      // item.sourceKind === "official-alert" ? ... : ...
      if (/[=!]==\s*$/.test(englishArg.slice(0, match.index))) continue;
      keys.push(JSON.parse(`"${match[1]}"`) as string);
    }
  }
  return [...new Set(keys)];
}

const pageSource = readFileSync(
  join(__dirname, "..", "app", "page.tsx"),
  "utf8",
);
const keys = extractEnglishKeys(pageSource);

describe("translations", () => {
  it("extracts a sane number of localize keys from page.tsx", () => {
    expect(keys.length).toBeGreaterThan(150);
  });

  it.each(MAPS)("%s covers every localize English string", (_name, map) => {
    const missing = keys.filter((key) => map[key] === undefined);
    expect(missing).toEqual([]);
  });

  it("all dictionaries have identical key sets", () => {
    const reference = Object.keys(ES).sort();
    for (const [name, map] of MAPS) {
      expect(Object.keys(map).sort(), `${name} key set differs`).toEqual(
        reference,
      );
    }
  });

  it("covers static intel, sources, and live feed summaries", () => {
    for (const key of [
      "Fire reported",
      "Fire Service board",
      "Item from an official source. Open the direct source for the full statement and any instructions.",
      "Headline link from the publisher; open the direct source for the full report.",
      "Evacuation",
      "Rekindling",
    ]) {
      for (const [name, map] of MAPS) {
        expect(map[key], `${name} missing: ${key}`).toBeDefined();
      }
    }
  });
});
