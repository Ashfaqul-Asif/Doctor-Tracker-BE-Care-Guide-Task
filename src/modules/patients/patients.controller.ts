import type { RequestHandler } from 'express';
import { idParamSchema } from '../../lib/queryPrimitives.js';
import { validated } from '../../middleware/validate.js';
import {
  createPatientBodySchema,
  listPatientsQuerySchema,
  updatePatientBodySchema,
} from './patients.schema.js';
import * as patientsService from './patients.service.js';

export const listPatientsHandler: RequestHandler = async (req, res) => {
  const query = validated(req, 'query', listPatientsQuerySchema);
  res.json(await patientsService.listPatients(query));
};

export const getPatientHandler: RequestHandler = async (req, res) => {
  const { id } = validated(req, 'params', idParamSchema);
  res.json(await patientsService.getPatient(id));
};

export const createPatientHandler: RequestHandler = async (req, res) => {
  const body = validated(req, 'body', createPatientBodySchema);
  res.status(201).json(await patientsService.createPatient(body));
};

export const updatePatientHandler: RequestHandler = async (req, res) => {
  const { id } = validated(req, 'params', idParamSchema);
  const body = validated(req, 'body', updatePatientBodySchema);
  res.json(await patientsService.updatePatient(id, body));
};

export const deletePatientHandler: RequestHandler = async (req, res) => {
  const { id } = validated(req, 'params', idParamSchema);
  await patientsService.softDeletePatient(id);
  res.status(204).send();
};

export const listConditionsHandler: RequestHandler = async (_req, res) => {
  res.json({ conditions: await patientsService.listConditions() });
};
