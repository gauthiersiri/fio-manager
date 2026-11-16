import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MultiOption {
  value: string;
  label: string;
}

/** Popover with a checkbox list; `selected` holds option values. */
export function MultiSelect({
  id,
  options,
  selected,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  options: MultiOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const text = selected.length ? `${selected.length} selected` : placeholder;
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        id={id}
        disabled={disabled}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border bg-card px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
          !selected.length && 'text-muted-foreground',
        )}
      >
        <span className="truncate">{text}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 max-h-72 w-(--radix-popover-trigger-width) overflow-auto rounded-md border bg-card p-1 shadow-md"
        >
          {options.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing to select</p>}
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
              <CheckboxPrimitive.Root
                checked={selected.includes(o.value)}
                onCheckedChange={() => toggle(o.value)}
                className="flex size-4 shrink-0 items-center justify-center rounded border bg-card data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
              >
                <CheckboxPrimitive.Indicator>
                  <Check className="size-3" />
                </CheckboxPrimitive.Indicator>
              </CheckboxPrimitive.Root>
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
