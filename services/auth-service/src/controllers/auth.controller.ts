import { login, refreshTokens, register, revokeRefreshToken } from '@/services/auth.service';
import { LoginInput, RegisterInput } from '@/types/auth';
import { asyncHandler, HttpError } from '@chatapp/common';
import { RequestHandler } from 'express';

export const registerHandler: RequestHandler = asyncHandler(async (req, res) => {
  const payload = req.body as RegisterInput;
  const tokens = await register(payload);
  res.status(201).json(tokens);
});

export const loginHandler: RequestHandler = asyncHandler(async (req, res) => {
  const payload = req.body as LoginInput;
  const tokens = await login(payload);
  res.json(tokens);
});

export const refreshHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    throw new HttpError(400, 'refreshToken is required');
  }
  const tokens = await refreshTokens(refreshToken);
  res.json(tokens);
});

export const revokeHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    throw new HttpError(400, 'userId is required');
  }
  await revokeRefreshToken(userId);
  res.status(204).send();
});
