import Link from "next/link";

type GlobalDiscoveryLinkProps = Readonly<{
  language: "en" | "el";
  variant: "desktop" | "mobile";
}>;

const COPY = Object.freeze({
  en: Object.freeze({
    label: "Global discovery",
    shortLabel: "Global",
    boundary: "May be partial / unconfigured",
    accessibleLabel:
      "Open global wildfire discovery. Coverage may be partial or unconfigured.",
  }),
  el: Object.freeze({
    label: "Παγκόσμια ανίχνευση",
    shortLabel: "Παγκόσμια",
    boundary: "Ίσως μερική / μη ρυθμισμένη",
    accessibleLabel:
      "Άνοιγμα παγκόσμιας ανίχνευσης πυρκαγιών. Η κάλυψη μπορεί να είναι μερική ή μη ρυθμισμένη.",
  }),
});

export function GlobalDiscoveryLink({
  language,
  variant,
}: GlobalDiscoveryLinkProps) {
  const copy = COPY[language];
  return (
    <Link
      className={`global-discovery-link global-discovery-link--${variant}`}
      href="/explore"
      prefetch={false}
      aria-label={copy.accessibleLabel}
    >
      {variant === "mobile" ? (
        <span className="global-discovery-link__icon" aria-hidden="true">
          ◉
        </span>
      ) : null}
      <b>{variant === "mobile" ? copy.shortLabel : copy.label}</b>
      <small>{copy.boundary}</small>
    </Link>
  );
}
