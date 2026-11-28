## 2026-11-27 — Keep every draft edit as a version Dane can compare (#26)

Every proposal now keeps its own history. Whenever the draft or a screening
answer changes, the app saves a numbered copy of the whole proposal as it
stood right then: version 1 is the AI's first draft, and each edit, answer or
added question adds the next number. Saving the same words again adds
nothing.

Once a copy is saved, nothing can change or delete it, because the database
itself refuses. The copy is also saved together with the change, as one step:
if the copy can't be saved, the change isn't either, so the history never
misses an edit. Proposals that already existed got their version 1 as they
stand today.

Nothing looks different yet. This is the first of two parts. The second part
(UB-29) adds a page listing the versions, a side-by-side compare, and marks
showing which one Dane approved and which one he sent.
