import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const alertVariants = cva('mb-4 flex items-start gap-3 rounded-md border p-3 text-sm', {
  variants: {
    kind: {
      error: 'border-red-200 bg-red-50 text-red-900',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
      info: 'border-blue-200 bg-blue-50 text-blue-900',
    },
  },
  defaultVariants: { kind: 'info' },
});

const ICONS = { error: AlertCircle, warning: AlertTriangle, info: Info };

export function Alert({
  kind = 'info',
  title,
  children,
  onClose,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  onClose?: () => void;
  className?: string;
} & VariantProps<typeof alertVariants>) {
  const Icon = ICONS[kind ?? 'info'];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cn(alertVariants({ kind }), className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        {children && <p className="mt-0.5 break-words">{children}</p>}
      </div>
      {onClose && (
        <button type="button" aria-label="Dismiss" onClick={onClose} className="rounded p-0.5 hover:bg-black/5">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
