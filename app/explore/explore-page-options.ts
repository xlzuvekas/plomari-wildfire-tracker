import { parseAreaCellKey } from "../../lib/firewatch/map-context";

type ExploreSearchParameters = Record<
  string,
  string | readonly string[] | undefined
>;

export type ExplorePageOptions = Readonly<{
  fixtureMode: boolean;
  initialSuggestedCell: string | null;
}>;

function oneValue(value: string | readonly string[] | undefined) {
  return typeof value === "string" ? value : null;
}

export function resolveExplorePageOptions(
  parameters: ExploreSearchParameters,
  environment: string,
): ExplorePageOptions {
  const requestedCell = oneValue(parameters.cell);
  const parsedCell = requestedCell ? parseAreaCellKey(requestedCell) : null;
  return Object.freeze({
    fixtureMode:
      environment === "development" &&
      oneValue(parameters.fixture) === "synthetic",
    initialSuggestedCell:
      parsedCell?.cellKey === requestedCell ? requestedCell : null,
  });
}

export type { ExploreSearchParameters };
