import { describe, expect, it } from 'vitest';
import { commentInputSchema, commentUpdateSchema } from '@flowsync/contracts';
describe('comment validation', () => {
  it('rejects blank, oversized text and caller-controlled identity', () => {
    for (const value of [
      { text: ' ' },
      { text: 'x'.repeat(10001) },
      { text: 'Hello', authorId: 'spoofed' },
    ])
      expect(commentInputSchema.safeParse(value).success).toBe(false);
    expect(commentInputSchema.parse({ text: ' Hello ' }).text).toBe('Hello');
  });
  it('requires a nonnegative version before editing', () => {
    expect(commentUpdateSchema.safeParse({ text: 'New text' }).success).toBe(false);
    expect(commentUpdateSchema.safeParse({ text: 'New text', expectedVersion: -1 }).success).toBe(
      false,
    );
    expect(
      commentUpdateSchema.parse({ text: 'New text', expectedVersion: 0 }).expectedVersion,
    ).toBe(0);
  });
});
