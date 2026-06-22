import { Router } from 'express';
import { validateRequest } from '@chatapp/common';
import {
  forgotPasswordHandler,
  googleLoginHandler,
  loginHandler,
  refreshHandler,
  registerHandler,
  resetPasswordHandler,
  revokeHandler,
} from '@/controllers/auth.controller';
import {
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  revokeSchema,
} from '@/validation/auth.schema';

export const authRouter: Router = Router();

authRouter.post('/register', validateRequest({ body: registerSchema.shape.body }), registerHandler);
authRouter.post('/login', validateRequest({ body: loginSchema.shape.body }), loginHandler);
authRouter.post('/refresh', validateRequest({ body: refreshSchema.shape.body }), refreshHandler);
authRouter.post('/revoke', validateRequest({ body: revokeSchema.shape.body }), revokeHandler);
authRouter.post(
  '/google',
  validateRequest({ body: googleLoginSchema.shape.body }),
  googleLoginHandler,
);
authRouter.post(
  '/forgot-password',
  validateRequest({ body: forgotPasswordSchema.shape.body }),
  forgotPasswordHandler,
);
authRouter.post(
  '/reset-password',
  validateRequest({ body: resetPasswordSchema.shape.body }),
  resetPasswordHandler,
);
