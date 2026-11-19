## 2026-11-19 — Add a preferences page for search themes, exclusions and ranking weights (#10)

Upwork Blaster now has a Preferences page. On it Dane writes down what work he
wants (search themes), the technology he works in and the technology he will
not take, the rules that rule a job out completely, and how much each of the
five ranking measures counts. The five weights start at the hand-off's
30 / 25 / 20 / 15 / 10 and must add up to 100. A save that does not add up is
refused with a plain message saying what the total was.

Saving never overwrites anything. Each save becomes a new numbered version,
and the page lists them all. That matters for the scoring step that comes
next: each score will record which version of Dane's preferences it used, so
an old score still makes sense after he changes his mind.
