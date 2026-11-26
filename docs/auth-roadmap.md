# Authentication Roadmap

## Product Requirements

AI.Doc is an internal business application with two application roles:

- `admin`: retains the Document lists and Upload documents navigation items and gains a
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
- Usernames are unique without case sensitivity. Emails are stored, compared,
  and constrained exactly as entered, including letter casing.
- `created_by_user_id` is nullable for the existing admin and will identify the
  creating admin for later accounts.
- Repository responses never expose password hashes.

### Phase 3 — Authentication API — Partially complete

- Bcrypt hashing and verification are implemented with work factor 12.
- Sign-in returns a one-hour access JWT and sets a seven-day refresh JWT in an
  `HttpOnly` cookie. Refresh, current-user, and sign-out endpoints complete the
  stateless token lifecycle.
- A global access-token guard protects HTTP controllers by default. Login,
  refresh, and logout are explicitly public. Socket.IO authenticates its
  handshake and scopes document chat to the current user.
- Username and password update endpoints revalidate the caller, require the
  current password for a password change, and clear the refresh cookie after a
  successful password update.

### Phase 4 — Admin and account UI — Complete

- The frontend mock login has been replaced with the real API.
- Dashboard routes restore a valid access token and show the authenticated
  username.
- The dashboard includes an account-management navigation item for both roles.
- Admins can create `admin` or `user` accounts; regular users cannot access the
  creation API or UI.
- Admins can retrieve the safe account list. User lock/removal endpoints remain
  deferred until the authorization model includes those operations.
- Both roles can update only their own username and password.
- Frontend role-aware rendering is backed by backend access-token and role
  guards.

Email addresses are stored and compared exactly as entered. Case variants are
different credentials and are protected by a case-sensitive unique index.

## Decisions Still Required

The following choices are intentionally deferred until their implementation
phase:

- Whether users must change the admin-created password on first sign-in.
- Lockout and audit-event requirements for later user management.
