-- Grade tickets from their accepted terms, even if a sportsbook later removes
-- or changes the live outcome record.
ALTER TABLE wager_legs ADD COLUMN locked_side text;
--> statement-breakpoint
UPDATE wager_legs
SET locked_side=(SELECT side FROM outcomes WHERE outcomes.id=wager_legs.outcome_id)
WHERE locked_side IS NULL;
--> statement-breakpoint
UPDATE wager_legs
SET locked_side=CASE
  WHEN market='total' AND lower(selection) IN ('over','under') THEN lower(selection)
  WHEN selection=(SELECT away_team FROM games WHERE games.id=wager_legs.game_id) THEN 'away'
  WHEN selection=(SELECT home_team FROM games WHERE games.id=wager_legs.game_id) THEN 'home'
END
WHERE locked_side IS NULL;
