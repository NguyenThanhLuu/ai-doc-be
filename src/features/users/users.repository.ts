import { Inject, Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import type { AuthenticatedUser } from "../authentication/authentication.types.js";
import type { CreateUserInput } from "./users.schema.js";
import type { UserSummary } from "./users.types.js";

type AuthenticatedUserRow = AuthenticatedUser & QueryResultRow;

interface PasswordHashRow extends QueryResultRow {
  readonly passwordHash: string;
}

interface UserSummaryRow extends AuthenticatedUserRow {
  readonly createdAt: Date;
}

export type ConflictingUserField = "email" | "username";

export class UserFieldConflictError extends Error {
  constructor(readonly field: ConflictingUserField) {
    super(`A user with this ${field} already exists.`);
  }
}

function readUniqueConflict(error: unknown): ConflictingUserField | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const code = Reflect.get(error, "code");
  const constraint = Reflect.get(error, "constraint");

  if (code !== "23505") {
    return null;
  }

  if (constraint === "users_username_lower_unique") {
    return "username";
  }

  if (constraint === "users_email_unique") {
    return "email";
  }

  return null;
}

@Injectable()
export class UsersRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  async listUsers(): Promise<readonly UserSummary[]> {
    const result = await this.databaseService.pool.query<UserSummaryRow>(`
      SELECT id, username, email, role, created_at AS "createdAt" 
      FROM users
      ORDER BY created_at DESC, username ASC
    `);
    //created_at AS "createdAt" mục đích để đổi tên cột created_at trong kết quả truy vấn thành createdAt để phù hợp với kiểu dữ liệu UserSummary

    return result.rows.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(), // ngày giờ chuẩn quốc tế tại múi giờ 0
    }));
  }

  async createUser(
    input: CreateUserInput,
    passwordHash: string,
    createdByUserId: string,
  ): Promise<AuthenticatedUser> {
    try {
      const result =
        await this.databaseService.pool.query<AuthenticatedUserRow>(
          `
          INSERT INTO users (
            username,
            email,
            password_hash,
            role,
            created_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, username, email, role
        `,
          [
            input.username,
            input.email,
            passwordHash,
            input.role,
            createdByUserId,
          ],
        );

      const createdUser = result.rows[0];
      if (!createdUser) {
        throw new Error("The created user was not returned by PostgreSQL.");
      }

      return createdUser;
    } catch (error: unknown) {
      const conflictingField = readUniqueConflict(error);
      if (conflictingField !== null) {
        throw new UserFieldConflictError(conflictingField);
      }

      throw error;
    }
  }

  async updateUsername(
    userId: string,
    username: string,
  ): Promise<AuthenticatedUser | null> {
    try {
      const result =
        await this.databaseService.pool.query<AuthenticatedUserRow>(
          `
          UPDATE users
          SET username = $2, updated_at = NOW()
          WHERE id = $1
          RETURNING id, username, email, role
        `,
          [userId, username],
        );

      return result.rows[0] ?? null;
    } catch (error: unknown) {
      const conflictingField = readUniqueConflict(error);
      if (conflictingField !== null) {
        throw new UserFieldConflictError(conflictingField);
      }

      throw error;
    }
  }

  async findPasswordHashByUserId(userId: string): Promise<string | null> {
    const result = await this.databaseService.pool.query<PasswordHashRow>(
      `
        SELECT password_hash AS "passwordHash"
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId],
    );

    return result.rows[0]?.passwordHash ?? null;
  }

  async updatePasswordHash(
    userId: string,
    expectedPasswordHash: string,
    newPasswordHash: string,
  ): Promise<boolean> {
    const result = await this.databaseService.pool.query(
      `
        UPDATE users
        SET password_hash = $3, updated_at = NOW()
        WHERE id = $1 AND password_hash = $2
      `,
      [userId, expectedPasswordHash, newPasswordHash],
    );

    return result.rowCount === 1;
  }
}
