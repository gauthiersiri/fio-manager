import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, isActive, type DirectionSummary, type Run } from '../api';
import { usePolling } from '../hooks';
import { fmtDate, fmtLatency, fmtNum, profileSummary, runtimeOf } from '../format';
import StateTag from '../components/StateTag';
import RunActions from '../components/RunActions';
import MetricTile from '../components/Tile';
import LogViewer from '../components/LogViewer';
import { MetricCharts, PercentileChart } from '../components/Charts';

function Overview({ run }: { run: Run }) {
  const s = run.spec;
  const p = s.profile;
  const sum = run.summary;
  const dirs: [string, DirectionSummary | null][] = sum
    ? [
        ['Read', sum.read],
        ['Write', sum.write],
      ]
    : [];
  const total = (f: 'iops' | 'bw_mibs') => (sum ? (sum.read?.[f] ?? 0) + (sum.write?.[f] ?? 0) : null);
  const rows: [string, React.ReactNode][] = [
    ['Run ID', run.id],
    ['Attempt', run.attempt],
    ['Storage class', s.storage_class],
    ['PVC', `${run.pvc_name || '—'} · ${s.pvc_size_gi} GiB · ${s.access_mode} · ${s.volume_mode}`],
    ['Job', run.job_name || '—'],
    ['Profile', `${profileSummary(p)} · ${p.ioengine} · direct=${String(p.direct)}${p.preset ? ` · preset ${p.preset}` : ''}`],
    ['File size per job', `${s.file_size_gi} GiB`],
    ['Runtime / ramp', `${s.runtime_s}s / ${s.ramp_time_s}s (actual ${runtimeOf(run)})`],
    ['Created', fmtDate(run.created_at)],
    ['Started', fmtDate(run.started_at)],
    ['Finished', fmtDate(run.finished_at)],
    ['Updated', fmtDate(run.updated_at)],
  ];
  return (
    <>
      {sum ? (
        <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          <MetricTile label="IOPS (total)" value={fmtNum(total('iops'), 0)} sub={`R ${fmtNum(sum.read?.iops, 0)} · W ${fmtNum(sum.write?.iops, 0)}`} />
          <MetricTile label="Bandwidth (total)" value={`${fmtNum(total('bw_mibs'))} MiB/s`} sub={`R ${fmtNum(sum.read?.bw_mibs)} · W ${fmtNum(sum.write?.bw_mibs)}`} />
          {dirs.map(([label, d]) => (
            <MetricTile
              key={label}
              label={`${label} latency (mean)`}
              value={fmtLatency(d?.lat_mean_us)}
              sub={d ? `p95 ${fmtLatency(d.lat_p95_us)} · p99 ${fmtLatency(d.lat_p99_us)}` : 'no IO'}
            />
          ))}
          <MetricTile label="CPU usr / sys" value={`${fmtNum(sum.cpu_usr)}% / ${fmtNum(sum.cpu_sys)}%`} />
        </div>
      ) : (
        <p className="mb-4 text-muted-foreground">Results are not available yet.</p>
      )}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="m-0">{v}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Graphs({ run }: { run: Run }) {
  const active = isActive(run.state);
  const { data: metrics, loading, error } = usePolling(() => api.metrics(run.id), active ? 3000 : 0, [run.id, run.attempt]);
  if (loading && metrics === undefined) return <Skeleton lines={4} />;
  return (
    <>
      {error && <Alert kind="warning" title="Metrics refresh failed">{error.message}</Alert>}
      {metrics ? (
        <>
          <MetricCharts metrics={metrics} />
          {run.summary && (
            <div className="mt-6">
              <PercentileChart summary={run.summary} />
            </div>
          )}
        </>
      ) : (
        <div className="py-12 text-center text-muted-foreground">No metrics yet. Start the run to see graphs.</div>
      )}
      {!metrics && run.summary && <PercentileChart summary={run.summary} />}
    </>
  );
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const { data: run, error, refresh } = usePolling(
    async () => {
      const r = await api.getRun(id!);
      setActive(isActive(r.state));
      return r;
    },
    active ? 2000 : 0,
    [id],
  );
  const [actionError, setActionError] = useState('');
  const [tab, setTab] = useState('overview');

  if (!run) {
    return error ? <Alert kind="error" title="Failed to load run">{error.message}</Alert> : <Skeleton lines={6} />;
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <RouterLink to="/" className="text-primary hover:underline">
          Runs
        </RouterLink>
      </nav>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{run.name}</h1>
          <StateTag state={run.state} />
        </div>
        <RunActions run={run} onChanged={() => refresh()} onDeleted={() => navigate('/')} onError={setActionError} />
      </div>
      {error && <Alert kind="warning" title="Refresh failed">{error.message}</Alert>}
      {actionError && (
        <Alert kind="error" title="Action failed" onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}
      {run.message && (
        <Alert kind={run.state === 'failed' ? 'error' : 'info'} title={run.state === 'failed' ? 'Failure' : 'Status'}>
          {run.message}
        </Alert>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Run sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="graphs">Graphs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">{tab === 'overview' && <Overview run={run} />}</TabsContent>
        <TabsContent value="logs">{tab === 'logs' && <LogViewer run={run} />}</TabsContent>
        <TabsContent value="graphs">{tab === 'graphs' && <Graphs run={run} />}</TabsContent>
      </Tabs>
    </>
  );
}
