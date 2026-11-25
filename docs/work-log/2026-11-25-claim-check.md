## 2026-11-25 — Block approval of drafts that claim something unproven (#17)

A proposal can only win work honestly if every claim in it is true. Before
this change, nothing stopped a draft, whether the AI wrote it or Dane
edited it, from calling a planned project "delivered", mentioning work he
hadn't cleared for use, or inventing a figure like "7 years" or "cut costs 40%".

Now every draft is checked, the moment the AI writes it and every time Dane
saves an edit. Each of those three kinds of claim gets a red "Blocks
approval" flag that quotes the sentence and says in plain words why, and
what to do: say plainly the work is still planned, take it out, or add the
fact to an approved portfolio entry. The flag disappears as soon as the
sentence is fixed. When the approval step arrives (the next task), it will
refuse any draft that still has a flag.

To make this usable, the draft on the proposal page is now a box Dane can
edit and save, and the page says whether the words are still the AI's or his
own edit (with the time, Mountain time).

The check is a set of plain rules, not the AI, so a job post can't talk its
way past it. It has known blind spots, written down in the code: it
recognises projects by their name as written, and a number the job post
itself mentions counts as sourced.

**After review, round 1.** Review caught four ways the check read sentences
wrongly, and they are fixed: invented figures written with a unit stuck on
("10x faster", "8yrs", "1.5x") now get flagged instead of slipping through;
honest sentences like "Booking Helper is being built" or "is not yet launched"
no longer get flagged just because they contain the word "built" or
"launched"; "I'm building" counts the same as "I am building"; and in "I
delivered A and am building B", the word "delivered" now counts against A
only. Dane's own answers to a job's screening questions also count as a
source now, so "I can start in 2 days" is fine when he answered "2 days".

Second round of review fixes: the check now reads numbers written out as
words, so "over ten years of experience", "used by three hospitals", "a decade
of experience" and "hundreds of clients" are caught just like "10 years". A
word and its digits count as the same number, so "five years" is fine when the
job asks for 5 years. A lone "one" or "a" is not treated as a number. A project
name written with a hyphen ("Booking-Helper") is now recognised too.
