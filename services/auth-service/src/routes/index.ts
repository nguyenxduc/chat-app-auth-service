import { Router } from 'express';
import { authRouter } from '@/routes/auth.routes';

export const registerRoutes = (app: Router) => {
  // Health check endpoint for Docker/K8s
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'auth-service' });
  });

  app.use('/auth', authRouter);
};
