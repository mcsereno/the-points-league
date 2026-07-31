CREATE TABLE audit_events (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  season_id text NOT NULL,
  actor_email text,
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id text,
  details_json text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX audit_events_season_created_idx ON audit_events (season_id,created_at);
--> statement-breakpoint
CREATE INDEX audit_events_subject_idx ON audit_events (subject_type,subject_id,created_at);
--> statement-breakpoint
CREATE TABLE auth_rate_limits (
  bucket text NOT NULL,
  key_hash text NOT NULL,
  window_started_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (bucket,key_hash)
);
--> statement-breakpoint
CREATE TABLE operational_alerts (
  event_key text PRIMARY KEY NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  last_error text,
  sent_at text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
