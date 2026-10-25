import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { idParamSchema } from '../../lib/queryPrimitives.js';
import { validate } from '../../middleware/validate.js';
import {
  createPatientHandler,
  deletePatientHandler,
  getPatientHandler,
  listConditionsHandler,
  listPatientsHandler,
  updatePatientHandler,
} from './patients.controller.js';
import {
  createPatientBodySchema,
  listPatientsQuerySchema,
  updatePatientBodySchema,
} from './patients.schema.js';

export const patientsRouter = Router();

// FR-3: everything below this line requires a valid access token.
patientsRouter.use(authenticate);

// Registered before `/:id` — otherwise Express matches "conditions" as an id.
patientsRouter.get('/conditions', listConditionsHandler);

// No per-route role guard: this is a single-role admin panel, so the `authenticate`
// above is the entire authorisation boundary. A `requireRole('admin')` here would be
// satisfied by every caller that reached it.
patientsRouter.get('/', validate({ query: listPatientsQuerySchema }), listPatientsHandler);
patientsRouter.post('/', validate({ body: createPatientBodySchema }), createPatientHandler);
patientsRouter.get('/:id', validate({ params: idParamSchema }), getPatientHandler);
patientsRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updatePatientBodySchema }),
  updatePatientHandler,
);
/** Soft delete (FR-13, FR-17) — the record is retained, not removed. */
patientsRouter.delete('/:id', validate({ params: idParamSchema }), deletePatientHandler);
