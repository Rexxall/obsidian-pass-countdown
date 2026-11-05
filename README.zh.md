<p align="right"><a href="README.md">English</a></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-zh-dark.svg">
  <img src="assets/readme/hero-zh-light.svg" width="100%" alt="Pass Countdown（多次券倒数）：多次券一天也不浪费，下一张什么时候开一眼知道。一张 52 次、每次 7 天的通行证：还剩 44 次，当前这张剩 6 天 23 小时，并显示下一张最晚什么时候开。">
</picture>

<p align="center"><a href="https://community.obsidian.md/plugins/pass-countdown"><b>在 Obsidian 里安装</b></a></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/demo-dark.gif">
  <img src="assets/readme/demo-light.gif" width="100%" alt="在 Pass Countdown 面板里记录一次激活：窗口先显示新的一张何时到期、之后还剩几次；保存后次数减一，新的 7 天圆环开始走，下一张的最晚开始时间往后推一周。">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/cards-zh-dark.svg">
  <img src="assets/readme/cards-zh-light.svg" width="100%" alt="剩几次一眼看到：次数、剩余时间、节奏。不会叠着用：压掉正在用的，先提醒你。提醒带出去：导出 .ics，到期前提醒。">
</picture>

## 三步上手

1. 在 *设置 → 第三方插件 → 浏览* 里安装并启用 **Pass Countdown**，点左侧栏的票券图标。
2. 在 **设置 → Pass Countdown** 里填名称、总次数、每张几天和截止时间。
3. 每次激活后马上点 **记录激活**。

还没有券？在空面板里点 **载入示例**。

**需要** Obsidian 1.10 或更高，电脑和手机都能用。**花费** 为零：不要账号、不要密钥、不联网。

## 其余内容

<details>
<summary><b>全部功能</b></summary>

**给有期限的多次券倒数：还剩几次、这一张还剩多久、最晚什么时候必须开下一张。**

<img src="docs/screenshots/record.jpg" width="900" alt="记录窗口：开始时间、这张何时到期、之后还剩几次、重叠提醒">

*保存前会显示这张什么时候到期、之后还剩几次，以及会不会和正在用的重叠。*

- **替你记次数。** 有些预付套餐是“N 次、每次 D 天、某天前必须激活”，却查不到用了几次。每次激活记一笔，剩下的交给面板。
- **防止浪费：** 新的一张会和正在用的重叠时提醒你，并算出想在期限前全部用完需要的节奏。
- **到期前提醒，** 在 Obsidian 里提醒，也能导出日历提醒（.ics）。
- **面板：** 剩余次数、当前这张还剩多久、离截止还有几天，以及 **节奏**：想连续用完，最晚什么时候开下一张；已经来不及时，显示还能用上几张。
- **状态栏：** `47/52 · 剩 3 天 4 小时`。
- **日历提醒。** 导出 `.ics`，每张券一个事件，到期前提醒（默认 12 小时、1 小时和到期时），可导入苹果日历、Google 日历或 Outlook。
- **Obsidian 内提醒，** 当前这张快到期时提醒一次，“最晚开下一张”的时间临近时再提醒一次。
- **Bases 倒计时视图。** 在任意 base 里把视图换成“倒计时”：每篇笔记一张卡，显示离某个日期属性（截止日期、考试、签证续签）还有几天，最近的在前，已过的放在下面。再选一个开始日期属性，就能看到进度。没开 Bases 时一切照旧。
- **Markdown 报告：** 可以从带 `activated_at` / `expires_at` 的笔记导入，记错时间可以编辑。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/bases-dark.png">
  <img src="assets/readme/bases-light.png" width="100%" alt="base 里的倒计时视图：每篇笔记一张卡，显示还剩几天；铁路周游券带进度条，已过期的还书日期放在下面。">
</picture>

<img src="docs/screenshots/note-card.jpg" width="900" alt="周记笔记里的多次券卡片">

*在任意笔记里插入 `pass-countdown` 代码块，就能显示同样的卡片，每分钟更新。*

做这个插件的起因是日本 povo2.0 的 7 天无限流量 52 次券（2027 年 8 月 24 日前激活）。同样形状的东西都能用：会过期的健身次卡、回数券、试用期。

**从这里开始（详细）**

1. 安装并启用 **Pass Countdown**，点左侧栏的票券图标。
2. 还没有记录时，点 **载入示例**，用一张虚构的券看看倒计时、圆环和节奏。示例不会被导出，也不会提醒；点 **删除示例** 一键删掉。
3. 在 **设置 → Pass Countdown** 里填名称、总次数、每张几天和截止时间。
4. 每次激活后马上点 **记录激活**。

</details>

<details>
<summary><b>数据去哪里、插件会碰什么</b></summary>

| | |
|---|---|
| Obsidian | 1.10 或更高，电脑和手机都能用（1.8、1.9 停在 1.4.1） |
| 插件本身 | 免费，MIT 许可 |
| 联网 | 不联网。插件不发任何网络请求，不需要账号和密钥。 |

哪儿也不去。记录在库里插件的 `data.json` 里，报告和 `.ics` 文件写在你指定的位置。需要的话只存一个简短标签，不要存完整的兑换码。

- **读：** 自己的 `data.json`；首次启动且没有数据时，读一次它前身旧插件（`povo-7day-tracker`）的 `data.json`（有的话）；只在你运行导入时，读你指定文件夹里笔记的 frontmatter。
- **写：** 自己的 `data.json`；只在你导出时，按设置里的路径写报告笔记和 `.ics` 文件（默认 `Pass Countdown/report.md` 和 `Pass Countdown/reminders.ics`）。两个路径都在库里，同名文件会被覆盖。
- **从不：** 联网、用剪贴板、运行其他程序、读写库外的文件。

</details>

<details>
<summary><b>手动安装和设置示例</b></summary>

**在 Obsidian 里（上架后）：** 设置 → 第三方插件 → 浏览，搜索 **Pass Countdown**。PKMer 会自动同步官方目录。

**手动：** 从最新版本下载 `main.js`、`manifest.json`、`styles.css`，放进 `<库>/.obsidian/plugins/pass-countdown/`，重新加载后启用。

**核验下载：** 从 1.4.1 起，Release 附件由 GitHub Actions 构建并附构建来源认证，可以用 `gh attestation verify main.js --repo Rexxall/obsidian-pass-countdown` 核验。

**例子：povo2.0 7 天流量（52 次）。** 这就是默认设置：52 次，每次 7 天，截止 `2027-08-24T23:59:00+09:00`。具体条款以你自己的购买记录为准。

</details>

<details>
<summary><b>原理</b></summary>

- 时间按 UTC 保存、按本地时间显示，出差或改系统时区都不会让券错位。
- **截止时间** 默认指最后一次可以*激活*的时刻；截止前刚开的券照样用满整段。如果券也必须在截止前*用完*，在设置里改“截止时间是指”，所有时间会提前一张券的长度。
- *最晚开下一张* = 截止时间 −（剩余次数 − 1）× 每张天数。来不及全部开完时，“节奏”变橙色。

</details>

<details>
<summary><b>已知限制</b></summary>

- 一个库只管一种券。
- 手机上的提醒靠导入 `.ics` 的日历；记了新的激活后要重新导出。
- Obsidian 内的提醒只在 Obsidian 打开时出现。

</details>

<details>
<summary><b>开发和更新记录</b></summary>

构建、检查命令和提 issue 的方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

**1.5.0：** Bases“倒计时”视图：每篇笔记一张卡，显示离日期属性还有几天。需要 Obsidian 1.10。

**1.4.0：** 社区目录的自动审查不再有提示，外观不变。

**1.3.0：** 新面板可以载入示例；界面语言改用 Obsidian 的 `getLanguage()` 判断；README 分中英文两份。完整记录见 [CHANGELOG.md](CHANGELOG.md)。

</details>

MIT 许可
