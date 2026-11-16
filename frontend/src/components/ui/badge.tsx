import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      gray: 'bg-slate-100 text-slate-700',
      blue: 'bg-blue-100 text-blue-800',
      cyan: 'bg-cyan-100 text-cyan-800',
      green: 'bg-emerald-100 text-emerald-800',
      red: 'bg-red-100 text-red-800',
      purple: 'bg-violet-100 text-violet-800',
    },
  },
  defaultVariants: { tone: 'gray' },
});

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
