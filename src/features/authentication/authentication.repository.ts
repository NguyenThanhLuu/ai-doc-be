import { Inject, Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import type { AuthenticatedUser, StoredUser } from "./authentication.types.js";

type StoredUserRow = StoredUser & QueryResultRow;
type AuthenticatedUserRow = AuthenticatedUser & QueryResultRow;

@Injectable()
export class AuthenticationRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const result = await this.databaseService.pool.query<StoredUserRow>(
      `
        SELECT id, username, email, password_hash AS "passwordHash", role
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async findUserById(userId: string): Promise<AuthenticatedUser | null> {
    const result = await this.databaseService.pool.query<AuthenticatedUserRow>(
      `
        SELECT id, username, email, role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  }
}
