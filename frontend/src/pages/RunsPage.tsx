import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, type Run } from '../api';
import { usePolling } from '../hooks';
import { fmtDate, profileSummary, runtimeOf } from '../format';
import StateTag from '../components/StateTag';
import RunActions from '../components/RunActions';

const HEADERS = ['Name', 'State', 'Storage class', 'PVC size', 'Profile', 'Runtime', 'Created', 'Finished', ''];

export default function RunsPage() {
  const navigate = useNavigate();
  const { data, error, loading, refresh } = usePolling(() => api.listRuns(), 3000);
  const [actionError, setActionError] = useState('');
  const runs: Run[] = data ?? [];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Runs</h1>
        <Button onClick={() => navigate('/runs/new')}>
          <Plus /> New run
        </Button>
      </div>
      {error && !data && <Alert kind="error" title="Failed to load runs">{error.message}</Alert>}
      {error && data && <Alert kind="warning" title="Refresh failed">{error.message}</Alert>}
      {actionError && (
        <Alert kind="error" title="Action failed" onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}
      {loading && !data ? (
        <Skeleton lines={5} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {HEADERS.map((h, i) => (
                <TableHead key={i}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={HEADERS.length} className="py-12 text-center text-muted-foreground">
                  No runs yet. Create one with “New run”.
                </TableCell>
              </TableRow>
            )}
            {runs.map((r) => (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/runs/${r.id}`)}>
                <TableCell className="font-semibold">{r.name}</TableCell>
                <TableCell>
                  <StateTag state={r.state} />
                </TableCell>
                <TableCell>{r.spec.storage_class}</TableCell>
                <TableCell>{r.spec.pvc_size_gi} GiB</TableCell>
                <TableCell>{profileSummary(r.spec.profile)}</TableCell>
                <TableCell>{runtimeOf(r)}</TableCell>
                <TableCell>{fmtDate(r.created_at)}</TableCell>
                <TableCell>{fmtDate(r.finished_at)}</TableCell>
                <TableCell>
                  <RunActions run={r} onChanged={() => refresh()} onError={setActionError} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
