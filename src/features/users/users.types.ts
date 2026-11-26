import type { AuthenticatedUser } from "../authentication/authentication.types.js";

export interface UserSummary extends AuthenticatedUser {
  readonly createdAt: string;
}
