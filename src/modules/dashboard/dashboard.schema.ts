import { z } from 'zod';
import { fromDateSchema, toDateSchema } from '../../lib/queryPrimitives.js';

export const TIME_INTERVALS = ['day', 'week', 'month'] as const;
export type TimeInterval = (typeof TIME_INTERVALS)[number];

export const timeseriesQuerySchema = z.object({
  interval: z.enum(TIME_INTERVALS).default('day'),
  from: fromDateSchema.optional(),
  to: toDateSchema.optional(),
});

export type TimeseriesQuery = z.infer<typeof timeseriesQuerySchema>;
