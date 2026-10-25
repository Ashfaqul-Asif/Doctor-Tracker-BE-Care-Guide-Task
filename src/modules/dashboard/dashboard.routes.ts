import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { getSummaryHandler, getTimeseriesHandler } from './dashboard.controller.js';
import { timeseriesQuerySchema } from './dashboard.schema.js';

export const dashboardRouter = Router();

// FR-3: everything below this line requires a valid access token.
dashboardRouter.use(authenticate);

dashboardRouter.get('/summary', getSummaryHandler);
dashboardRouter.get(
  '/timeseries',
  validate({ query: timeseriesQuerySchema }),
  getTimeseriesHandler,
);
