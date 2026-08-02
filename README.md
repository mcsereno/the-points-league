# Gridiron Ledger

Cloudflare Workers version of Gridiron Ledger with email/password accounts.

Players register with a username, email, and password, then confirm their email. New players are pending until the commissioner approves them; only approved players can wager or see personal home-page performance.

## Setup

1. Create a Supabase project. Keep email confirmation enabled in **Authentication → Providers → Email**. Configure the **Confirm signup** email template with `{{ .ConfirmationURL }}`.
2. Configure Gmail as Supabase custom SMTP (`smtp.gmail.com`, port `465`, Gmail address, and a Google App Password).
3. Deploy `docs/gmail-mailer.gs` as a Google Apps Script web app, then set its URL and token in the variables listed in `.dev.vars.example`. This sends registration and approval emails from the same Gmail account.
4. Create the Cloudflare D1 database, replace the placeholder ID in `wrangler.jsonc`, apply migrations, and set the variables listed in `.dev.vars.example`.
5. `SITE_OWNER_EMAIL` becomes the commissioner after its first verified sign-in.

## Live odds

Gridiron Ledger uses TheRundown API v2 for NFL and NCAAF full-game moneylines, spreads, and totals. Add the free-plan key as the `RUNDOWN_API_KEY` Cloudflare secret. DraftKings is primary and FanDuel automatically fills a missing market. TheRundown free-plan odds are pre-match and delayed by five minutes; score settlement uses ESPN's public scoreboard feed and does not consume odds data points.
