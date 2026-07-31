type MobileLocationSummaryProps = Readonly<{
  title: string;
  detail: string;
  actionLabel: string;
  accessibleLabel: string;
  expanded: boolean;
  onOpen: () => void;
}>;

/**
 * Compact mobile entrypoint for the location details hosted by the existing
 * bounded data sheet. It deliberately receives presentation strings only—raw
 * coordinates never enter attributes, URLs, or rendered copy.
 */
export function MobileLocationSummary({
  title,
  detail,
  actionLabel,
  accessibleLabel,
  expanded,
  onOpen,
}: MobileLocationSummaryProps) {
  return (
    <button
      type="button"
      className="locate-summary"
      aria-label={accessibleLabel}
      aria-controls="layers-sheet"
      aria-expanded={expanded}
      aria-live="polite"
      onClick={onOpen}
    >
      <strong>{title}</strong>
      <span>{detail}</span>
      <b>{actionLabel}</b>
    </button>
  );
}
