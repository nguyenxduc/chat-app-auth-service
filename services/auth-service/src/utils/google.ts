import { OAuth2Client } from 'google-auth-library';
import { HttpError } from '@chatapp/common';

import { env } from '@/config/env';

const client = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

export interface GoogleIdTokenPayload {
  sub: string;
  email: string;
  name?: string;
}

export const verifyGoogleIdToken = async (idToken: string): Promise<GoogleIdTokenPayload> => {
  if (!client) {
    throw new HttpError(503, 'Google login is not configured');
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Invalid Google token');
  }

  if (!payload?.email || !payload.sub) {
    throw new HttpError(401, 'Invalid Google token');
  }

  return { sub: payload.sub, email: payload.email, name: payload.name };
};
