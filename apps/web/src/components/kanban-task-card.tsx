'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, GripVertical } from 'lucide-react';
import type { Task } from '@flowsync/contracts';
import { PriorityBadge } from './workspace-ui';
interface KanbanTaskCardProps {
  readonly task: Task;
  readonly pending: boolean;
  readonly onOpen: (id: string) => void;
}
export function KanbanTaskCard({ task, pending, onOpen }: KanbanTaskCardProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: 'task' }, disabled: pending || !task.canEdit });
  const overdue = task.status !== 'DONE' && task.dueDate && new Date(task.dueDate) < new Date();
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      className="group rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5">
          {task.labels.length ? (
            task.labels.map((label) => (
              <span
                key={label.id}
                className="flex max-w-full items-center gap-1.5 rounded bg-muted px-2 py-1 text-[9px] font-medium text-muted-foreground"
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="truncate">{label.name}</span>
              </span>
            ))
          ) : (
            <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Task
            </span>
          )}
        </div>
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${task.title}`}
          disabled={pending || !task.canEdit}
          className="flex min-h-8 w-7 shrink-0 touch-none items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground focus-visible:outline-primary disabled:opacity-30"
        >
          <GripVertical size={16} />
        </button>
      </div>
      <button
        onClick={() => onOpen(task.id)}
        className="mt-2 block min-h-10 w-full break-words text-left text-[13px] font-medium leading-6 hover:text-primary"
      >
        {task.title}
      </button>
      {task.description && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
          {task.description}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
        <PriorityBadge priority={task.priority} />
        <span
          className={`inline-flex items-center gap-1 text-[10px] ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          <CalendarDays size={11} />
          {task.dueDate
            ? new Date(task.dueDate).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })
            : 'No due date'}
        </span>
      </div>
      {task.assignees.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {task.assignees.slice(0, 3).map((user) => (
              <span
                key={user.id}
                title={user.name}
                className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-primary/10 text-[8px] font-semibold text-primary"
              >
                {user.name
                  .split(' ')
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')}
              </span>
            ))}
          </div>
          <p className="truncate text-[10px] text-muted-foreground">
            {task.assignees.map((user) => user.name).join(', ')}
          </p>
        </div>
      )}
    </article>
  );
}
