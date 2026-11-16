import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  api,
  type AccessMode,
  type IoEngine,
  type Preset,
  type RunSpec,
  type RwMode,
  type StorageClass,
  isActive,
} from '../api';
import { hasMix } from '../format';

const RW_MODES: RwMode[] = ['read', 'write', 'randread', 'randwrite', 'rw', 'randrw'];
const ACCESS_MODES: AccessMode[] = ['ReadWriteOnce', 'ReadWriteMany', 'ReadWriteOncePod'];
const ENGINES: IoEngine[] = ['libaio', 'psync', 'sync'];

interface FormState {
  name: string;
  storage_class: string;
  pvc_size_gi: string;
  access_mode: AccessMode;
  preset: string;
  rw: RwMode;
  rwmixread: string;
  bs: string;
  iodepth: string;
  numjobs: string;
  ioengine: IoEngine;
  direct: boolean;
  file_size_gi: string;
  runtime_s: string;
  ramp_time_s: string;
}

const DEFAULTS: FormState = {
  name: '',
  storage_class: '',
  pvc_size_gi: '50',
  access_mode: 'ReadWriteOnce',
  preset: 'custom',
  rw: 'randrw',
  rwmixread: '70',
  bs: '4k',
  iodepth: '32',
  numjobs: '4',
  ioengine: 'libaio',
  direct: true,
  file_size_gi: '5',
  runtime_s: '120',
  ramp_time_s: '5',
};

const fromSpec = (s: RunSpec): FormState => ({
  name: s.name,
  storage_class: s.storage_class,
  pvc_size_gi: String(s.pvc_size_gi),
  access_mode: s.access_mode,
  preset: s.profile.preset || 'custom',
  rw: s.profile.rw,
  rwmixread: String(s.profile.rwmixread),
  bs: s.profile.bs,
  iodepth: String(s.profile.iodepth),
  numjobs: String(s.profile.numjobs),
  ioengine: s.profile.ioengine,
  direct: s.profile.direct,
  file_size_gi: String(s.file_size_gi),
  runtime_s: String(s.runtime_s),
  ramp_time_s: String(s.ramp_time_s),
});

const GRID = 'grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-6';

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const isInt = (n: number) => Number.isInteger(n);

type Errors = Partial<Record<keyof FormState | 'combo', string>>;

function validate(f: FormState): Errors {
  const e: Errors = {};
  const name = f.name.trim();
  if (name.length < 1 || name.length > 63) e.name = 'Name must be 1-63 characters';
  if (!f.storage_class) e.storage_class = 'Select a storage class';
  const pvc = num(f.pvc_size_gi);
  if (!isInt(pvc) || pvc < 1 || pvc > 10000) e.pvc_size_gi = 'Integer between 1 and 10000';
  if (hasMix(f.rw)) {
    const m = num(f.rwmixread);
    if (!isInt(m) || m < 0 || m > 100) e.rwmixread = 'Integer between 0 and 100';
  }
  if (!/^[0-9]+[kKmM]$/.test(f.bs)) e.bs = 'Format: number + k or m (e.g. 4k, 1m)';
  const qd = num(f.iodepth);
  if (!isInt(qd) || qd < 1 || qd > 256) e.iodepth = 'Integer between 1 and 256';
  const nj = num(f.numjobs);
  if (!isInt(nj) || nj < 1 || nj > 64) e.numjobs = 'Integer between 1 and 64';
  const fs = num(f.file_size_gi);
  if (!isFinite(fs) || fs <= 0) e.file_size_gi = 'Must be greater than 0';
  const rt = num(f.runtime_s);
  if (!isInt(rt) || rt < 5 || rt > 86400) e.runtime_s = 'Integer between 5 and 86400';
  const rp = num(f.ramp_time_s);
  if (!isInt(rp) || rp < 0 || rp > 3600) e.ramp_time_s = 'Integer between 0 and 3600';
  if (!e.file_size_gi && !e.numjobs && !e.pvc_size_gi && fs * nj > 0.9 * pvc + 1e-9) {
    e.combo = `File size per job × jobs (${+(fs * nj).toFixed(3)} GiB) must be ≤ 90% of PVC size (${+(0.9 * pvc).toFixed(3)} GiB)`;
  }
  return e;
}

function toSpec(f: FormState): RunSpec {
  return {
    name: f.name.trim(),
    storage_class: f.storage_class,
    pvc_size_gi: Number(f.pvc_size_gi),
    access_mode: f.access_mode,
    volume_mode: 'Filesystem',
    profile: {
      preset: f.preset,
      rw: f.rw,
      rwmixread: hasMix(f.rw) ? Number(f.rwmixread) : 50,
      bs: f.bs,
      iodepth: Number(f.iodepth),
      numjobs: Number(f.numjobs),
      ioengine: f.ioengine,
      direct: f.direct,
    },
    file_size_gi: Number(f.file_size_gi),
    runtime_s: Number(f.runtime_s),
    ramp_time_s: Number(f.ramp_time_s),
  };
}

export default function RunFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const editing = !!id;

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [classes, setClasses] = useState<StorageClass[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [serverError, setServerError] = useState<string>((location.state as { error?: string } | null)?.error ?? '');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [sc, pr, run] = await Promise.all([
          api.storageClasses().catch((e: Error) => {
            setLoadError(`Could not load storage classes: ${e.message}`);
            return [] as StorageClass[];
          }),
          api.presets().catch(() => [] as Preset[]),
          editing ? api.getRun(id!) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setClasses(sc);
        setPresets(pr);
        if (run) {
          setBlocked(isActive(run.state));
          setForm(fromSpec(run.spec));
        } else {
          const def = sc.find((c) => c.is_default) ?? sc[0];
          setForm((f) => ({ ...f, storage_class: def?.name ?? '' }));
        }
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, editing]);

  const errors = useMemo(() => validate(form), [form]);
  const valid = Object.keys(errors).length === 0;
  const show = (k: keyof Errors) => (touched ? errors[k] : undefined);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  // editing a profile field turns the preset into "custom"
  const setProfile = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v, preset: 'custom' }));

  const applyPreset = (pid: string) => {
    const p = presets.find((x) => x.id === pid);
    if (!p) {
      set('preset', 'custom');
      return;
    }
    setForm((f) => ({
      ...f,
      preset: p.id,
      rw: p.profile.rw,
      rwmixread: String(p.profile.rwmixread),
      bs: p.profile.bs,
      iodepth: String(p.profile.iodepth),
      numjobs: String(p.profile.numjobs),
      ioengine: p.profile.ioengine,
      direct: p.profile.direct,
    }));
  };

  const scItems = useMemo(() => {
    const items = [...classes];
    if (form.storage_class && !items.some((c) => c.name === form.storage_class)) {
      items.push({
        name: form.storage_class,
        provisioner: '',
        is_default: false,
        allow_volume_expansion: false,
        volume_binding_mode: '',
      });
    }
    return items;
  }, [classes, form.storage_class]);

  const submit = async (start: boolean) => {
    setTouched(true);
    setServerError('');
    if (!valid) return;
    setSaving(true);
    let savedId: string | undefined;
    try {
      const spec = toSpec(form);
      const run = editing ? await api.updateRun(id!, spec) : await api.createRun(spec);
      savedId = run.id;
      if (start) await api.startRun(run.id);
      navigate(`/runs/${run.id}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (savedId && !editing) {
        navigate(`/runs/${savedId}/edit`, { replace: true, state: { error: `Run saved but could not be started: ${msg}` } });
      } else {
        setServerError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton lines={8} />;

  const mix = hasMix(form.rw);
  const disabled = saving || blocked;
  const numProps = (k: keyof Errors) => ({ 'aria-invalid': !!show(k) });

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">{editing ? 'Edit run' : 'New run'}</h1>
      {loadError && <Alert kind="error" title="Error">{loadError}</Alert>}
      {blocked && (
        <Alert kind="warning" title="Run is active">
          Provisioning or running runs cannot be edited. Stop the run first.
        </Alert>
      )}
      {serverError && (
        <Alert kind="error" title="Server error" onClose={() => setServerError('')}>
          {serverError}
        </Alert>
      )}
      {touched && errors.combo && <Alert kind="error" title="Invalid sizing">{errors.combo}</Alert>}

      <section className="mb-8">
        <h3 className="mb-4 text-lg font-semibold">Volume</h3>
        <div className={GRID}>
          <Field id="name" label="Name" error={show('name')}>
            <Input id="name" value={form.name} maxLength={63} {...numProps('name')} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="storage_class" label="Storage class" error={show('storage_class')}>
            <NativeSelect
              id="storage_class"
              value={form.storage_class}
              {...numProps('storage_class')}
              onChange={(e) => set('storage_class', e.target.value)}
            >
              <option value="">Select a storage class</option>
              {scItems.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.is_default ? ' (default)' : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="pvc_size_gi" label="PVC size (GiB)" error={show('pvc_size_gi')}>
            <Input
              id="pvc_size_gi"
              type="number"
              value={form.pvc_size_gi}
              min={1}
              max={10000}
              {...numProps('pvc_size_gi')}
              onChange={(e) => set('pvc_size_gi', e.target.value)}
            />
          </Field>
          <Field id="access_mode" label="Access mode">
            <NativeSelect id="access_mode" value={form.access_mode} onChange={(e) => set('access_mode', e.target.value as AccessMode)}>
              {ACCESS_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="volume_mode" label="Volume mode" helper="Block mode not yet supported">
            <NativeSelect id="volume_mode" value="Filesystem" disabled onChange={() => undefined}>
              <option value="Filesystem">Filesystem</option>
            </NativeSelect>
          </Field>
        </div>
      </section>

      <section className="mb-8">
        <h3 className="mb-4 text-lg font-semibold">Workload</h3>
        <div className={GRID}>
          <Field id="preset" label="Preset">
            <NativeSelect id="preset" value={form.preset} onChange={(e) => applyPreset(e.target.value)}>
              <option value="custom">Custom</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rw" label="Read/write pattern (rw)">
            <NativeSelect id="rw" value={form.rw} onChange={(e) => setProfile('rw', e.target.value as RwMode)}>
              {RW_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {mix && (
            <Field id="rwmixread" label="Read mix (rwmixread, %)" error={show('rwmixread')}>
              <Input
                id="rwmixread"
                type="number"
                value={form.rwmixread}
                min={0}
                max={100}
                {...numProps('rwmixread')}
                onChange={(e) => setProfile('rwmixread', e.target.value)}
              />
            </Field>
          )}
          <Field id="bs" label="Block size (bs)" helper="e.g. 4k, 64k, 1m" error={show('bs')}>
            <Input id="bs" value={form.bs} {...numProps('bs')} onChange={(e) => setProfile('bs', e.target.value)} />
          </Field>
          <Field id="iodepth" label="IO depth (1-256)" error={show('iodepth')}>
            <Input
              id="iodepth"
              type="number"
              value={form.iodepth}
              min={1}
              max={256}
              {...numProps('iodepth')}
              onChange={(e) => setProfile('iodepth', e.target.value)}
            />
          </Field>
          <Field id="numjobs" label="Jobs (numjobs, 1-64)" error={show('numjobs')}>
            <Input
              id="numjobs"
              type="number"
              value={form.numjobs}
              min={1}
              max={64}
              {...numProps('numjobs')}
              onChange={(e) => setProfile('numjobs', e.target.value)}
            />
          </Field>
          <Field id="ioengine" label="IO engine">
            <NativeSelect id="ioengine" value={form.ioengine} onChange={(e) => setProfile('ioengine', e.target.value as IoEngine)}>
              {ENGINES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="direct" label="Direct IO (O_DIRECT)">
            <div className="flex h-9 items-center gap-2 text-sm">
              <Switch id="direct" checked={form.direct} onCheckedChange={(v) => setProfile('direct', v)} />
              {form.direct ? 'On' : 'Off'}
            </div>
          </Field>
        </div>
      </section>

      <section className="mb-8">
        <h3 className="mb-4 text-lg font-semibold">Sizing and duration</h3>
        <div className={GRID}>
          <Field
            id="file_size_gi"
            label="File size per job (GiB)"
            helper="file size × jobs must be ≤ 90% of PVC size"
            error={show('file_size_gi')}
          >
            <Input
              id="file_size_gi"
              type="number"
              value={form.file_size_gi}
              min={0}
              step="any"
              {...numProps('file_size_gi')}
              onChange={(e) => set('file_size_gi', e.target.value)}
            />
          </Field>
          <Field id="runtime_s" label="Runtime (s)" error={show('runtime_s')}>
            <Input
              id="runtime_s"
              type="number"
              value={form.runtime_s}
              min={5}
              max={86400}
              {...numProps('runtime_s')}
              onChange={(e) => set('runtime_s', e.target.value)}
            />
          </Field>
          <Field id="ramp_time_s" label="Ramp time (s)" error={show('ramp_time_s')}>
            <Input
              id="ramp_time_s"
              type="number"
              value={form.ramp_time_s}
              min={0}
              max={3600}
              {...numProps('ramp_time_s')}
              onChange={(e) => set('ramp_time_s', e.target.value)}
            />
          </Field>
        </div>
      </section>

      <div className="mt-6 flex gap-3">
        <Button disabled={disabled} onClick={() => submit(false)}>
          Save
        </Button>
        <Button variant="secondary" disabled={disabled} onClick={() => submit(true)}>
          Save and start
        </Button>
        <Button variant="ghost" disabled={saving} onClick={() => navigate(editing ? `/runs/${id}` : '/')}>
          Cancel
        </Button>
      </div>
    </>
  );
}
