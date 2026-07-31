export type StoredAlertPreference = "0" | "1" | null;

/**
 * An archived instruction starts compact on a small screen unless the viewer
 * explicitly chose otherwise. The automatic default is never persisted; only
 * an explicit expand/collapse action becomes a preference.
 */
export function initialArchivedAlertCollapsed(
  storedPreference: string | null,
  compactViewport: boolean,
): boolean {
  if (storedPreference === "1") return true;
  if (storedPreference === "0") return false;
  return compactViewport;
}
