## 2026-11-18 — Add a password so only Dane can open the app (#7)

The app now has a lock. Every page asks for one password first; the right
one keeps that browser signed in for 30 days, and a Sign out button ends it.
Anyone without the password sees only the sign-in page, and any attempt to
make the app do something behind the page gets an empty "not allowed".

The password and the key that signs the sign-in cookie live in Doppler, not
in this public repository, and the app on the Mini now starts through Doppler
so it can read them. If either is missing, the app lets nobody in rather than
everybody.

This matters because every later screen (jobs, drafts, client notes) will sit
behind this one check, so it had to be right first. Trying it for real caught
two slips the first tests did not, and both are fixed and tested.

Review then found two more gaps, now closed. A made-up sign-in address
(ending `?error=__proto__`) could crash the sign-in page; now the page only
shows its own two messages and ignores anything else. And changing the
password used to leave browsers already signed in still signed in for up to
a month; now changing the password (or the cookie key) signs every browser
out, so changing it is the fix if Dane ever thinks it leaked.
