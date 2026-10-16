import type { ReactNode } from 'react';
import { Check, Circle, Flag, type LucideIcon } from 'lucide-react';
interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}
export function EmptyState({ icon: Icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-5 py-10 text-center">
      <span className="mb-4 flex size-11 items-center justify-center rounded-xl border border-border bg-background text-primary">
        <Icon size={21} strokeWidth={1.6} />
      </span>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
interface PriorityBadgeProps {
  readonly priority: string;
}
export function PriorityBadge({ priority }: PriorityBadgeProps) {
  return (
    <span className={`priority-badge priority-${priority.toLowerCase()}`}>
      <Flag size={10} />
      {priority[0] + priority.slice(1).toLowerCase()}
    </span>
  );
}
interface TaskStatusProps {
  readonly status: string;
}
export function TaskStatus({ status }: TaskStatusProps) {
  const done = status === 'DONE';
  return (
    <span
      title={status.replaceAll('_', ' ')}
      className={`flex size-5 shrink-0 items-center justify-center rounded-full ${done ? 'bg-success/15 text-success' : status === 'IN_PROGRESS' ? 'border-2 border-info text-info' : 'text-muted-foreground/50'}`}
    >
      {done ? <Check size={13} /> : <Circle size={18} />}
    </span>
  );
}
