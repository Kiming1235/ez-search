# ScreenExplain

ScreenExplain is a Windows desktop app that captures a screen region and returns a short answer.

The current public architecture is:

- `ScreenExplain.exe`
- local Electron/Node bridge
- optional remote WordPress approval backend
- OpenAI Responses API

## Product shape

- tray-first desktop workflow
- quick capture with `Ctrl+Shift+S`
- main panel reopen with `Ctrl+Shift+M`
- overlay answer bubble near the captured area
- recent answer history in the main panel
- configurable model and prompt
- remote approval flow for distributed users

## Auth modes

The app supports two backend modes:

1. direct OpenAI mode
   - a user stores their own OpenAI API key locally
2. remote approval mode
   - the desktop app sends an approval request
   - a WordPress admin approves or blocks the user
   - the app then receives a user session automatically

The approval backend source is included in:

- `wordpress-plugin/`

## Run locally

```powershell
npm install
npm start
```

To run only the local bridge:

```powershell
npm run start:web
```

## Build

Portable EXE:

```powershell
npm run dist:portable
```

Installer EXE:

```powershell
npm run dist:installer
```

Build output is written to `dist/`.

## Local runtime data

Runtime-only data is stored locally and is not committed:

- `.local/`
- API keys and remote session data
- recent local settings

## Important files

- `electron-main.js`: Electron main process
- `app.js`: main panel UI logic
- `overlay.js`: overlay answer UI
- `server.js`: local bridge and remote approval client
- `secure-store.js`: local encrypted secret storage
- `settings-store.js`: local settings persistence
- `wordpress-plugin/`: WordPress backend for approval and remote analysis

## Security notes

- no production secrets should be committed
- runtime keys are expected through local storage or environment variables
- the public repo excludes local state, build outputs, and deployment handoff notes
- if you deploy the WordPress backend, store the OpenAI API key only in WordPress admin settings
