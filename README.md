# Amun

A macOS product workspace for directing an AI crew from intent through delivery, with explicit human decisions.

Amun is a window onto the captain's own [Firstmate](https://github.com/kunchenguid/firstmate). The captain talks only to the First Mate. The First Mate hands real work to its secondmates and crew, watches them, and reports back. Amun never starts, steers or stops crew any other way. Underneath, the [Paseo](https://github.com/getpaseo/paseo) daemon runs the First Mate headless (`pi --mode rpc`), carries messages to and from the UI, and keeps Amun's own data in `~/.amun`.

Start with [the rebuild handoff](docs/rebuild/HANDOFF.md). It has the rules, the decisions and what to do next.

## Layout

- `vendor/firstmate`: Firstmate, a pristine `git subtree`. Never edit it; CI checks this (`scripts/check-firstmate-pristine.sh`).
- `firstmate-layer/`, `packages/server/src/server/amun/`: Amun's additions on top of Firstmate and the daemon.
- `packages/amun-ui`: the Amun interface.
- `packages/desktop`: the Electron app.
- `packages/work-store`, `contracts`, `domain`, `theme`, `council`, `notion`: Amun's own data, rules and features.
- `packages/protocol`, `client`, `server`, `cli`, `plugin`, `relay`, `highlight`: Paseo.

## Development

Use Node 22.13 or later (`.node-version` pins the CI version) and npm.

```sh
npm ci
npm run build:server
npm start                      # the daemon on 127.0.0.1:6767; Amun's RPC is ws://127.0.0.1:6767/amun
```

Firstmate needs `tmux` or `herdr`, `treehouse`, `tasks-axi`, `jq` and `git` on your PATH, and Pi installed and signed in. Amun uses `~/Projects/firstmate` as the Firstmate home unless `AMUN_FIRSTMATE_HOME` says otherwise, and never writes into it.

Run the UI in a browser with `cd packages/amun-ui && npx vite build && npx vite preview --port 6768`, then open `http://127.0.0.1:6768/index.html?daemon=ws://127.0.0.1:6767/amun`. Run the desktop app with `cd packages/desktop && npm run dev`.

Before a pull request, run `npm run typecheck`, `npm run lint`, `npm run format:check` and `npx vitest run`.

## Test build for trusted testers

The beta is ad-hoc signed for Apple-chip Macs; it is not notarized. From the repository root:

```sh
npm ci
npm run build:desktop-inputs
cd packages/desktop && npm run build:main
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config electron-builder.yml \
  --mac dmg --arm64 --publish never \
  -c.mac.identity=- -c.mac.notarize=false -c.mac.hardenedRuntime=false
```

Hardened runtime must be off for an ad-hoc-signed build: macOS refuses to load Electron in an ad-hoc-signed app with it on.
