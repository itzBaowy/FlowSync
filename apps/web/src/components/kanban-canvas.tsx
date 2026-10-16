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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { KanbanTaskCard } from './kanban-task-card';
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
      <p className="text-[10px] leading-5 text-muted-foreground">
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
        <div
          className="flex min-w-0 gap-4 overflow-x-auto pb-5"
          tabIndex={0}
          role="region"
          aria-label="Kanban columns"
        >
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
      className={`column-${column.kind.toLowerCase()} w-[292px] shrink-0 space-y-3 rounded-xl border p-3 ${isOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/50'}`}
    >
      <h3 className="flex items-center gap-2 px-1 py-2 text-xs font-semibold">
        <span aria-hidden="true" className="size-2 rounded-full bg-[var(--column-color)]" />
        {column.name}{' '}
        <span className="ml-1 rounded-md bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {column.totalTasks}
        </span>
      </h3>
      <SortableContext
        id={column.id}
        items={column.tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        {column.tasks.map((task) => (
          <KanbanTaskCard key={task.id} task={task} pending={pending} onOpen={onOpen} />
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
