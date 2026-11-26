export type UserRole = "admin" | "user";

export interface AuthenticatedUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: UserRole;
}

export interface AuthenticatedPrincipal extends AuthenticatedUser {
  readonly accessTokenExpiresAt: number;
}

export interface StoredUser extends AuthenticatedUser {
  readonly passwordHash: string;
}

