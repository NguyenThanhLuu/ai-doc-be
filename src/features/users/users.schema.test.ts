import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createUserSchema,
  updatePasswordSchema,
  updateUsernameSchema,
} from "./users.schema.js";

describe("users schemas", () => {
  it("preserves the exact casing of a valid email", () => {
    const result = createUserSchema.safeParse({
      username: "New User",
      email: "New.User@Example.COM",
      password: "Password123",
      confirmPassword: "Password123",
      role: "user",
    });

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.email, "New.User@Example.COM");
    }
  });

  it("rejects surrounding email whitespace instead of normalizing it", () => {
    const result = createUserSchema.safeParse({
      username: "New User",
      email: " New.User@Example.COM ",
      password: "Password123",
      confirmPassword: "Password123",
      role: "user",
    });

    assert.equal(result.success, false);
  });

  it("attaches a password mismatch to the confirm-password field", () => {
    const result = createUserSchema.safeParse({
      username: "New User",
      email: "New.User@Example.COM",
      password: "Password123",
      confirmPassword: "Different123",
      role: "admin",
    });

    assert.equal(result.success, false);
    if (!result.success) {
      assert.deepEqual(result.error.issues[0]?.path, ["confirmPassword"]);
    }
  });

  it("trims usernames while rejecting empty values", () => {
    const validResult = updateUsernameSchema.safeParse({
      username: "  Updated User  ",
    });
    const invalidResult = updateUsernameSchema.safeParse({ username: "   " });

    assert.equal(validResult.success, true);
    if (validResult.success) {
      assert.equal(validResult.data.username, "Updated User");
    }
    assert.equal(invalidResult.success, false);
  });

  it("rejects mismatched and reused passwords", () => {
    const mismatchResult = updatePasswordSchema.safeParse({
      currentPassword: "Current123",
      newPassword: "NewPassword123",
      confirmNewPassword: "Different123",
    });
    const reusedResult = updatePasswordSchema.safeParse({
      currentPassword: "Current123",
      newPassword: "Current123",
      confirmNewPassword: "Current123",
    });

    assert.equal(mismatchResult.success, false);
    assert.equal(reusedResult.success, false);
  });
});
