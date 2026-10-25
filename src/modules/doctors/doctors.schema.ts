import { z } from 'zod';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { fromDateSchema, toDateSchema } from '../../lib/queryPrimitives.js';

export const listDoctorsQuerySchema = paginationQuerySchema.extend({
  /** FR-9: case-insensitive partial (prefix) match on name. */
  search: z.string().trim().min(1).max(120).optional(),
  /** FR-10: filter by specialization, hospital and createdAt range. */
  specialization: z.string().trim().min(1).max(120).optional(),
  hospital: z.string().trim().min(1).max(160).optional(),
  from: fromDateSchema.optional(),
  to: toDateSchema.optional(),
});

export type ListDoctorsQuery = z.infer<typeof listDoctorsQuerySchema>;

export const createDoctorBodySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  specialization: z.string().trim().min(2, 'Specialization is required').max(120),
  hospital: z.string().trim().min(2, 'Hospital is required').max(160),
  phone: z.string().trim().min(5, 'Phone number is required').max(40),
  email: z.email('A valid email address is required').max(160),
});

export type CreateDoctorBody = z.infer<typeof createDoctorBodySchema>;

export const updateDoctorBodySchema = createDoctorBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update',
  });

export type UpdateDoctorBody = z.infer<typeof updateDoctorBodySchema>;
