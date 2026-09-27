import type { Stat } from '../core/types';

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
          <span className="stat__value">{stat.value}</span>
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
