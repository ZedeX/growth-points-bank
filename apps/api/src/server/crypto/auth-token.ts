import { createHmac, randomUUID } from 'crypto';

const AUTH_HMAC_SECRET = process.env.AUTH_HMAC_SECRET || 'dev-hmac-secret-change-me-32chars';

export function hashAccessToken(plaintext: string): string {
  return createHmac('sha256', AUTH_HMAC_SECRET).update(plaintext).digest('hex');
}

export function generateAccessToken(): string {
  return randomUUID();
}

export function generateAndHashToken(): { plaintext: string; hashed: string } {
  const plaintext = generateAccessToken();
  return { plaintext, hashed: hashAccessToken(plaintext) };
}
