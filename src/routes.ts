import { Router } from 'express';
import mongoose from 'mongoose';
import { authRouter } from './modules/auth/auth.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { doctorsRouter } from './modules/doctors/doctors.routes.js';
import { patientsRouter } from './modules/patients/patients.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    db:
      mongoose.connection.readyState === mongoose.ConnectionStates.connected
        ? 'connected'
        : 'disconnected',
  });
});

// FR-3: /api/auth/* is the only unauthenticated surface. Every router mounted below it
// applies `authenticate` itself, so a new feature router is closed by default rather
// than open until someone remembers to guard it.
apiRouter.use('/auth', authRouter);

apiRouter.use('/doctors', doctorsRouter);
apiRouter.use('/patients', patientsRouter);
apiRouter.use('/dashboard', dashboardRouter);
