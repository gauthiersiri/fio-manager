import { useEffect, useRef, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { api, isActive, type Run } from '../api';
import { usePolling } from '../hooks';

const link = 'text-sm text-primary underline-offset-2 hover:underline';

export default function LogViewer({ run }: { run: Run }) {
  const active = isActive(run.state);
  const { data, error } = usePolling(() => api.logs(run.id), active ? 2000 : 0, [run.id, run.attempt]);
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [data, follow]);

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={follow} onCheckedChange={setFollow} aria-label="Follow" />
          Follow
        </label>
        <a className={link} href={api.logsDownloadUrl(run.id)} download>
          Download log
        </a>
        {run.has_results && (
          <a className={link} href={api.resultsDownloadUrl(run.id)} download>
            Download raw results (JSON)
          </a>
        )}
        {error && <span className="text-sm text-muted-foreground">Log refresh failed: {error.message}</span>}
      </div>
      <pre
        ref={ref}
        className="m-0 h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-4 font-mono text-[13px] leading-snug text-slate-100"
      >
        {data ? data : <span className="text-slate-400">No log output yet.</span>}
      </pre>
    </>
  );
}
