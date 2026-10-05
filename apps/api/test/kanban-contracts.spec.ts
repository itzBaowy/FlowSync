import { describe, it, expect } from 'vitest';
import {
  taskInputSchema,
  taskUpdateSchema,
  taskMoveSchema,
  reorderColumnsSchema,
} from '@flowsync/contracts';
const id = '00000000-0000-4000-8000-000000000001';
describe('Kanban mutation contracts', () => {
  it('rejects client positions, missing versions and duplicated assignments', () => {
    expect(taskInputSchema.safeParse({ columnId: id, title: 'Task', position: 123 }).success).toBe(
      false,
    );
    expect(
      taskInputSchema.safeParse({ columnId: id, title: 'Task', assigneeIds: [id, id] }).success,
    ).toBe(false);
    expect(taskUpdateSchema.safeParse({ title: 'Edit' }).success).toBe(false);
    expect(taskUpdateSchema.parse({ title: 'Edit', expectedVersion: 0 })).toEqual({
      title: 'Edit',
      expectedVersion: 0,
    });
  });
  it('requires both move preconditions and a complete unique column order', () => {
    expect(taskMoveSchema.safeParse({ columnId: id, expectedVersion: 0 }).success).toBe(false);
    expect(
      reorderColumnsSchema.safeParse({ columnIds: [id, id], expectedRevision: 0 }).success,
    ).toBe(false);
  });
});
