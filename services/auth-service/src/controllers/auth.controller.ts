import { authService } from '@/services/auth.service';
import { LoginInput, RegisterInput } from '@/types/auth';
import { asyncHandler, HttpError } from '@chatapp/common';
import { RequestHandler } from 'express';

export const registerHandler: RequestHandler = asyncHandler(async (req, res) => {
  const payload = req.body as RegisterInput;
  const tokens = await authService.register(payload);
  res.status(201).json(tokens);
});

export const loginHandler: RequestHandler = asyncHandler(async (req, res) => {
  const payload = req.body as LoginInput;
  const tokens = await authService.login(payload);
  res.json(tokens);
});

export const refreshHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    throw new HttpError(400, 'refreshToken is required');
  }
  const tokens = await authService.refreshTokens(refreshToken);
  res.json(tokens);
});

export const revokeHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    throw new HttpError(400, 'userId is required');
  }
  await authService.revokeRefreshToken(userId);
  res.status(204).send();
});

export const googleLoginHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { idToken } = req.body as { idToken: string };
  const tokens = await authService.loginWithGoogle(idToken);
  res.json(tokens);
});

export const forgotPasswordHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { email } = req.body as { email: string };
  await authService.requestPasswordReset(email);
  res.status(202).json({ message: 'If this email is registered, a reset code has been sent' });
});

export const resetPasswordHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body as {
    email: string;
    otp: string;
    newPassword: string;
  };
  await authService.resetPassword({ email, otp, newPassword });
  res.status(204).send();
});
