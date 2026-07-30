# The Points League

Cloudflare Workers version of The Points League with passwordless email sign-in.

Players receive a six-digit sign-in code from Supabase. New players are pending until the commissioner approves them; only approved players can wager or see personal home-page performance.

## Setup

1. Create a Supabase project. In **Authentication → Email Templates → Magic Link**, use a message containing `{{ .Token }}` so players receive a six-digit code.
2. Verify a sending domain in Resend and create an API key.
3. Create the Cloudflare D1 database, replace the placeholder ID in `wrangler.jsonc`, apply migrations, and set the variables listed in `.dev.vars.example`.
4. `SITE_OWNER_EMAIL` becomes the commissioner after its first verified sign-in.
