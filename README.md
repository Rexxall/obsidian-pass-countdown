<div align="center">

# Pass Countdown

**Count down a multi-use pass: uses left, time left on the current one, and whether you can still use them all before the deadline.**

多次券倒数：还剩几次、这一张还剩多久、按现在的节奏能不能在期限前用完。

[Features](#features) · [Install](#install) · [Privacy](#privacy) · [中文说明](#中文说明) · [日本語](#日本語)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/panel-dark.jpg">
  <img src="docs/screenshots/panel.jpg" width="860">
</picture>

</div>

## Why

Some prepaid bundles give you a number of uses, each lasting a fixed time, and a last date to activate them. The one that started this plugin is a Japanese mobile data bundle: one prepaid code good for 52 uses of 7-day unlimited data, to be entered by 24 August 2027. The provider says the number of uses cannot be checked and asks you to keep count yourself, and it is easy to waste days or to start a new pass while the old one is still running.

Pass Countdown keeps that count in Obsidian. It works for any pass with the same shape: gym visits that expire, ticket books, trial periods.

## Features

- **Record an activation** with its start time (defaults to now) and an optional label. The end time is worked out for you.
- **Overlap warning** if the pass you are about to record would run at the same time as one that is still active.
- **Dashboard:** uses left, time left on the current pass, days to the deadline, and **pace**: how many days you have per remaining use, and the latest moment to start the next pass if you want to use every one back to back. Once that moment has passed, it tells you how many can still fit.
- **Status bar:** `47/52 · 3 d 4 h left`.
- **Calendar reminders.** Export an `.ics` file with one event per pass and alerts before it ends (12 h, 1 h and at the end by default). Open it to add the reminders to Apple Calendar, Google Calendar or Outlook.
- **Markdown report** of every activation, for your records.
- **Import** activations from existing notes that have `activated_at` / `expires_at` in their frontmatter.

<img src="docs/screenshots/record.jpg" width="860">

## Install

1. Download `obsidian-pass-countdown-1.0.0.zip` from the latest release.
2. Unzip it into `<your vault>/.obsidian/plugins/pass-countdown/`.
3. **Settings → Community plugins**, reload, enable **Pass Countdown**.
4. **Settings → Pass Countdown:** set the name, total uses, days per pass and the deadline.

Desktop and mobile.

### Example: povo2.0 7-day data (52 uses)

This is the default setup: 52 uses, 7 days each, deadline `2027-08-24T23:59:00+09:00`. Check your own purchase for the exact terms.

## Privacy

Everything stays in your vault: records in this plugin's `data.json`, exports where you choose. The plugin makes no network requests. Store a short label if you need one, never the full prepaid code.

## How it works

- Times are stored in UTC and shown in your local time, so travelling or a different system time zone does not shift a pass.
- *Latest next start* = deadline − (uses left − 1) × days per pass. If you start later than that, at least one pass cannot run in full before the deadline.
- *Pace* turns orange when the remaining passes no longer fit before the deadline back to back.

Build from source:

```bash
npm install
npm run build
npm test   # 10 tests: end times, pace, overlap, .ics, report escaping, import
```

## Known limits

- One pass type per vault.
- Reminders reach your phone through the calendar you import the `.ics` into; re-export after recording new passes.

## Changelog

**1.0.0** — First public release. Replaces two private single-purpose trackers: any number of uses and days, local-time input, overlap warning, pace, `.ics` reminders, report, and import from notes.

## License

MIT

---

## 中文说明

有些预付套餐是“N 次、每次 D 天、某天前必须用完”。做这个插件的起因是日本 povo2.0 的 7 天无限流量 52 次券（一个兑换码可用 52 次）：官方写明查不到已用次数、请自己管理，还容易浪费天数，或者在上一张没到期时就开了下一张。

- **记录一次激活：** 默认当前时间，可加简短标签，到期时间自动计算；与仍在生效的券重叠时提醒。
- **面板：** 剩余次数、当前这张还剩多久、离截止还有几天，以及节奏：剩下每次平均能分到几天、想全部用完最晚什么时候开下一张；已经来不及时，显示还能用上几张。
- **状态栏、日历提醒（.ics，默认到期前 12 小时、1 小时和到期时）、Markdown 报告、从笔记导入。**
- **隐私：** 数据只在库里，不联网。不要存完整的兑换码。

## 日本語

「N 回分・1 回 D 日間・期限あり」の回数券を数えるプラグインです。きっかけは povo2.0 の「データ使い放題(7日間)52回分」で、使った回数を公式で確認できないため、自分で管理する必要がありました。

- **記録：** 開始時刻（初期値は現在）と短いラベル。終了時刻は自動計算し、まだ有効な回と重なると警告します。
- **ダッシュボード：** 残り回数、今の回の残り時間、期限までの日数、ペース（残り 1 回あたりの日数と、全部使い切るための次回開始の最終時刻。間に合わない場合は、あと何回使えるか）。
- **ステータスバー、カレンダー通知（.ics）、Markdown レポート、ノートからの取り込み。**
- **プライバシー：** データは保管庫の中だけで、通信は行いません。コード全体は保存しないでください。
