import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { MultiSelect } from '@/components/ui/multi-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, type CompareItem, type Run } from '../api';
import { usePolling } from '../hooks';
import { fmtLatency, fmtNum, profileSummary } from '../format';
import { CompareCharts, runLabels } from '../components/Charts';

const HEADERS = ['Run', 'Storage class', 'Profile', 'IOPS (R/W)', 'Bandwidth MiB/s (R/W)', 'Mean lat R', 'Mean lat W', 'p99 R', 'p99 W'];

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const ids = useMemo(() => (params.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean), [params]);
  const idsKey = ids.join(',');
  const { data: runs, error: runsError } = usePolling(() => api.listRuns(), 0);
  const [items, setItems] = useState<CompareItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const eligible: Run[] = useMemo(() => (runs ?? []).filter((r) => r.has_results), [runs]);

  useEffect(() => {
    if (!idsKey) {
      setItems([]);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .compare(idsKey.split(','))
      .then((d) => {
        if (!cancelled) {
          setItems(d);
          setError('');
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const labels = runLabels(items);

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Compare runs</h1>
      {runsError && <Alert kind="error" title="Failed to load runs">{runsError.message}</Alert>}
      <div className="mb-4 max-w-xl">
        <label htmlFor="compare-runs" className="mb-1.5 block text-sm font-medium">
          Runs with results
        </label>
        <MultiSelect
          id="compare-runs"
          placeholder={eligible.length ? 'Select runs to compare' : 'No runs with results'}
          options={eligible.map((r) => ({ value: r.id, label: `${r.name} (${r.id})` }))}
          selected={ids.filter((id) => eligible.some((r) => r.id === id))}
          onChange={(next) => (next.length ? setParams({ ids: next.join(',') }) : setParams({}))}
        />
      </div>
      {error && <Alert kind="error" title="Compare failed">{error}</Alert>}
      {loading && !items.length && <Skeleton lines={4} />}
      {!ids.length && <div className="py-12 text-center text-muted-foreground">Select two or more runs to compare.</div>}
      {ids.length > 0 && items.length > 0 && (
        <>
          <CompareCharts items={items} />
          <h3 className="mb-4 mt-8 text-lg font-semibold">Summary</h3>
          <Table>
            <TableHeader>
              <TableRow>
                {HEADERS.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it, i) => {
                const s = it.summary;
                return (
                  <TableRow key={it.id}>
                    <TableCell>{labels[i]}</TableCell>
                    <TableCell>{it.spec.storage_class}</TableCell>
                    <TableCell>{profileSummary(it.spec.profile)}</TableCell>
                    <TableCell>{s ? `${fmtNum(s.read?.iops, 0)} / ${fmtNum(s.write?.iops, 0)}` : '—'}</TableCell>
                    <TableCell>{s ? `${fmtNum(s.read?.bw_mibs)} / ${fmtNum(s.write?.bw_mibs)}` : '—'}</TableCell>
                    <TableCell>{fmtLatency(s?.read?.lat_mean_us)}</TableCell>
                    <TableCell>{fmtLatency(s?.write?.lat_mean_us)}</TableCell>
                    <TableCell>{fmtLatency(s?.read?.lat_p99_us)}</TableCell>
                    <TableCell>{fmtLatency(s?.write?.lat_p99_us)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </>
  );
}
