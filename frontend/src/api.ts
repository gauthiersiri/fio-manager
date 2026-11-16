// Typed client for the FIO Manager REST API (see docs/api.md). Relative URLs only.

export type RunState = 'draft' | 'provisioning' | 'running' | 'succeeded' | 'failed' | 'stopped';
export type AccessMode = 'ReadWriteOnce' | 'ReadWriteMany' | 'ReadWriteOncePod';
export type RwMode = 'read' | 'write' | 'randread' | 'randwrite' | 'rw' | 'randrw';
export type IoEngine = 'libaio' | 'psync' | 'sync';

export interface Profile {
  preset?: string | null;
  rw: RwMode;
  rwmixread: number;
  bs: string;
  iodepth: number;
  numjobs: number;
  ioengine: IoEngine;
  direct: boolean;
}

export interface RunSpec {
  name: string;
  storage_class: string;
  pvc_size_gi: number;
  access_mode: AccessMode;
  volume_mode: 'Filesystem';
  profile: Profile;
  file_size_gi: number;
  runtime_s: number;
  ramp_time_s: number;
}

export interface DirectionSummary {
  iops: number;
  bw_mibs: number;
  io_mib: number;
  lat_mean_us: number;
  lat_p50_us: number;
  lat_p90_us: number;
  lat_p95_us: number;
  lat_p99_us: number;
  lat_p99_9_us: number;
}

export interface Summary {
  runtime_s: number;
  cpu_usr: number;
  cpu_sys: number;
  read: DirectionSummary | null;
  write: DirectionSummary | null;
}

export interface Run {
  id: string;
  name: string;
  state: RunState;
  message: string;
  spec: RunSpec;
  attempt: number;
  pvc_name: string;
  job_name: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  has_results: boolean;
  summary: Summary | null;
}

export interface StorageClass {
  name: string;
  provisioner: string;
  is_default: boolean;
  allow_volume_expansion: boolean;
  volume_binding_mode: string;
}

export interface Preset {
  id: string;
  label: string;
  profile: Omit<Profile, 'preset'>;
}

export interface DirectionSeries {
  iops: (number | null)[];
  bw_mibs: (number | null)[];
  lat_us: (number | null)[];
}

export interface Metrics {
  time: number[];
  read: DirectionSeries | null;
  write: DirectionSeries | null;
}

export interface CompareItem {
  id: string;
  name: string;
  spec: RunSpec;
  summary: Summary | null;
  metrics: Metrics | null;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (d && typeof d === 'object') {
          const o = d as { loc?: unknown[]; msg?: string };
          const loc = Array.isArray(o.loc) ? o.loc.filter((p) => p !== 'body').join('.') : '';
          return loc ? `${loc}: ${o.msg ?? ''}` : String(o.msg ?? JSON.stringify(d));
        }
        return String(d);
      })
      .join('; ');
  }
  return detail == null ? '' : JSON.stringify(detail);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError(`Network error: ${(e as Error).message}`, 0);
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      const d = formatDetail(body?.detail);
      if (d) msg = d;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(msg, res.status);
  }
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  return (await res.json()) as T;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const enc = encodeURIComponent;

export const api = {
  storageClasses: () => json<StorageClass[]>('/api/storageclasses'),
  presets: () => json<Preset[]>('/api/presets'),
  listRuns: () => json<Run[]>('/api/runs'),
  getRun: (id: string) => json<Run>(`/api/runs/${enc(id)}`),
  createRun: (spec: RunSpec) => json<Run>('/api/runs', jsonInit('POST', spec)),
  updateRun: (id: string, spec: RunSpec) => json<Run>(`/api/runs/${enc(id)}`, jsonInit('PUT', spec)),
  deleteRun: async (id: string) => {
    await request(`/api/runs/${enc(id)}`, { method: 'DELETE' });
  },
  startRun: (id: string) => json<Run>(`/api/runs/${enc(id)}/start`, jsonInit('POST')),
  stopRun: (id: string) => json<Run>(`/api/runs/${enc(id)}/stop`, jsonInit('POST')),
  logs: async (id: string, tail?: number) => {
    const q = tail ? `?tail=${tail}` : '';
    const res = await request(`/api/runs/${enc(id)}/logs${q}`);
    return res.text();
  },
  metrics: (id: string) => json<Metrics | null>(`/api/runs/${enc(id)}/metrics`),
  compare: (ids: string[]) => json<CompareItem[]>(`/api/compare?ids=${ids.map(enc).join(',')}`),
  logsDownloadUrl: (id: string) => `/api/runs/${enc(id)}/logs/download`,
  resultsDownloadUrl: (id: string) => `/api/runs/${enc(id)}/results/download`,
};

export const isActive = (s: RunState) => s === 'provisioning' || s === 'running';
