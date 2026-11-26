CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON public.users (email);

DROP INDEX IF EXISTS public.users_email_lower_unique;
