import { Badge } from '@/components/ui/badge';
import type { RunState } from '../api';
import { STATE_TONE } from '../format';

export default function StateTag({ state }: { state: RunState }) {
  return <Badge tone={STATE_TONE[state] ?? 'gray'}>{state}</Badge>;
}
