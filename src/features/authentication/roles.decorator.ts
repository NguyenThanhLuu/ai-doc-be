import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "./authentication.types.js";

export const REQUIRED_ROLES_METADATA_KEY = "requiredUserRoles";

export const Roles = (...roles: readonly UserRole[]) =>
  SetMetadata(REQUIRED_ROLES_METADATA_KEY, roles);
