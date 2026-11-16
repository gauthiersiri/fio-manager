import type { Profile, Run, RunSpec, RunState } from './api';

export const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString();
};

export const fmtDuration = (seconds: number | null | undefined) => {
  if (seconds == null || !isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${m}m ${r}s`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
};

export const runtimeOf = (run: Run): string => {
  if (run.summary?.runtime_s != null) return fmtDuration(run.summary.runtime_s);
  if (run.started_at) {
    const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
    return fmtDuration((end - new Date(run.started_at).getTime()) / 1000);
  }
  return '—';
};

export const fmtNum = (n: number | null | undefined, digits = 1) =>
  n == null || !isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits });

export const fmtLatency = (us: number | null | undefined) => {
  if (us == null || !isFinite(us)) return '—';
  if (us >= 1000) return `${(us / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ms`;
  return `${us.toLocaleString(undefined, { maximumFractionDigits: 1 })} µs`;
};

export const hasMix = (rw: string) => rw === 'rw' || rw === 'randrw';

export const profileSummary = (p: Profile): string => {
  const mix = hasMix(p.rw) ? ` ${p.rwmixread}/${100 - p.rwmixread}` : '';
  return `${p.rw}${mix} ${p.bs} qd${p.iodepth} x${p.numjobs}`;
};

export const specSummary = (s: RunSpec) => `${s.storage_class} · ${s.pvc_size_gi} GiB · ${profileSummary(s.profile)}`;

export const STATE_TONE: Record<RunState, 'gray' | 'blue' | 'cyan' | 'green' | 'red' | 'purple'> = {
  draft: 'gray',
  provisioning: 'blue',
  running: 'cyan',
  succeeded: 'green',
  failed: 'red',
  stopped: 'purple',
};

export const canStart = (s: RunState) => !(s === 'provisioning' || s === 'running');
export const canStop = (s: RunState) => s === 'provisioning' || s === 'running';
export const canEditDelete = canStart;
