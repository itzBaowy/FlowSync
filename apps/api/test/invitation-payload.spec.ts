import { expect, it } from 'vitest';
import { decryptInvitation, encryptInvitation } from '../src/modules/queue/invitation-payload';
it('encrypts delivery tokens with authenticated encryption and rejects tampering', () => {
  const key = 'ab'.repeat(32);
  const input = {
    token: 'c'.repeat(64),
    email: 'invited@example.com',
    organizationName: 'Acme',
    inviterName: 'Owner',
  };
  const encrypted = encryptInvitation(input, key);
  expect(encrypted).not.toContain(input.token);
  expect(encrypted).not.toContain(input.email);
  expect(decryptInvitation(encrypted, key)).toEqual(input);
  expect(() => decryptInvitation(encrypted, 'cd'.repeat(32))).toThrow();
  const pieces = encrypted.split('.');
  pieces[2] = `AA${pieces[2]!.slice(2)}`;
  expect(() => decryptInvitation(pieces.join('.'), key)).toThrow();
});
