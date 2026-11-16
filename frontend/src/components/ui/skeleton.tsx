import { cn } from '@/lib/utils';

export function Skeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-border" style={{ width: `${100 - ((i * 13) % 40)}%` }} />
      ))}
    </div>
  );
}
