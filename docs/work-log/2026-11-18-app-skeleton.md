## 2026-11-18 — Add the app skeleton and keep it running on the Mini (#6)

Upwork Blaster stopped being only a plan and became a real web app: one plain
page titled "Upwork Blaster", built with Next.js and TypeScript, the tools the
plan chose. It has no screens yet; those come in the next tasks.

It also got a way to stay running on the Mini without anyone watching it: a
launchd service (the part of macOS that starts programs at login and restarts
them when they stop) that serves the app at http://mac-mini.local:4280, on the
home network only. One script installs it, and the same script with
`--status` says whether it is running and answering.

The check every change must pass, `npm run verify`, now also checks the
TypeScript types, so a typing mistake fails the pull request instead of
reaching the Mini.

The service itself goes on the Mini once this is merged: it serves the main
copy of the code, which only has the app after the merge.
