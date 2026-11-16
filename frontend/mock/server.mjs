// Throwaway mock of the FIO Manager API (docs/api.md) for UI development. `npm run mock`
import http from 'node:http';

const profile = { rw: 'randrw', rwmixread: 70, bs: '4k', iodepth: 32, numjobs: 4, ioengine: 'libaio', direct: true };
const mkSpec = (name) => ({ name, storage_class: 'ocs-storagecluster-ceph-rbd', pvc_size_gi: 50, access_mode: 'ReadWriteOnce', volume_mode: 'Filesystem', profile: { ...profile, preset: 'custom' }, file_size_gi: 5, runtime_s: 20, ramp_time_s: 0 });
const dir = (k) => ({ iops: 12000 * k, bw_mibs: 46.9 * k, io_mib: 5600, lat_mean_us: 800 / k, lat_p50_us: 700, lat_p90_us: 1200, lat_p95_us: 1500, lat_p99_us: 2500, lat_p99_9_us: 6000 });
const summary = (k) => ({ runtime_s: 20, cpu_usr: 12.3, cpu_sys: 8.1, read: dir(k), write: dir(k / 2) });
const now = () => new Date().toISOString();
const runs = new Map();
let n = 0;
const add = (name, state, done) => {
  const id = `mock${++n}`;
  runs.set(id, { id, name, state, message: state === 'failed' ? 'Pod unschedulable' : '', spec: mkSpec(name), attempt: done ? 1 : 0, pvc_name: `fio-${id}-data`, job_name: `fio-${id}`, created_at: now(), updated_at: now(), started_at: done ? now() : null, finished_at: done ? now() : null, has_results: !!done, summary: done ? summary(done) : null });
  return runs.get(id);
};
add('draft-one', 'draft');
add('done-a', 'succeeded', 1);
add('done-b', 'succeeded', 1.5);
add('broken', 'failed');

const metrics = (k) => {
  const time = Array.from({ length: 20 }, (_, i) => i);
  const ser = (m) => ({ iops: time.map((i) => m * 1000 * k + (i % 5) * 100), bw_mibs: time.map((i) => m * 4 * k + i / 10), lat_us: time.map((i) => (i === 3 ? null : 800 / k + i)) });
  return { time, read: ser(1), write: ser(0.5) };
};

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : null)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;
  if (p === '/api/health') return send(res, 200, { status: 'ok' });
  if (p === '/api/storageclasses') return send(res, 200, [{ name: 'ocs-storagecluster-ceph-rbd', provisioner: 'rbd', is_default: true, allow_volume_expansion: true, volume_binding_mode: 'Immediate' }, { name: 'gp3', provisioner: 'ebs', is_default: false, allow_volume_expansion: true, volume_binding_mode: 'WaitForFirstConsumer' }]);
  if (p === '/api/presets') return send(res, 200, [{ id: 'randrw-70-30-4k', label: 'Random 70/30 4k', profile }, { id: 'seqread-1m', label: 'Sequential read 1m', profile: { ...profile, rw: 'read', rwmixread: 50, bs: '1m', iodepth: 8, numjobs: 1 } }]);
  if (p === '/api/runs' && req.method === 'GET') return send(res, 200, [...runs.values()].reverse());
  if (p === '/api/runs' && req.method === 'POST') {
    const spec = await readBody(req);
    if (!spec.name) return send(res, 422, { detail: [{ loc: ['body', 'name'], msg: 'field required', type: 'missing' }] });
    const r = add(spec.name, 'draft'); r.spec = spec;
    return send(res, 201, r);
  }
  if (p === '/api/compare') {
    const ids = (url.searchParams.get('ids') || '').split(',');
    return send(res, 200, ids.filter((i) => runs.has(i)).map((i, x) => ({ id: i, name: runs.get(i).name, spec: runs.get(i).spec, summary: runs.get(i).summary, metrics: metrics(1 + x / 2) })));
  }
  if ((m = p.match(/^\/api\/runs\/([^/]+)(?:\/(\w+)(?:\/(\w+))?)?$/))) {
    const r = runs.get(m[1]);
    if (!r) return send(res, 404, { detail: 'run not found' });
    const [, , sub, sub2] = m;
    const active = r.state === 'provisioning' || r.state === 'running';
    if (!sub) {
      if (req.method === 'GET') return send(res, 200, r);
      if (active) return send(res, 409, { detail: 'run is active' });
      if (req.method === 'PUT') { r.spec = await readBody(req); r.name = r.spec.name; return send(res, 200, r); }
      if (req.method === 'DELETE') { runs.delete(r.id); res.writeHead(204); return res.end(); }
    }
    if (sub === 'start') {
      if (active) return send(res, 409, { detail: 'already active' });
      r.state = 'provisioning'; r.started_at = now(); r.finished_at = null; r.summary = null; r.has_results = false;
      setTimeout(() => (r.state = 'running'), 3000);
      setTimeout(() => { r.state = 'succeeded'; r.finished_at = now(); r.has_results = true; r.summary = summary(1.2); }, 12000);
      return send(res, 200, r);
    }
    if (sub === 'stop') { if (!active) return send(res, 409, { detail: 'not active' }); r.state = 'stopped'; return send(res, 200, r); }
    if (sub === 'logs' && !sub2) return send(res, 200, `fio log for ${r.name}\n` + 'line\n'.repeat(Math.floor(Date.now() / 1000) % 30), 'text/plain');
    if (sub === 'logs' && sub2 === 'download') return send(res, 200, 'log', 'text/plain');
    if (sub === 'metrics') return send(res, 200, r.has_results || r.state === 'running' ? metrics(1) : null);
    if (sub === 'results') return send(res, 200, { ok: true });
  }
  send(res, 404, { detail: 'not found' });
}).listen(8080, () => console.log('mock API on :8080'));
