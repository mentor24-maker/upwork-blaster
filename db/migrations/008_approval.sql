-- Task 3.3 (hand-off §5D and §13.6): Dane approves one exact version of a
-- proposal, and any later edit cancels that approval (lib/approval.ts).
--
-- An approval is bound to a fingerprint: a SHA-256 hash of the draft's exact
-- text and every screening question with its answer, as they were on the
-- review screen Dane approved from. The text and answers he approved are kept
-- beside it, so what he copies into Upwork later (task 3.4) is the version he
-- read, byte for byte.
--
-- Only Dane's signed-in click writes a row here (app/api/approvals/route.ts);
-- nothing the AI does can. `approved_by` can only ever say so.
CREATE TABLE approval (
  id              INTEGER PRIMARY KEY,
  proposal_id     INTEGER NOT NULL REFERENCES proposal (id),
  fingerprint     TEXT    NOT NULL CHECK (length(fingerprint) = 64),
  approved_draft  TEXT    NOT NULL,
  -- [[question, answer], ...] in the order the review screen showed them.
  approved_answers TEXT   NOT NULL CHECK (json_valid(approved_answers)),
  approved_by     TEXT    NOT NULL DEFAULT 'owner' CHECK (approved_by = 'owner'),
  approved_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Set when something it covers changed afterwards; an approval is never
  -- deleted, so the page can say when it was cancelled and why.
  cancelled_at    TEXT,
  cancelled_why   TEXT
);

CREATE INDEX approval_by_proposal ON approval (proposal_id, id);

-- Any change to what an approval covers cancels it, whichever code made the
-- change: the database does it, so no write path can forget. Changing a word
-- and changing it back still leaves the approval cancelled.
CREATE TRIGGER approval_cancel_on_draft_edit
AFTER UPDATE OF draft ON proposal
WHEN OLD.draft IS NOT NEW.draft
BEGIN
  UPDATE approval
     SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), cancelled_why = 'draft'
   WHERE proposal_id = NEW.id AND cancelled_at IS NULL;
END;

CREATE TRIGGER approval_cancel_on_answer_edit
AFTER UPDATE OF question, answer ON proposal_question
WHEN OLD.question IS NOT NEW.question OR OLD.answer IS NOT NEW.answer
BEGIN
  UPDATE approval
     SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), cancelled_why = 'answer'
   WHERE proposal_id = NEW.proposal_id AND cancelled_at IS NULL;
END;

CREATE TRIGGER approval_cancel_on_question_added
AFTER INSERT ON proposal_question
BEGIN
  UPDATE approval
     SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), cancelled_why = 'question'
   WHERE proposal_id = NEW.proposal_id AND cancelled_at IS NULL;
END;

CREATE TRIGGER approval_cancel_on_question_removed
AFTER DELETE ON proposal_question
BEGIN
  UPDATE approval
     SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), cancelled_why = 'question'
   WHERE proposal_id = OLD.proposal_id AND cancelled_at IS NULL;
END;
