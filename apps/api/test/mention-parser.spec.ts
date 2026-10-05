import { describe, expect, it } from 'vitest';
import { mentionTokens } from '../src/modules/collaboration/mention-parser';
describe('mention token parser', () => {
  it('supports selected IDs, full email, Unicode names and deduplication', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      mentionTokens(`@[Full Name](${id}) @[Full Name](${id}) @JOHN @john @john@example.com @María`),
    ).toEqual({ ids: [id], handles: ['john', 'john@example.com', 'maría'] });
    expect(mentionTokens('ordinary email@example.com')).toEqual({ ids: [], handles: [] });
  });
  it('bounds mention work and rejects malformed selected identities', () => {
    expect(() =>
      mentionTokens(Array.from({ length: 21 }, (_, index) => `@user${index}`).join(' ')),
    ).toThrow('at most 20');
    expect(() => mentionTokens('@[Invalid](------------------------------------)')).toThrow(
      'valid mentions',
    );
  });
});
