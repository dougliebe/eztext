import { deviationColor, formatPercentile, formatZ } from '../core/metrics';
import type { Stat, StatComparison } from '../core/types';

/** Compact metric cards. Tone drives the accent colour only — never the semantics. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  if (stats.length === 0) return <p className="muted">No metrics produced.</p>;

  return (
    <div className="stat-grid">
      {stats.map((stat) => (
        <div className={`stat stat--${stat.tone ?? 'neutral'}`} key={stat.id}>
          <span className="stat__label" title={stat.label}>
            {stat.label}
          </span>
          <span className="stat__value">
            {stat.value}
            {stat.comparison && <ComparisonChip comparison={stat.comparison} />}
          </span>
          {stat.hint !== undefined && (
            <span className="stat__hint" title={String(stat.hint)}>
              {stat.hint}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Percentile beside a stat, mirroring the topbar's chips: the ordinal, coloured
 * by its z-score so a row of them can be scanned, and the population figures in
 * the tooltip. Only present where a tool actually has something to compare to.
 */
function ComparisonChip({ comparison }: { comparison: StatComparison }) {
  return (
    <span
      className="stat__chip"
      style={{ color: deviationColor(comparison.z) }}
      title={`${formatPercentile(comparison.percentile)} percentile\n${comparison.description} → z-score ${formatZ(comparison.z)}`}
    >
      {formatPercentile(comparison.percentile)}
    </span>
  );
}
