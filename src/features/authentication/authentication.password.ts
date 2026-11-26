import bcrypt from "bcrypt";

export const MIN_PASSWORD_CHARACTERS = 8;
export const MAX_PASSWORD_BYTES = 72;

const BCRYPT_WORK_FACTOR = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_WORK_FACTOR);
}

export function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
