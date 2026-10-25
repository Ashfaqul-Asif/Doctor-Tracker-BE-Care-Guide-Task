import { Router } from 'express';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { idParamSchema } from '../../lib/queryPrimitives.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import {
  createDoctorHandler,
  getDoctorFacetsHandler,
  getDoctorHandler,
  listDoctorPatientsHandler,
  listDoctorsHandler,
  updateDoctorHandler,
} from './doctors.controller.js';
import { createDoctorBodySchema, listDoctorsQuerySchema, updateDoctorBodySchema } from './doctors.schema.js';

export const doctorsRouter = Router();

// FR-3: everything below this line requires a valid access token.
doctorsRouter.use(authenticate);

// Registered before `/:id` — otherwise Express matches "facets" as an id.
doctorsRouter.get('/facets', getDoctorFacetsHandler);

// No per-route role guard: this is a single-role admin panel, so the `authenticate`
// above is the entire authorisation boundary. A `requireRole('admin')` here would be
// satisfied by every caller that reached it.
doctorsRouter.get('/', validate({ query: listDoctorsQuerySchema }), listDoctorsHandler);
doctorsRouter.post('/', validate({ body: createDoctorBodySchema }), createDoctorHandler);
doctorsRouter.get('/:id', validate({ params: idParamSchema }), getDoctorHandler);
doctorsRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateDoctorBodySchema }),
  updateDoctorHandler,
);
doctorsRouter.get(
  '/:id/patients',
  validate({ params: idParamSchema, query: paginationQuerySchema }),
  listDoctorPatientsHandler,
);

// No DELETE /:id — doctor deletion is out of scope (confirmed with the client).
