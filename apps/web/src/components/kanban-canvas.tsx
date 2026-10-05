'use client';
import { useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { BoardSnapshot, Task } from '@flowsync/contracts';
import { useKanbanMove } from '@/lib/kanban';
import { Button } from './ui/button';
import { Notice } from './organization-ui';
const collisions: CollisionDetection = (args) => {
  const pointed = pointerWithin(args);
  if (pointed.length) {
    const tasks = pointed.filter(
      (collision) =>
        args.droppableContainers.find((container) => container.id === collision.id)?.data.current
          ?.type === 'task',
    );
    return tasks.length ? tasks : pointed;
  }
  return closestCorners(args);
};
export function KanbanCanvas({
  board,
  onOpen,
  onBrowse,
}: {
  board: BoardSnapshot;
  onOpen: (id: string) => void;
  onBrowse: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: 'auto',
    }),
  );
  const move = useKanbanMove(board.id);
  const [dragging, setDragging] = useState<Task | null>(null);
  const original = useRef<BoardSnapshot | null>(null);
  function drop(event: DragEndEvent) {
    const snapshot = original.current;
    const task = dragging;
    setDragging(null);
    original.current = null;
    if (!snapshot || !task || !event.over || event.over.id === task.id || move.isPending) return;
    const target = snapshot.columns.find(
      (column) =>
        column.id === event.over!.id || column.tasks.some((row) => row.id === event.over!.id),
    );
    if (!target) return;
    const targetRows = target.tasks.filter((row) => row.id !== task.id);
    const overIndex = targetRows.findIndex((row) => row.id === event.over!.id);
    let beforeTaskId = overIndex < 0 ? null : targetRows[overIndex]!.id;
    if (target.id === task.columnId && overIndex >= 0) {
      const previousIndex = target.tasks.findIndex((row) => row.id === task.id);
      const originalOver = target.tasks.findIndex((row) => row.id === event.over!.id);
      if (previousIndex < originalOver) beforeTaskId = targetRows[overIndex + 1]?.id ?? null;
    }
    move.mutate({
      task,
      body: {
        columnId: target.id,
        beforeTaskId,
        expectedVersion: task.version,
        expectedRevision: snapshot.revision,
      },
    });
  }
  const targetName = (id: string | number) =>
    board.columns.find((column) => column.id === id)?.name ??
    board.columns.flatMap((column) => column.tasks).find((task) => task.id === id)?.title ??
    'board';
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Drag the task handle to reorder or change columns. Keyboard: Space to pick up, arrow keys to
        move, Space to drop, Escape to cancel.
      </p>
      <Notice error={move.error} />
      {move.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          Saving move...
        </p>
      )}
      <DndContext
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${targetName(active.id)}.`,
            onDragOver: ({ active, over }) =>
              over ? `${targetName(active.id)} over ${targetName(over.id)}.` : 'Outside the board.',
            onDragEnd: ({ active, over }) =>
              `Dropped ${targetName(active.id)}${over ? ` in ${targetName(over.id)}` : ''}.`,
            onDragCancel: () => 'Move cancelled.',
          },
        }}
        sensors={sensors}
        collisionDetection={collisions}
        onDragStart={({ active }) => {
          const task = board.columns
            .flatMap((column) => column.tasks)
            .find((row) => row.id === active.id);
          if (task) {
            original.current = board;
            setDragging(task);
          }
        }}
        onDragCancel={() => {
          setDragging(null);
          original.current = null;
        }}
        onDragEnd={drop}
      >
        <div className="flex min-w-0 gap-4 overflow-x-auto pb-5" aria-label="Kanban columns">
          {board.columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              pending={move.isPending}
              onOpen={onOpen}
              onBrowse={onBrowse}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="w-64 rounded-lg border border-primary bg-card p-4 text-sm font-medium shadow-xl">
              {dragging.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
function KanbanColumn({
  column,
  pending,
  onOpen,
  onBrowse,
}: {
  column: BoardSnapshot['columns'][number];
  pending: boolean;
  onOpen: (id: string) => void;
  onBrowse: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column' },
    disabled: pending,
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={column.name}
      className={`w-72 shrink-0 space-y-3 rounded-xl border p-3 ${isOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'}`}
    >
      <h3 className="font-semibold">
        {column.name} <span className="text-xs text-muted-foreground">{column.totalTasks}</span>
      </h3>
      <SortableContext
        id={column.id}
        items={column.tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        {column.tasks.map((task) => (
          <TaskCard key={task.id} task={task} pending={pending} onOpen={onOpen} />
        ))}
      </SortableContext>
      {column.tasks.length === 0 && (
        <p className="min-h-32 py-8 text-center text-xs text-muted-foreground">
          No tasks yet. Drop a task here.
        </p>
      )}
      {column.totalTasks > column.tasks.length && (
        <Button variant="outline" size="sm" onClick={() => onBrowse(column.id)}>
          Browse all {column.totalTasks} tasks
        </Button>
      )}
    </section>
  );
}
function TaskCard({
  task,
  pending,
  onOpen,
}: {
  task: Task;
  pending: boolean;
  onOpen: (id: string) => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task' },
    disabled: pending || !task.canEdit,
  });
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      className="rounded-lg border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${task.title}`}
          disabled={pending || !task.canEdit}
          className="touch-none rounded p-1 text-muted-foreground focus-visible:outline-primary disabled:opacity-30"
        >
          <GripVertical size={16} />
        </button>
        <button
          onClick={() => onOpen(task.id)}
          className="min-w-0 flex-1 break-words text-left text-sm font-medium hover:text-primary"
        >
          {task.title}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {task.priority}
        {task.dueDate ? ` / Due ${task.dueDate.slice(0, 10)}` : ''}
      </p>
      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span
              key={label.id}
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px]"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
              {label.name}
            </span>
          ))}
        </div>
      )}
      {task.assignees.length > 0 && (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {task.assignees.map((user) => user.name).join(', ')}
        </p>
      )}
    </article>
  );
}
