import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Play, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Tip } from '@/components/ui/tooltip';
import { api, type Run } from '../api';
import { canEditDelete, canStart, canStop } from '../format';

interface Props {
  run: Run;
  onChanged: (run?: Run) => void;
  onDeleted?: () => void;
  onError: (msg: string) => void;
}

export default function RunActions({ run, onChanged, onDeleted, onError }: Props) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const act = async (fn: () => Promise<Run>) => {
    setBusy(true);
    try {
      onChanged(await fn());
    } catch (e) {
      onError((e as Error).message);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.deleteRun(run.id);
      setConfirm(false);
      onDeleted?.();
      onChanged();
    } catch (e) {
      setConfirm(false);
      onError((e as Error).message);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const editable = canEditDelete(run.state);

  return (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Tip label="Start">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Start"
          disabled={busy || !canStart(run.state)}
          onClick={() => act(() => api.startRun(run.id))}
        >
          <Play />
        </Button>
      </Tip>
      <Tip label="Stop">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Stop"
          disabled={busy || !canStop(run.state)}
          onClick={() => act(() => api.stopRun(run.id))}
        >
          <Square />
        </Button>
      </Tip>
      <Tip label="Edit">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Edit"
          disabled={busy || !editable}
          onClick={() => navigate(`/runs/${run.id}/edit`)}
        >
          <Pencil />
        </Button>
      </Tip>
      <Tip label="Delete">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete"
          disabled={busy || !editable}
          onClick={() => setConfirm(true)}
        >
          <Trash2 />
        </Button>
      </Tip>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle>Delete run "{run.name}"?</DialogTitle>
          <DialogDescription>
            This removes the Job, PVC, ConfigMap and stored results of this run. It cannot be undone.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={doDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
