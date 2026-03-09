# ScreenExplain

ScreenExplain is a Windows desktop app for quick on-screen AI help.

The app is built around `quick mode`:
- stays available from the system tray
- captures a dragged region on the current monitor
- shows a short answer bubble near the selected area
- stores recent answers in the settings panel

## Current Product Shape

- Quick mode is the default workflow.
- The main window is now a settings and history panel.
- Old manual screen-share / detailed analysis flow has been removed.

## Main Features

- System tray based quick mode
- Global shortcut capture: `Ctrl+Shift+S`
- Return to main panel: `Ctrl+Shift+M`
- Region-based answer bubble overlay
- Saved prompt applied to every capture
- OpenAI API key saved locally for the current Windows user
- Model selection
- Token usage summary
- Recent answer history, including quick mode answers

## Run Locally

```powershell
npm install
npm start
```

## OpenAI Setup

Use the `OpenAI 연결` section inside the app:

1. Enter your API key
2. Click `키 저장`
3. Optionally click `연결 테스트`

The API key is stored locally using Windows user-scoped protection.

## Quick Mode

Default usage flow:

1. Launch the app
2. Enable quick mode if needed
3. Press `Ctrl+Shift+S`
4. Drag over the area you want to analyze
5. Read the answer bubble
6. Right-click or press `Esc` to close the overlay

Quick mode answers are also written into `최근 답변`.

## Saved Prompt

The `저장 프롬프트` section defines the instruction that is always combined with each capture.

If the saved prompt is empty, the app uses its built-in default prompt:

`이 화면에서 사용자가 지금 바로 알아야 할 핵심 내용을 짧고 정확하게 설명해줘. 문제 풀이처럼 보이면 정답과 핵심 근거를 먼저 말해줘.`

## Build

Portable EXE:

```powershell
npm run dist:portable
```

Installer EXE:

```powershell
npm run dist:installer
```

Build outputs are created in `dist/`.

## Important Local Files

- `electron-main.js`: Electron main process
- `app.js`: settings panel UI logic
- `overlay.js`: quick mode overlay interaction
- `server.js`: local API bridge to OpenAI Responses API
- `secure-store.js`: encrypted local API key storage
- `settings-store.js`: local app settings storage
