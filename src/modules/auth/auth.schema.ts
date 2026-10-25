import { z } from 'zod';

export const loginBodySchema = z.object({
  email: z.email('A valid email address is required').max(160),
  // No complexity rules on the *login* path: the only thing that matters here is
  // whether it matches. Rules belong on the create-user path.
  password: z.string().min(1, 'Password is required').max(200),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
