import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CompareItem, Metrics, Summary } from '../api';
import { fmtNum } from '../format';

export interface Point {
  group: string;
  time: number;
  value: number;
}

const COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
];

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="h-80">{children}</div>
    </div>
  );
}

/** Long format (group/time/value) to one row per time with a column per group. */
function pivot(data: Point[]): { groups: string[]; rows: Record<string, number>[] } {
  const groups = [...new Set(data.map((p) => p.group))];
  const byTime = new Map<number, Record<string, number>>();
  data.forEach((p) => {
    const row = byTime.get(p.time) ?? { time: p.time };
    row[p.group] = p.value;
    byTime.set(p.time, row);
  });
  return { groups, rows: [...byTime.values()].sort((a, b) => a.time - b.time) };
}

export function TimeLine({ title, data, yTitle }: { title: string; data: Point[]; yTitle: string }) {
  const { groups, rows } = pivot(data);
  return (
    <ChartBox title={title}>
      {rows.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 16, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 12 }}
              label={{ value: 'Time (s)', position: 'insideBottom', offset: -8, fontSize: 12 }}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              width={64}
              tickFormatter={(v: number) => fmtNum(v, 0)}
              label={{ value: yTitle, angle: -90, position: 'insideLeft', fontSize: 12 }}
            />
            <Tooltip
              labelFormatter={(t) => `t = ${t} s`}
              formatter={(v) => (typeof v === 'number' ? fmtNum(v, 2) : String(v))}
            />
            <Legend verticalAlign="top" height={28} />
            {groups.map((g, i) => (
              <Line
                key={g}
                type="monotone"
                dataKey={g}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartBox>
  );
}

type Dir = 'read' | 'write';
const LABEL: Record<Dir, string> = { read: 'Read', write: 'Write' };

export function seriesFrom(m: Metrics, field: 'iops' | 'bw_mibs' | 'lat_us'): Point[] {
  const out: Point[] = [];
  (['read', 'write'] as Dir[]).forEach((d) => {
    const s = m[d];
    if (!s) return;
    const arr = s[field];
    m.time.forEach((t, i) => {
      const v = arr[i];
      if (v != null && isFinite(v)) out.push({ group: LABEL[d], time: t, value: v });
    });
  });
  return out;
}

export function MetricCharts({ metrics }: { metrics: Metrics }) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <TimeLine title="IOPS" yTitle="IOPS" data={seriesFrom(metrics, 'iops')} />
      <TimeLine title="Bandwidth" yTitle="MiB/s" data={seriesFrom(metrics, 'bw_mibs')} />
      <TimeLine title="Mean latency" yTitle="Latency (µs)" data={seriesFrom(metrics, 'lat_us')} />
    </div>
  );
}

export function PercentileChart({ summary }: { summary: Summary }) {
  const keys = ['p50', 'p90', 'p95', 'p99', 'p99.9'];
  const rows: Record<string, number | string>[] = keys.map((key) => ({ key }));
  const groups: string[] = [];
  (['read', 'write'] as Dir[]).forEach((d) => {
    const s = summary[d];
    if (!s) return;
    const vals = [s.lat_p50_us, s.lat_p90_us, s.lat_p95_us, s.lat_p99_us, s.lat_p99_9_us];
    groups.push(LABEL[d]);
    vals.forEach((v, i) => {
      if (v != null) rows[i][LABEL[d]] = v;
    });
  });
  if (!groups.length) return null;
  return (
    <ChartBox title="Final latency percentiles">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 16, bottom: 16, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="key" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            width={64}
            tickFormatter={(v: number) => fmtNum(v, 0)}
            label={{ value: 'Latency (µs)', angle: -90, position: 'insideLeft', fontSize: 12 }}
          />
          <Tooltip formatter={(v) => (typeof v === 'number' ? fmtNum(v, 2) : String(v))} />
          <Legend verticalAlign="top" height={28} />
          {groups.map((g, i) => (
            <Bar key={g} dataKey={g} fill={COLORS[i % COLORS.length]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}

/** Combined (read+write) series for one run, used by the compare page. */
function combined(m: Metrics): { t: number; iops: number | null; bw: number | null; lat: number | null }[] {
  return m.time.map((t, i) => {
    const dirs = [m.read, m.write].filter((x): x is NonNullable<typeof x> => !!x);
    const sum = (f: 'iops' | 'bw_mibs') => {
      const vals = dirs.map((d) => d[f][i]).filter((v): v is number => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    let lat: number | null = null;
    const l = dirs
      .map((d) => ({ lat: d.lat_us[i], w: d.iops[i] ?? 0 }))
      .filter((x): x is { lat: number; w: number } => x.lat != null && isFinite(x.lat));
    if (l.length) {
      const wsum = l.reduce((a, b) => a + b.w, 0);
      lat = wsum > 0 ? l.reduce((a, b) => a + b.lat * b.w, 0) / wsum : l.reduce((a, b) => a + b.lat, 0) / l.length;
    }
    return { t, iops: sum('iops'), bw: sum('bw_mibs'), lat };
  });
}

export function runLabels(items: CompareItem[]): string[] {
  return items.map((it) => (items.filter((x) => x.name === it.name).length > 1 ? `${it.name} (${it.id})` : it.name));
}

export function CompareCharts({ items }: { items: CompareItem[] }) {
  const labels = runLabels(items);
  const iops: Point[] = [];
  const bw: Point[] = [];
  const lat: Point[] = [];
  items.forEach((it, idx) => {
    if (!it.metrics) return;
    combined(it.metrics).forEach((p) => {
      if (p.iops != null) iops.push({ group: labels[idx], time: p.t, value: p.iops });
      if (p.bw != null) bw.push({ group: labels[idx], time: p.t, value: p.bw });
      if (p.lat != null) lat.push({ group: labels[idx], time: p.t, value: p.lat });
    });
  });
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <TimeLine title="Total IOPS" yTitle="IOPS" data={iops} />
      <TimeLine title="Total bandwidth" yTitle="MiB/s" data={bw} />
      <TimeLine title="Mean latency" yTitle="Latency (µs)" data={lat} />
    </div>
  );
}
