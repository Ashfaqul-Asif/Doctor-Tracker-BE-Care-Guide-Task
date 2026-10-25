import type { RequestHandler } from 'express';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { idParamSchema } from '../../lib/queryPrimitives.js';
import { validated } from '../../middleware/validate.js';
import { listPatients } from '../patients/patients.service.js';
import {
  createDoctorBodySchema,
  listDoctorsQuerySchema,
  updateDoctorBodySchema,
} from './doctors.schema.js';
import * as doctorsService from './doctors.service.js';

export const listDoctorsHandler: RequestHandler = async (req, res) => {
  const query = validated(req, 'query', listDoctorsQuerySchema);
  res.json(await doctorsService.listDoctors(query));
};

export const getDoctorHandler: RequestHandler = async (req, res) => {
  const { id } = validated(req, 'params', idParamSchema);
  res.json(await doctorsService.getDoctor(id));
};

export const createDoctorHandler: RequestHandler = async (req, res) => {
  const body = validated(req, 'body', createDoctorBodySchema);
  res.status(201).json(await doctorsService.createDoctor(body));
};

export const updateDoctorHandler: RequestHandler = async (req, res) => {
  const { id } = validated(req, 'params', idParamSchema);
  const body = validated(req, 'body', updateDoctorBodySchema);
  res.json(await doctorsService.updateDoctor(id, body));
};

/**
 * FR-11: the patients belonging to one doctor, paginated.
 *
 * This reuses the patients service rather than reimplementing the query — the filter,
 * the envelope and the index it rides on are then guaranteed identical to /api/patients.
 * The doctor summary is omitted from each row since the whole page is already scoped
 * to one known doctor.
 */
export const listDoctorPatientsHandler: RequestHandler = async (req, res) => {
  const { id } = validated(req, 'params', idParamSchema);
  const { page, limit } = validated(req, 'query', paginationQuerySchema);

  await doctorsService.assertDoctorExists(id);

  res.json(await listPatients({ page, limit, doctorId: id }, { includeDoctor: false }));
};

export const getDoctorFacetsHandler: RequestHandler = async (_req, res) => {
  res.json(await doctorsService.getDoctorFacets());
};
