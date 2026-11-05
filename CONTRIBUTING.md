# Contributing

```bash
npm ci
npm run build   # styles.css from styles/, type-check, then src/ -> main.js
npm run lint    # Obsidian's lint rules, the directory's typed scorecard checks, stylelint
npm test        # bundles tests/core.test.ts with esbuild and runs it
```

The tests cover the logic in `src/core.ts`: end times, pace, overlap, `.ics`, report escaping, import, editing, reminders and migration. `styles.css` is generated: edit `styles/plugin.css`, run `npm run styles` and commit both. Versions are in [CHANGELOG.md](CHANGELOG.md).

The README promises that the plugin works offline and keeps everything in the vault (*Where your data goes*). Open an issue first for any change that would alter that.

CI runs lint, tests and a build on Node 20 and 22 for every push to `main` and every pull request, and fails if the build changes the committed `styles.css` or `manifest.json`. Pushing a version tag such as `1.4.1` runs the release workflow: it checks the tag against `manifest.json`, `package.json`, `package-lock.json` and `versions.json`, runs the same checks, attests `main.js`, `manifest.json` and `styles.css`, and creates the release with that version's CHANGELOG section as its notes.

Before a release, check startup time: reload Obsidian with the plugin enabled and time its `onload`. It should stay under 50 ms on a vault with a year of data. Anything that reads many files, calls the network or renders waits for `onLayoutReady` or runs on first use.

## Issues

Report bugs and ideas in [GitHub Issues](https://github.com/Rexxall/obsidian-pass-countdown/issues). For a wrong count or time, include the plugin and Obsidian versions, your settings (total uses, days per pass, deadline and what the deadline means) and your time zone. Never paste a prepaid code.
