import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_CHARACTERS,
} from "../authentication/authentication.password.js";

const usernameSchema = z
  .string({ error: "Username is required." })
  .trim()
  .min(1, "Username is required.")
  .max(50, "Username must contain 50 characters or fewer.");

const emailSchema = z
  .string({ error: "Email is required." })
  .min(1, "Email is required.")
  .email("Enter a valid email address.")
  .max(254, "Email must contain 254 characters or fewer.");

const passwordSchema = z
  .string({ error: "Password is required." })
  .min(1, "Password is required.")
  .min(
    MIN_PASSWORD_CHARACTERS,
    `Password must contain at least ${MIN_PASSWORD_CHARACTERS} characters.`,
  )
  .refine(
    (password) => Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES,
    `Password must contain ${MAX_PASSWORD_BYTES} bytes or fewer.`,
  );

export const createUserSchema = z
  .object({
    username: z
      .string({ error: "Username is required." })
      .trim()
      .min(1, "Username is required.")
      .max(50, "Username must contain 50 characters or fewer."),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z
      .string({ error: "Confirm password is required." })
      .min(1, "Confirm password is required."),
    role: z.enum(["admin", "user"], {
      error: "Choose an account role.",
    }),
  })
  .refine((input) => input.password === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "Confirm password must match the password.",
  });

export const updateUsernameSchema = z.object({
  username: usernameSchema,
});

export const updatePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: "Current password is required." })
      .min(1, "Current password is required.")
      .refine(
        (password) => Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES,
        "The current password is incorrect.",
      ),
    newPassword: passwordSchema,
    confirmNewPassword: z
      .string({ error: "Confirm new password is required." })
      .min(1, "Confirm new password is required."),
  })
  .refine((input) => input.newPassword === input.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "Confirm password must match the new password.",
  })
  .refine((input) => input.currentPassword !== input.newPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current password.",
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUsernameInput = z.infer<typeof updateUsernameSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
