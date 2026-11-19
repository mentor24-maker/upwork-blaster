# Upwork Blaster

Built by the Alphire Spirality loop. `npm run verify` is the definition of done; CI runs it on every pull request.

The build plan: [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md).

## Running it

The app is a Next.js site. On the Mini it runs as a launchd service (macOS's
built-in way to keep a program running), at **http://mac-mini.local:4280**,
reachable only on the home network.

```bash
./scripts/install_app_service.sh               # build the app, install and start the service
./scripts/install_app_service.sh --status      # installed? loaded? running? answering?
./scripts/install_app_service.sh --uninstall   # stop it and remove it
```

Run the installer from the main checkout. The service starts at login and
after a reboot, starts again by itself if it stops, and rebuilds the app when
the checkout has moved since its last build, so
`launchctl kickstart -k gui/$(id -u)/com.upwork-blaster.app` puts the latest
merged work live. Its log is `~/loop-logs/upwork-blaster-app.log`.

To work on it: `npm run dev` (live reload, on port 4281 so it never collides with the service), and
`npm run verify` for the type check and every test.
