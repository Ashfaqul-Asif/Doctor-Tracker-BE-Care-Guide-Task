import type { RequestHandler } from 'express';
import { validated } from '../../middleware/validate.js';
import { timeseriesQuerySchema } from './dashboard.schema.js';
import * as dashboardService from './dashboard.service.js';

export const getSummaryHandler: RequestHandler = async (_req, res) => {
  res.json(await dashboardService.getSummary());
};

export const getTimeseriesHandler: RequestHandler = async (req, res) => {
  const query = validated(req, 'query', timeseriesQuerySchema);
  res.json(await dashboardService.getTimeseries(query));
};
