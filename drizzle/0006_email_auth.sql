ALTER TABLE members ADD COLUMN auth_user_id text;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN email_verified_at text;
--> statement-breakpoint
CREATE UNIQUE INDEX members_auth_user_id_unique ON members (auth_user_id);
--> statement-breakpoint
CREATE TABLE auth_challenges (email text PRIMARY KEY NOT NULL, display_name text, requested_at text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE TABLE auth_sessions (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, member_id integer NOT NULL, token_hash text NOT NULL, expires_at text NOT NULL, revoked_at text, last_seen_at text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, FOREIGN KEY (member_id) REFERENCES members(id));
--> statement-breakpoint
CREATE UNIQUE INDEX auth_sessions_token_hash_unique ON auth_sessions (token_hash);
--> statement-breakpoint
CREATE INDEX auth_sessions_member_idx ON auth_sessions (member_id);
