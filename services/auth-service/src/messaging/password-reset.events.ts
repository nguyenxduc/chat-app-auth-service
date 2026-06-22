export const PASSWORD_RESET_EXCHANGE = 'auth.internal';
export const PASSWORD_RESET_REQUESTED_ROUTING_KEY = 'password.reset.requested';
export const PASSWORD_RESET_QUEUE = 'auth-service.password-reset';

export interface PasswordResetRequestedPayload {
  email: string;
  otp: string;
}
