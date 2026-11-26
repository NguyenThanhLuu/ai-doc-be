import type { Request } from "express";
import type { AuthenticatedPrincipal } from "./authentication.types.js";

export interface AuthenticatedRequest extends Request {
  authenticatedUser: AuthenticatedPrincipal;
}
