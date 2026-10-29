# Changelog

## 1.3.0

- **A sample pass** for a new panel: one made-up pass shows the countdown, ring and pace; it is never exported or reminded about, and is removed in one click.
- The interface language is read with Obsidian's `getLanguage()`; requires Obsidian 1.8.7.
- README in English and Chinese, with a result picture first, a start-here list and what the plugin needs (no network, no account).

## 1.2.0

- New look in the style of current Apple apps: solid cards and grouped lists for content, a glass header bar and glass dialogs, rounded numbers, a ring for the running pass. It follows your theme, accent colour and light or dark mode, and turns the glass solid when the system asks for reduced transparency. The paper style option is gone.
- README: the deadline is the last moment to *activate* a pass, as the code has always counted it.
- A second deadline mode for passes that must also end by the deadline.
- Data from the single-purpose povo tracker this plugin grew out of (`povo-7day-tracker`) is imported on first start; its Apple Reminders settings are dropped.
- Pass card for notes: a `pass-countdown` code block, plus a command to insert it.
- Edit a recorded activation (start time, label, note).
- One-time reminders inside Obsidian before the running pass ends and before the latest start that still fits every pass.
- Settings in groups (Reminders, Exports, Appearance). On Obsidian 1.13 and later they show up in settings search.
- Import checks that the folder exists; reports and calendar files are written atomically.
- Chinese interface when Obsidian is set to Chinese; English otherwise.
- Edit and delete in the history appear when you point at a row (always shown on touch screens).
- The pass card in notes matches the panel: the big count with a bar, then the running pass and the next start date.

## 1.1.0

- New panel layout: the number left comes first, with one dot per use; the running pass shows how long it has left; one line says when the next one has to start.
- The record dialog shows when the pass will end and how many will be left before you save.
- Optional **Paper & ink style** in settings (paper background, ink lines, serif numbers). Off by default, so the panel follows your theme.
- Styles rewritten from scratch on a small shared style kit.

## 1.0.0

- First public release. Replaces two private single-purpose trackers: any number of uses and days, local-time input, overlap warning, pace, `.ics` reminders, report, and import from notes.
