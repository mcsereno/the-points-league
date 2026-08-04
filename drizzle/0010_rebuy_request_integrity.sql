-- A rebuy request ID lets a browser retry safely and ensures only the request
-- that changed a member's balance can create the matching ledger entry.
ALTER TABLE members ADD COLUMN rebuy_request_id text;
