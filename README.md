# The Points League

Cloudflare Workers version of The Points League with passwordless email sign-in.

Players receive a six-digit sign-in code from Supabase. New players are pending until the commissioner approves them; only approved players can wager or see personal home-page performance.

## Setup

1. Create a Supabase project. In **Authentication → Email Templates → Magic Link**, use a message containing `{{ .Token }}` so players receive a six-digit code.
2. Configure Gmail as Supabase custom SMTP (`smtp.gmail.com`, port `465`, Gmail address, and a Google App Password).
3. Deploy `docs/gmail-mailer.gs` as a Google Apps Script web app, then set its URL and token in the variables listed in `.dev.vars.example`. This sends registration and approval emails from the same Gmail account.
4. Create the Cloudflare D1 database, replace the placeholder ID in `wrangler.jsonc`, apply migrations, and set the variables listed in `.dev.vars.example`.
5. `SITE_OWNER_EMAIL` becomes the commissioner after its first verified sign-in.
