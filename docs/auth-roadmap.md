# Authentication Roadmap

## Product Requirements

AI.Doc is an internal business application with two application roles:

- `admin`: retains the Home and Upload documents navigation items and gains a
  user-management navigation item.
- `user`: signs in with credentials created and communicated by an admin.

The planned authentication flow is:

1. An admin creates a user with a username, email, and temporary password.
2. The admin communicates those credentials to the user outside the app.
3. The user signs in and can access only the routes allowed for the `user`
   role.
4. Every authenticated user has a separate account-management navigation item
   where they can update their own username and password.
5. Admin-only user creation and management must be enforced by the backend,
   not only hidden in the frontend.

Passwords are never stored as plain text. The `users` table stores a bcrypt
hash and the backend owns password verification.

## Delivery Phases

### Phase 1 — Database foundation — Complete

- Connect the NestJS application to Supabase PostgreSQL through one shared
  `node-postgres` pool.
- Validate the database connection URL and require an encrypted connection.
- Verify connectivity while Nest starts and close the pool during shutdown.
- Provide a typed database service for later repositories.

### Phase 2 — User persistence — Complete

- A minimal `users` table stores account data.
- Usernames and emails are unique without case sensitivity.
- `created_by_user_id` is nullable for the existing admin and will identify the
  creating admin for later accounts.
- Repository responses never expose password hashes.

### Phase 3 — Authentication API — Partially complete

- Bcrypt hashing and verification are implemented with work factor 12.
- Sign-in returns a one-hour access JWT and sets a seven-day refresh JWT in an
  `HttpOnly` cookie. Refresh, current-user, and sign-out endpoints complete the
  stateless token lifecycle.
- Add authentication and role guards for HTTP routes and Socket.IO access.
- Add username and password update endpoints with appropriate re-verification.

### Phase 4 — Admin and account UI

- The frontend mock login has been replaced with the real API.
- Dashboard routes restore a valid access token and show the authenticated
  username.
- Add the admin-only user-management navigation and create-user form.
- Add account management for username and password changes.
- Enforce role-aware navigation and route access in the frontend while keeping
  the backend as the authorization boundary.

## Decisions Still Required

The following choices are intentionally deferred until their implementation
phase:

- Whether users must change the admin-created password on first sign-in.
- Lockout and audit-event requirements for later user management.
