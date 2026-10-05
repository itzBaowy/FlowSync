import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
const payloadSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    email: z.string().email(),
    organizationName: z.string().max(120),
    inviterName: z.string().max(80),
  })
  .strict();
export type InvitationPayload = z.infer<typeof payloadSchema>;
export function encryptInvitation(payload: InvitationPayload, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payloadSchema.parse(payload)), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}
export function decryptInvitation(value: string, key: string): InvitationPayload {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid invitation envelope');
  const [iv, tag, payload] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv!);
  decipher.setAuthTag(tag!);
  const text = Buffer.concat([decipher.update(payload!), decipher.final()]).toString('utf8');
  return payloadSchema.parse(JSON.parse(text) as unknown);
}
