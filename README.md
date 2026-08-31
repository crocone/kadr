# Kadr

Page capture, a screenshot beautifier and a click-to-guide recorder for Chromium
browsers. Every editor feature is free and works offline. Nothing is behind a trial, a watermark
or a PRO lock.

## What it is meant to be

|             |                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Capture     | Full page, visible area, drag-selected region, DOM element, and a scrolling capture that stitches a chat or a virtualised feed by content instead of coordinates. Inner scroll containers, responsive series |
| Editor      | One Konva document renders both the preview and the export, so what you see is what you get. Undo/redo covers the whole document, not just the drawing panel                                                 |
| Annotations | Numbered step badges, seven arrow styles, spotlight, highlight, and blur that stays a movable layer instead of burning into pixels                                                                           |
| Privacy     | No telemetry. No backend. Screenshots stay on the device unless you explicitly run an AI action with your own key                                                                                            |
| AI          | Bring your own key — Anthropic, OpenAI, Google, or any OpenAI-compatible endpoint including a local Ollama or LM Studio. A key-free local OCR mode covers PII redaction offline                              |

## Install from source

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**
and pick the `dist/` folder.

For a dev loop with hot reload:

```bash
npm run dev
```

Load `dist/` the same way; Vite rebuilds and reloads the extension on save.

## Commands

| Command              | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Vite dev server with extension HMR                     |
| `npm run build`      | Type-check, then build `dist/`                         |
| `npm run typecheck`  | TypeScript, no emit                                    |
| `npm run lint`       | ESLint over the whole repo                             |
| `npm run format`     | Prettier write                                         |
| `npm test`           | Vitest run                                             |
| `npm run test:e2e`   | Build, then Playwright scenarios against a real Chrome |
| `npm run zip`        | Package `dist/` into `release/kadr-<version>.zip`      |
| `npm run zip:source` | Package the sources into `release/kadr-<v>-source.zip` |

## Layout

```
src/
├─ background/   service worker: hotkeys, context menus, capture orchestration
├─ content/      injected on demand: selection overlays, page metrics, scrolling
├─ offscreen/    clipboard, video recording, heavy rendering outside the worker
├─ popup/        capture modes, recording, recent shots
├─ editor/       React + Konva scene, panels, export
├─ library/      the shot library: search, tags, reopening a document
├─ welcome/      the one-time onboarding page, opened on install
├─ options/      AI keys, defaults, integrations
└─ core/
   ├─ capture/   stitcher · cdp · page metrics · dpr · cleanup
   ├─ record/    tabCapture · event timeline · WebCodecs · gifenc
   ├─ doc/       document model, history, serialisation
   ├─ render/    Konva layers, filters, PNG/JPEG/WebP/PDF export
   ├─ ai/        providers, prompts, JSON schemas, cache, spend counter
   ├─ trackers/  GitHub · Linear · Jira, on the user's own token
   ├─ storage/   IndexedDB · OPFS for video · presets
   └─ i18n/      ru · en
```

## Permissions

The base install asks for `activeTab`, `scripting`, `storage`, `unlimitedStorage`,
`downloads`, `offscreen` and `contextMenus` — no host permissions. `activeTab` is granted
by clicking the toolbar icon, a context-menu item or pressing a hotkey, which happens to
be every way capture starts.

Everything heavier is optional and requested only when the matching feature is switched on:
`tabCapture` / `desktopCapture` for recording, `tabs` for multi-tab batch capture, and host
access for the issue tracker you configured — asked for at the moment you press Send.

## Release

A `v*` tag runs the release workflow: it checks the tag against `package.json`, builds, and
attaches both the extension package and the source archive to a GitHub release. The same
package goes to the Chrome Web Store, Opera Add-ons and Edge Add-ons — listing texts and the
submission checklist live in [store/](store), the privacy policy in [docs/](docs).

## Licence

MIT — see [LICENSE](LICENSE). Asset provenance is tracked in [LICENSES.md](LICENSES.md).
