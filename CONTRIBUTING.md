# Contributing

Thanks for looking. The project is small and the bar is simple: a change should keep
`npm run build`, `npm run lint` and `npm test` green, and it should not quietly widen
the permissions the extension asks for.

## Getting set up

```bash
npm install
npm run dev
```

Load `dist/` as an unpacked extension from `chrome://extensions` with Developer mode on.

## Before you open a PR

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

CI runs the same four on every pull request.

## House rules

- **Permissions are a design decision.** Anything beyond the base set belongs in
  `optional_permissions` and must be requested at the moment the user turns the feature on,
  never at install time. A PR that moves a permission into the base set needs a reason in
  the description.
- **No telemetry, ever.** The extension makes no network request the user did not explicitly
  trigger. This is a promise on the store listing, not a preference.
- **Assets must be traceable.** Generate gradients in code, draw mockups yourself, use OFL
  fonts. Add the source and licence to `LICENSES.md` in the same PR.
- **One document model.** Preview and export render from the same `Doc`. If you add a visual
  feature, it goes into the model — not into a preview-only code path.
- **Tests where behaviour is not obvious.** Document model, stitching maths and PII detection
  get unit tests. UI polish does not need them.

## Commits and branches

Branch off `main`, keep the subject line imperative and under ~70 characters. Small PRs get
reviewed faster than large ones; a refactor and a feature in one diff is the usual reason a
review stalls.

## Roadmap

The roadmap lives in the issue tracker. If you want to take something on, open an issue
first so two people do not build the same thing.
