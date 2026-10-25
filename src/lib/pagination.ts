import { z } from 'zod';

/**
 * One pagination contract for every list endpoint. The frontend should never have to
 * special-case one endpoint's envelope against another's (requirements §4).
 */
export interface Paginated<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function toSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function paginate<T>(
  data: T[],
  { page, limit, total }: { page: number; limit: number; total: number },
): Paginated<T> {
  return {
    data,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
