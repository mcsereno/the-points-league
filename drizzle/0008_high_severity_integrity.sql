-- Existing duplicate display names are made distinct before the constraint is added.
WITH ranked AS (
  SELECT id,display_name,ROW_NUMBER() OVER (PARTITION BY lower(display_name) ORDER BY id) AS duplicate_number
  FROM members
)
UPDATE members
SET display_name=display_name || ' #' || id
WHERE id IN (SELECT id FROM ranked WHERE duplicate_number > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX members_display_name_unique ON members (display_name COLLATE NOCASE);
