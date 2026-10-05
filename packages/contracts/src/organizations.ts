import { z } from 'zod';
import { emailSchema } from './validation';

export const organizationRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export const organizationInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens'),
    allowAdminInvites: z.boolean().default(true),
  })
  .strict();
export const updateOrganizationSchema = organizationInputSchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Provide at least one field');
export const memberRoleSchema = z.object({ role: z.enum(['ADMIN', 'MEMBER']) }).strict();
export const transferOwnerSchema = z.object({ userId: z.string().uuid() }).strict();
export const invitationInputSchema = z
  .object({ email: emailSchema, role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER') })
  .strict();
export const invitationTokenSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  ownerId: z.string().uuid(),
  allowAdminInvites: z.boolean(),
  logoUrl: z.string().nullable(),
  role: organizationRoleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const memberSchema = z.object({
  userId: z.string().uuid(),
  role: organizationRoleSchema,
  joinedAt: z.string().datetime(),
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    avatarUrl: z.string().nullable(),
  }),
});
export const invitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: organizationRoleSchema,
  status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export const invitationPreviewSchema = z.object({
  organizationName: z.string(),
  email: emailSchema,
  role: z.enum(['ADMIN', 'MEMBER']),
  expiresAt: z.string().datetime(),
});
export const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).default(''),
    sort: z.enum(['name', 'createdAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
export type OrganizationInput = z.input<typeof organizationInputSchema>;
export type OrganizationUpdate = z.infer<typeof updateOrganizationSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type OrganizationMember = z.infer<typeof memberSchema>;
export type InvitationInput = z.input<typeof invitationInputSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
