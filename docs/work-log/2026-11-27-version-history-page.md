## 2026-11-27 — See every saved version of a proposal side by side, with the approved and sent ones marked (#29)

Each proposal now has a "Version history" page, reached from a link in the
proposal workspace. It lists every saved version of the proposal, newest
first, and says what changed each time, whether the words were the AI's or
Dane's, and when (Mountain time).

The version Dane approved is marked "Approved", and the mark says if a later
edit cancelled that approval. The version he copied into Upwork and marked as
sent is marked "Sent". Nothing new is stored for these marks: the page works
them out from the approval and "I sent it" records the app already keeps.

He can pick any two versions and see them side by side, old on the left and
new on the right. Removed lines are shown in red, added lines in green, and
unchanged lines line up, for the draft and for each screening answer. The
page only reads and never changes anything. A test checks that opening it
writes nothing to the database.

After review sent it back, three things were fixed. Two screening questions
with the same wording no longer get their answers mixed up in the compare
view. A very long draft no longer uses a huge amount of memory to compare:
lines the two versions share at the start and end are set aside first, and a
rewrite too big to line up is shown as all removed and all added. And a
proposal sent before versions were kept now still says it was sent, instead
of the mark quietly disappearing.
