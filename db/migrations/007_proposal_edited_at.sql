-- Task 3.2: Dane can edit a proposal's draft, and the claim check
-- (lib/claimCheck.ts) runs on what he saves. The workspace says whose words
-- the draft is: the AI's as written, or Dane's edit and when he saved it.
-- NULL until he saves an edit. Claim flags are not stored: they are worked
-- out afresh from the draft and the portfolio every time, so they never go
-- stale.
ALTER TABLE proposal ADD COLUMN edited_at TEXT;
