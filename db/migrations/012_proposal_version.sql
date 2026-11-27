-- UB-26: every change to what Dane would send keeps a copy of the whole
-- proposal as it then stood, numbered 1, 2, 3 within each proposal
-- (lib/proposalVersions.ts). UB-29 shows them side by side.
--
-- One row is one version: the draft's exact text and every screening
-- question with its answer as [[question, answer], ...] in workspace order,
-- the same shape as approval.approved_answers, so the approval fingerprint
-- (lib/approval.ts `fingerprintOf`) can be worked out from a version.
--
-- `change` says what made this version: the AI's first draft, an edit of the
-- draft, an answer, or a question added. `author` says whose words they were.
--
-- A version is saved only once the proposal has a draft (there is nothing
-- Dane could send before that), so version 1 is always the first draft.
CREATE TABLE proposal_version (
  id           INTEGER PRIMARY KEY,
  proposal_id  INTEGER NOT NULL REFERENCES proposal (id),
  version_no   INTEGER NOT NULL CHECK (version_no >= 1),
  draft        TEXT    NOT NULL,
  answers      TEXT    NOT NULL CHECK (json_valid(answers) AND json_type(answers) = 'array'),
  change       TEXT    NOT NULL CHECK (change IN ('first-draft', 'draft', 'answer', 'question')),
  author       TEXT    NOT NULL CHECK (author IN ('AI', 'Dane')),
  saved_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (proposal_id, version_no)
);

-- A version is never changed and never deleted, whichever code tries: the
-- database refuses, the same "the database does it" approach 008_approval.sql
-- takes.
CREATE TRIGGER proposal_version_never_updated
BEFORE UPDATE ON proposal_version
BEGIN
  SELECT RAISE(ABORT, 'a saved proposal version can never be changed');
END;

CREATE TRIGGER proposal_version_never_deleted
BEFORE DELETE ON proposal_version
BEGIN
  SELECT RAISE(ABORT, 'a saved proposal version can never be deleted');
END;

-- Proposals that already have a draft start their history here: version 1 is
-- the proposal as it stands today. Its words are Dane's if he has edited the
-- draft, the AI's otherwise.
INSERT INTO proposal_version (proposal_id, version_no, draft, answers, change, author, saved_at)
SELECT p.id,
       1,
       p.draft,
       (SELECT json_group_array(json_array(q.question, coalesce(q.answer, '')) ORDER BY q.id)
          FROM proposal_question q WHERE q.proposal_id = p.id),
       CASE WHEN p.edited_at IS NULL THEN 'first-draft' ELSE 'draft' END,
       CASE WHEN p.edited_at IS NULL THEN 'AI' ELSE 'Dane' END,
       coalesce(p.edited_at, p.drafted_at, p.created_at)
  FROM proposal p
 WHERE p.draft IS NOT NULL
 ORDER BY p.id;
