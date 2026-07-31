import type { Ref } from "react";

type MobileLocationSummaryProps = Readonly<{
  title: string;
  detail: string;
  actionLabel: string;
  accessibleLabel: string;
  expanded: boolean;
  onOpen: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
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
  buttonRef,
}: MobileLocationSummaryProps) {
  return (
    <button
      type="button"
      ref={buttonRef}
      className="locate-summary"
      aria-label={accessibleLabel}
      aria-controls="layers-sheet"
      aria-expanded={expanded}
      onClick={onOpen}
    >
      <strong>{title}</strong>
      <span>{detail}</span>
      <b>{actionLabel}</b>
    </button>
  );
}
