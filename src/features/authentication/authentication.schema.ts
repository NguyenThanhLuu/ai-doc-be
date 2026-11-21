import { Buffer } from "node:buffer";
import { z } from "zod";

const MAX_PASSWORD_BYTES = 72;

const emailSchema = z
  .string({ error: "Email is required." })
  .trim()
  .email("Enter a valid email address.")
  .max(254, "Email must contain 254 characters or fewer.")
  .transform((email) => email.toLowerCase());

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: "Password is required." })
    .min(1, "Password is required.")
    .refine(
      (password) => Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES,
      "The email or password is incorrect.",
    ),
});

export type LoginInput = z.infer<typeof loginSchema>;
