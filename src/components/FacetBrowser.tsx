/**
 * FacetBrowser: React island. Filters the `work` collection by domain,
 * method and year.
 *
 * All data arrives pre-serialized from `src/pages/work/index.astro`, plain
 * strings/numbers only, no `Date` objects and no raw collection entries
 * cross the island boundary. Facet option lists are derived server-side too
 * and passed in as props.
 *
 * Hydrated with `client:visible` on the page, so this must render usefully
 * on its own (the page's server-rendered Timeline is the no-JS fallback;
 * this component is a pure enhancement for users who have JS).
 */
import { useMemo, useState } from "react";

export type WorkKind = "research" | "coursework" | "personal" | "industry";

export interface FacetWorkEntry {
  id: string;
  title: string;
  summary: string;
  kind: WorkKind;
  domains: string[];
  methods: string[];
  featured: boolean;
  year: number;
  startLabel: string;
  /** null means the entry is ongoing: represented honestly, not with a fake end date. */
  endLabel: string | null;
}

interface FacetBrowserProps {
  entries: FacetWorkEntry[];
  domainOptions: string[];
  methodOptions: string[];
  yearOptions: number[];
}

type FacetGroup = "domain" | "method" | "year";

interface ActiveFilter {
  group: FacetGroup;
  value: string;
  label: string;
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

export default function FacetBrowser({
  entries,
  domainOptions,
  methodOptions,
  yearOptions,
}: FacetBrowserProps) {
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      const domainOk =
        selectedDomains.size === 0 || entry.domains.some((d) => selectedDomains.has(d));
      const methodOk =
        selectedMethods.size === 0 || entry.methods.some((m) => selectedMethods.has(m));
      const yearOk = selectedYears.size === 0 || selectedYears.has(entry.year);
      return domainOk && methodOk && yearOk;
    });
  }, [entries, selectedDomains, selectedMethods, selectedYears]);

  const activeFilters: ActiveFilter[] = useMemo(
    () => [
      ...Array.from(selectedDomains).map((v) => ({ group: "domain" as const, value: v, label: v })),
      ...Array.from(selectedMethods).map((v) => ({ group: "method" as const, value: v, label: v })),
      ...Array.from(selectedYears).map((v) => ({
        group: "year" as const,
        value: String(v),
        label: String(v),
      })),
    ],
    [selectedDomains, selectedMethods, selectedYears],
  );

  function removeFilter(group: FacetGroup, value: string) {
    if (group === "domain") setSelectedDomains((prev) => toggleInSet(prev, value));
    else if (group === "method") setSelectedMethods((prev) => toggleInSet(prev, value));
    else setSelectedYears((prev) => toggleInSet(prev, Number(value)));
  }

  function resetAll() {
    setSelectedDomains(new Set());
    setSelectedMethods(new Set());
    setSelectedYears(new Set());
  }

  const hasFilters = activeFilters.length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-x-8 gap-y-5">
          <FacetGroupControl
            label="Domain"
            options={domainOptions}
            selected={selectedDomains}
            onToggle={(v) => setSelectedDomains((prev) => toggleInSet(prev, v))}
          />
          <FacetGroupControl
            label="Method"
            options={methodOptions}
            selected={selectedMethods}
            onToggle={(v) => setSelectedMethods((prev) => toggleInSet(prev, v))}
          />
          <FacetGroupControl
            label="Year"
            options={yearOptions.map(String)}
            selected={new Set(Array.from(selectedYears, String))}
            onToggle={(v) => setSelectedYears((prev) => toggleInSet(prev, Number(v)))}
          />
        </div>

        <button
          type="button"
          onClick={resetAll}
          disabled={!hasFilters}
          className="shrink-0 border border-rule px-3 py-1.5 font-mono text-micro uppercase tracking-widest text-muted transition-colors duration-200 hover:enabled:border-accent-dim hover:enabled:text-accent disabled:opacity-40"
        >
          Reset filters
        </button>
      </div>

      {hasFilters && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
          <span className="font-mono text-micro uppercase tracking-widest text-faint">Active:</span>
          {activeFilters.map((f) => (
            <button
              key={`${f.group}-${f.value}`}
              type="button"
              onClick={() => removeFilter(f.group, f.value)}
              aria-label={`Remove filter: ${f.group} ${f.label}`}
              className="border border-accent-dim px-2 py-0.5 font-mono text-micro text-accent transition-colors duration-200 hover:bg-accent hover:text-ground"
            >
              <span aria-hidden="true">
                {f.label} ×
              </span>
            </button>
          ))}
        </div>
      )}

      <p aria-live="polite" className="mt-5 font-mono text-small text-muted">
        {filtered.length} of {entries.length} {entries.length === 1 ? "project" : "projects"}
        {hasFilters ? " match these filters" : ""}
      </p>

      {filtered.length === 0 ? (
        <p className="mt-4 border border-dashed border-rule p-6 text-center text-small text-muted">
          No work matches these filters.
        </p>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {filtered.map((entry) => (
            <li key={entry.id}>
              <a
                href={`/work/${entry.id}/`}
                className="group relative block h-full border border-rule bg-raised p-5 transition-colors duration-200 hover:border-accent-dim focus-visible:border-accent"
              >
                {entry.featured && (
                  <span className="absolute right-5 top-5 font-mono text-micro font-bold uppercase tracking-widest text-accent">
                    Featured
                  </span>
                )}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-16 font-mono text-micro uppercase tracking-widest text-muted">
                  <span>{entry.kind}</span>
                  <span aria-hidden="true" className="text-faint">
                    /
                  </span>
                  <span>
                    {entry.startLabel}
                    {" – "}
                    {entry.endLabel ?? <span className="text-accent">ongoing</span>}
                  </span>
                </div>
                <h3 className="mt-3 break-words text-lede">{entry.title}</h3>
                <p className="mt-2 max-w-prose text-small text-text">{entry.summary}</p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FacetGroupControl({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <fieldset>
      <legend className="font-mono text-micro uppercase tracking-widest text-muted">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((opt) => {
          const isActive = selected.has(opt);
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={isActive}
              aria-label={`${label}: ${opt}`}
              onClick={() => onToggle(opt)}
              className={
                isActive
                  ? "border border-accent bg-accent px-2.5 py-1 font-mono text-micro font-bold text-ground"
                  : "border border-rule px-2.5 py-1 font-mono text-micro text-muted transition-colors duration-200 hover:border-accent-dim hover:text-text"
              }
            >
              {opt}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
