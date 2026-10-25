import { z } from 'zod';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { fromDateSchema, objectIdSchema, toDateSchema } from '../../lib/queryPrimitives.js';

export const listPatientsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  condition: z.string().trim().min(1).max(160).optional(),
  doctorId: objectIdSchema.optional(),
  from: fromDateSchema.optional(),
  to: toDateSchema.optional(),
});

export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;

export const createPatientBodySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  condition: z.string().trim().min(2, 'Condition must be at least 2 characters').max(160),
  // FR-16: required, so a patient can never exist orphaned from a doctor.
  doctorId: objectIdSchema,
  contactInfo: z.string().trim().min(3, 'Contact info is required').max(200),
});

export type CreatePatientBody = z.infer<typeof createPatientBodySchema>;

export const updatePatientBodySchema = createPatientBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update',
  });

export type UpdatePatientBody = z.infer<typeof updatePatientBodySchema>;
