import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { Pool } from "pg";
import { DATABASE_URL } from "../config/environment.js";

const DATABASE_POOL_MAX_CLIENTS = 5;
const DATABASE_CONNECTION_TIMEOUT_MS = 10_000;
const DATABASE_IDLE_TIMEOUT_MS = 30_000;

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool = new Pool({
    connectionString: DATABASE_URL,
    max: DATABASE_POOL_MAX_CLIENTS,
    connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: DATABASE_IDLE_TIMEOUT_MS, // connection will be closed after 30 seconds of inactivity
  });

  constructor() {
    this.pool.on("error", (error: Error) => {
      this.logger.error(
        "An idle PostgreSQL connection failed and was removed from the pool.",
        error.stack,
      );
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.pool.query("SELECT 1");
      this.logger.log("PostgreSQL connection established.");
    } catch (error: unknown) {
      this.logger.error(
        "PostgreSQL connection failed. Verify DATABASE_URL and database network access.",
      );
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end(); // close all idle connections in the pool
  }
}
