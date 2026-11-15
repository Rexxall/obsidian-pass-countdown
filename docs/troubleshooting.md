Copy the prompt for your problem into your AI coding assistant, replacing `<vault>` with your vault folder.

## The panel does not open

```text
Pass Countdown's ticket icon does not open the panel. Help me find and fix the cause.
You may inspect and change only <vault>/.obsidian/plugins/pass-countdown/. If needed, read only the note I name. Do not access other plugins or notes, or change any note. Stop and ask before deleting anything.
Ask me to confirm that Pass Countdown is enabled and Obsidian is 1.10 or later. Inspect manifest.json, main.js and styles.css in the allowed folder, view registration, and any startup error I provide. Ask me to try the Open tracker command. Do not reset data.json or my workspace. If the old povo-7day-tracker is involved, ask me about its state without accessing its folder.
To confirm the fix, have me open the panel with the ticket icon and with Open tracker. Both should show the countdown for my existing records, or Load a sample when there are no records. Repeat after restarting Obsidian and confirm that the record count is unchanged.
```

## The remaining count or times look wrong

```text
Pass Countdown shows the wrong remaining count, end time or latest next start. Help me find and fix the cause.
You may inspect and change only <vault>/.obsidian/plugins/pass-countdown/. If needed, read only the note I name. Do not access other plugins or notes, or change any note. Stop and ask before deleting anything.
Check totalUses, passDays, deadline, deadlineMode and the records in data.json, including sample records. Compare the start and expiry times with the values I supply. Times are stored in UTC and shown locally. In activate mode, latest next start is deadline minus (remaining uses minus one) times passDays. In finish mode, first subtract one pass duration from the deadline. Check duplicate or overlapping records without deleting them, and preserve all activation history.
To confirm the fix, compare the panel with the saved records: remaining uses should equal max(totalUses minus record count, 0), and an active record should end at its saved expiry time in my local time zone. With uses remaining, verify the latest next start by the formula for the selected deadline mode. Reopen the panel and confirm the same values.
```

## Reminders are missing

```text
Pass Countdown does not show an in-app reminder or its exported calendar reminder is missing. Help me find and fix the cause.
You may inspect and change only <vault>/.obsidian/plugins/pass-countdown/. If needed, read only the note I name. Do not access other plugins or notes, or change any note. Stop and ask before deleting anything.
Check inAppReminders, reminderLeadHours, reminderOffsets, icsPath, notified keys and the reminder and .ics generation logic in the allowed folder. Samples are excluded from exports and reminders. In-app notices appear only while Obsidian is open, once per reminder. Calendar reminders require exporting and importing the .ics again after new activations. Do not clear notification history, inspect calendar files outside the allowed folder, or change a calendar application.
To confirm the fix, have me keep Obsidian open for the next eligible, not-yet-shown reminder on a real record; it should appear once. For calendar reminders, have me export to a new unused .ics path and import it myself, then check that a real recorded pass has the saved start/end times and the configured alerts (12 hours, 1 hour and at expiry by default). Exporting writes a file, so I will perform that step. If no reminder is due yet, report that the live notification check is pending.
```

## Countdown is missing or empty in Bases

```text
Pass Countdown is missing from the Bases view menu, or its Countdown view has no cards. Help me find and fix the cause.
You may inspect and change only <vault>/.obsidian/plugins/pass-countdown/. If needed, read only the note I name. Do not access other plugins or notes, or change any note. Stop and ask before deleting anything.
Ask me to confirm Obsidian is 1.10 or later, Pass Countdown is enabled, and the Bases core plugin is enabled. Inspect this plugin’s Bases registration and date parsing. Ask me which end-date and optional start-date properties the view uses. Notes without a usable date are omitted. Ask me to show the view options; do not read or change the base configuration or other plugins. After Bases is enabled, registration retries every few seconds.
To confirm the fix, have me reopen a base and select Countdown. In view options I will choose the date property on the named note. Its card should show the time remaining to that date. If a valid start property is selected, it should also show progress. With no custom sort, upcoming cards should be soonest first, with past dates below when Show past is enabled.
```

Still stuck? [Open an issue](https://github.com/Rexxall/obsidian-pass-countdown/issues/new/choose).
