import { callFunction } from './client';

export async function sendEmailVerificationEmail(): Promise<{
  success: boolean;
  emailSent: boolean;
  alreadyVerified?: boolean;
}> {
  return callFunction<Record<string, never>, {
    success: boolean;
    emailSent: boolean;
    alreadyVerified?: boolean;
  }>('sendEmailVerificationEmail', {});
}

export async function sendPasswordResetEmail(email: string): Promise<{
  success: boolean;
  emailSent: boolean;
}> {
  return callFunction<{ email: string }, { success: boolean; emailSent: boolean }>(
    'sendPasswordResetEmail',
    { email }
  );
}
