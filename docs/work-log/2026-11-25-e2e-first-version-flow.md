## 2026-11-25 — Add an end-to-end test of the whole first-version flow (#21)

Until now each part of the app had its own tests, but nothing checked that
the parts work together from start to finish. Now one automated test does
the whole thing in order, the way Dane would: sign in, set his preferences,
add his portfolio, paste three jobs, see the best one ranked first, pursue
it, answer its screening question, approve the draft, copy it, say "I sent
it", and move it to "Replied" on the Pipeline board with a note.

Each step goes through the same checks a real click does, starting with the
password gate, and the test checks where everything ended up at the close.

To be sure the test is not just passing by luck, it is also run eleven more
times with one step left out each time. Every one of those runs fails, so if
a step ever quietly stops working, this test will say so.

The jobs and portfolio entries in it are made up, and the AI is a fake, so
the test never spends money or touches the real Claude service, and nothing
goes near Upwork. The test found nothing broken, so no app code changed.
