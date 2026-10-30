import { App, ItemView, MarkdownRenderChild, Modal, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, TFile, Vault, WorkspaceLeaf, getLanguage, normalizePath, setIcon } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MS_DAY,
	PassData,
	PassRecord,
	PassSettings,
	PassStats,
	buildIcs,
	buildMarkdownReport,
	computeStats,
	createRecord,
	dueReminders,
	editRecord,
	normalizeData,
	overlappingRecords,
	parseDate,
	recordFromFrontmatter,
	sortRecords,
	SAMPLE_PREFIX,
	isSample,
	withoutSamples
} from './core';
import { isZh, tr } from './i18n';

const VIEW_TYPE = 'pass-countdown-view';
const CODE_BLOCK = 'pass-countdown';
const OLD_TRACKER_ID = 'povo-7day-tracker';
const FRONTMATTER_FIELDS = ['activated_at', 'expires_at', 'activation_id'];

/** Follows the Obsidian interface language rather than the system locale. */
function formatDateTime(date: Date): string {
	return date.toLocaleString(getLanguage(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Month, day and time only; the year is shown when it is not this year. */
function formatShort(date: Date): string {
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleString(getLanguage(), { year: sameYear ? undefined : 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
	return date.toLocaleDateString(getLanguage(), { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDuration(ms: number): string {
	const zh = isZh();
	if (ms <= 0) return zh ? '0 分钟' : '0 min';
	const days = Math.floor(ms / MS_DAY);
	const hours = Math.floor((ms % MS_DAY) / 3_600_000);
	if (days > 0) return zh ? `${days} 天 ${hours} 小时` : `${days} d ${hours} h`;
	const minutes = Math.floor((ms % 3_600_000) / 60_000);
	if (zh) return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
	return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/** Value for <input type="datetime-local"> in the user's local time. */
function toLocalInput(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function newId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default class PassCountdownPlugin extends Plugin {
	data: PassData;
	private statusBar: HTMLElement | null = null;
	/** Pass cards embedded in notes, redrawn with the panel. */
	readonly embeds = new Set<() => void>();

	async onload() {
		const saved: unknown = await this.loadData();
		const imported = saved ? null : await this.importFromOldTracker();
		this.data = normalizeData(saved ?? imported);
		if (imported) {
			await this.saveData(this.data);
			this.app.workspace.onLayoutReady(() => new Notice(tr(
				`Pass Countdown: imported ${this.data.records.length} activations from the old povo tracker. Disable it once everything looks right.`,
				`Pass Countdown：已从旧版 povo 计数插件导入 ${this.data.records.length} 条激活记录。确认无误后可以停用旧插件。`
			), 0));
		}

		this.registerView(VIEW_TYPE, leaf => new PassCountdownView(leaf, this));
		this.addRibbonIcon('ticket', tr('Open pass countdown', '打开通行证倒计时'), () => void this.activateView());

		this.addCommand({ id: 'open', name: tr('Open tracker', '打开倒计时面板'), callback: () => void this.activateView() });
		this.addCommand({ id: 'record', name: tr('Record an activation', '记录一次激活'), callback: () => new RecordModal(this.app, this).open() });
		this.addCommand({ id: 'export-ics', name: tr('Export reminders (.ics)', '导出提醒（.ics）'), callback: () => void this.exportIcs() });
		this.addCommand({ id: 'export-report', name: tr('Export Markdown report', '导出 Markdown 报告'), callback: () => void this.exportReport() });
		this.addCommand({ id: 'import-notes', name: tr('Import activations from notes in a folder', '从文件夹里的笔记导入激活记录'), callback: () => new ImportModal(this.app, this).open() });
		this.addCommand({
			id: 'insert-card',
			name: tr('Insert pass card into the current note', '在当前笔记插入通行证卡片'),
			editorCallback: editor => editor.replaceSelection(`\`\`\`${CODE_BLOCK}\n\`\`\`\n`)
		});

		this.registerMarkdownCodeBlockProcessor(CODE_BLOCK, (_source, el, ctx) => {
			const child = new PassEmbed(el, this);
			ctx.addChild(child);
		});

		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass('pass-countdown-status');
		this.updateStatusBar();
		this.registerInterval(window.setInterval(() => { this.refreshAll(); void this.checkReminders(); }, 60_000));
		this.app.workspace.onLayoutReady(() => void this.checkReminders());

		this.addSettingTab(new PassCountdownSettingTab(this.app, this));
	}

	/** The tracker this plugin grew out of had the id "povo-7day-tracker"; its data is read once when this one has none. */
	private async importFromOldTracker(): Promise<unknown> {
		const path = normalizePath(`${this.app.vault.configDir}/plugins/${OLD_TRACKER_ID}/data.json`);
		try {
			if (!(await this.app.vault.adapter.exists(path))) return null;
			return JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
		} catch (error) {
			console.error('Pass Countdown: could not read the old tracker data.', error);
			return null;
		}
	}

	async save() {
		await this.saveData(this.data);
		this.refreshAll();
	}

	stats(): PassStats {
		return computeStats(this.data, new Date());
	}

	refreshAll() {
		this.updateStatusBar();
		this.embeds.forEach(render => render());
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof PassCountdownView) leaf.view.render();
		}
	}

	updateStatusBar() {
		if (!this.statusBar) return;
		const stats = this.stats();
		const left = stats.activeEndsAt ? formatDuration(stats.activeEndsAt.getTime() - Date.now()) : '';
		const active = left ? ` · ${tr(`${left} left`, `剩 ${left}`)}` : '';
		this.statusBar.setText(`${stats.remaining}/${stats.total}${active}`);
		this.statusBar.setAttr('aria-label', `${this.data.settings.passName}: ${tr(`${stats.remaining} of ${stats.total} left`, `共 ${stats.total} 次，剩 ${stats.remaining} 次`)}`);
	}

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async addRecord(record: PassRecord) {
		this.data.records.push(record);
		await this.save();
	}

	async updateRecord(record: PassRecord) {
		this.data.records = this.data.records.map(existing => existing.id === record.id ? record : existing);
		await this.save();
	}

	/** Show each due reminder once, while Obsidian is open. */
	async checkReminders() {
		const due = dueReminders(withoutSamples(this.data), new Date());
		if (due.length === 0) return;
		const name = this.data.settings.passName;
		for (const reminder of due) {
			const when = formatDateTime(reminder.at);
			const message = reminder.kind === 'ending'
				? tr(`${name}: the current pass ends ${when}.`, `${name}：当前这张 ${when} 到期。`)
				: tr(`${name}: start the next pass by ${when} to use every one before the deadline.`, `${name}：最晚 ${when} 激活下一张，才能在截止前全部用完。`);
			new Notice(message, 0);
			this.data.notified.push(reminder.key);
		}
		this.data.notified = this.data.notified.slice(-200);
		await this.saveData(this.data);
	}

	/** One pass started two days ago, so the countdown, ring and pace show at once. */
	async loadSample() {
		const start = new Date(Date.now() - 2 * MS_DAY);
		const end = new Date(start.getTime() + this.data.settings.passDays * MS_DAY);
		this.data.records.push({ id: `${SAMPLE_PREFIX}${start.getTime()}`, activatedAt: start.toISOString(), expiresAt: end.toISOString(), label: tr('Sample', '示例'), note: tr('Sample record, remove it any time', '示例记录，随时可删'), createdAt: new Date().toISOString() });
		await this.save();
	}

	async removeSamples() {
		this.data.records = this.data.records.filter(record => !isSample(record));
		await this.save();
		new Notice(tr('Sample removed.', '示例已删除。'));
	}

	async removeRecord(id: string) {
		this.data.records = this.data.records.filter(record => record.id !== id);
		await this.save();
	}

	async writeVaultFile(path: string, content: string): Promise<string> {
		const target = normalizePath(path);
		const folder = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '';
		if (folder && !this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
		const existing = this.app.vault.getFileByPath(target);
		if (existing) await this.app.vault.process(existing, () => content);
		else await this.app.vault.create(target, content);
		return target;
	}

	async exportIcs() {
		const path = await this.writeVaultFile(this.data.settings.icsPath, buildIcs(withoutSamples(this.data), new Date()));
		new Notice(tr(`Saved ${path}. Open it to add the reminders to your calendar.`, `已保存 ${path}。打开它即可把提醒加入日历。`));
	}

	async exportReport() {
		const path = await this.writeVaultFile(this.data.settings.reportPath, buildMarkdownReport(withoutSamples(this.data), new Date(), formatDateTime));
		const file = this.app.vault.getFileByPath(path);
		if (file) await this.app.workspace.getLeaf(true).openFile(file);
	}

	/** Returns null when the folder does not exist. */
	async importFromFolder(folderPath: string): Promise<number | null> {
		const folder = this.app.vault.getFolderByPath(normalizePath(folderPath));
		if (!folder) return null;
		const files: TFile[] = [];
		Vault.recurseChildren(folder, child => { if (child instanceof TFile && child.extension === 'md') files.push(child); });
		const known = new Set(this.data.records.map(record => record.id));
		let added = 0;
		for (const file of files) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const record = recordFromFrontmatter(fm, file.basename, this.data.settings);
			if (!record || known.has(record.id)) continue;
			this.data.records.push(record);
			known.add(record.id);
			added++;
		}
		if (added > 0) await this.save();
		return added;
	}
}

class PassCountdownView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: PassCountdownPlugin) {
		super(leaf);
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return tr('Pass countdown', '通行证倒计时'); }
	getIcon() { return 'ticket'; }

	async onOpen() { this.render(); }

	render() {
		const root = this.contentEl;
		root.empty();
		root.addClass('pass-countdown', 'ap', 'ap-view');
		const { settings } = this.plugin.data;
		const stats = this.plugin.stats();
		const now = Date.now();
		const records = sortRecords(this.plugin.data.records, 'asc');
		const activeIndex = stats.active ? records.findIndex(record => record.id === stats.active?.id) : -1;

		// Glass bar: the panel scrolls under it.
		const head = root.createDiv({ cls: 'ap-head ap-bar-glass' });
		const headMain = head.createDiv({ cls: 'ap-head-main' });
		headMain.createDiv({ cls: 'ap-eyebrow', text: tr('Pass countdown', '通行证倒计时') });
		headMain.createDiv({ cls: 'ap-title', text: settings.passName });
		const actions = head.createDiv({ cls: 'ap-head-actions' });
		actions.createSpan(statePill(stats));
		const reportBtn = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': tr('Export Markdown report', '导出 Markdown 报告') } });
		setIcon(reportBtn, 'file-text');
		reportBtn.onclick = () => void this.plugin.exportReport();

		const stack = root.createDiv({ cls: 'ap-stack' });

		// How many are left: the one number this tool exists for.
		leftCard(stack.createDiv({ cls: 'ap-card pc-left' }), stats);

		// The pass that is running now, with a ring for the time it has left.
		const current = stack.createDiv({ cls: 'ap-card is-inset pc-current' });
		const currentMain = current.createDiv({ cls: 'pc-current-main' });
		if (stats.active && stats.activeEndsAt) {
			const start = parseDate(stats.active.activatedAt);
			const end = stats.activeEndsAt;
			currentMain.createDiv({ cls: 'ap-eyebrow', text: `${tr('Current pass', '当前这张')} · #${activeIndex + 1}` });
			const value = currentMain.createDiv({ cls: 'pc-current-time' });
			if (isZh()) value.appendText('还剩 ');
			value.createSpan({ cls: 'pc-duration', text: formatDuration(end.getTime() - now) });
			if (!isZh()) value.appendText(' left');
			currentMain.createDiv({ cls: 'ap-cap', text: tr(`Ends ${formatShort(end)}`, `${formatShort(end)} 到期`) });
			const span = start ? end.getTime() - start.getTime() : 0;
			this.ring(current, span > 0 ? (end.getTime() - now) / span : 0);
		} else {
			currentMain.createDiv({ cls: 'ap-eyebrow', text: tr('Current pass', '当前这张') });
			currentMain.createDiv({ cls: 'pc-current-time', text: tr('No active pass', '没有正在使用的') });
			currentMain.createDiv({ cls: 'ap-cap', text: tr('Record one right after you activate it.', '激活后马上记一笔。') });
		}

		this.paceCallout(stack, stats);

		const buttons = stack.createDiv({ cls: 'ap-actions pc-buttons' });
		const recordBtn = buttons.createEl('button', { text: tr('Record activation', '记录激活'), cls: 'mod-cta ap-wide pc-record' });
		recordBtn.disabled = stats.remaining <= 0;
		recordBtn.onclick = () => new RecordModal(this.app, this.plugin).open();
		const icsBtn = buttons.createEl('button', { text: tr('Export .ics', '导出 .ics'), attr: { 'aria-label': tr('Export reminders (.ics)', '导出提醒（.ics）') } });
		icsBtn.onclick = () => void this.plugin.exportIcs();

		const section = stack.createDiv({ cls: 'ap-section pc-history' });
		section.createDiv({ cls: 'ap-section-title', text: tr('History', '记录') });
		if (records.length === 0) {
			const empty = section.createDiv({ cls: 'ap-group ap-empty' });
			empty.createDiv({ cls: 'ap-empty-title', text: tr('No activations yet', '还没有激活记录') });
			empty.createDiv({ cls: 'ap-empty-text', text: tr('Record a pass right after you activate it, and the countdown starts. To look around first, load a sample pass; it is never exported and can be removed in one click.', '激活后马上记一笔，倒计时就开始了。想先看看效果，可以载入一条示例，它不会被导出，一键就能删。') });
			empty.createEl('button', { text: tr('Load a sample', '载入示例'), cls: 'pc-load-sample' }).onclick = () => void this.plugin.loadSample();
			return;
		}
		if (records.some(isSample)) {
			const banner = section.createDiv({ cls: 'ap-notice pc-sample-banner' });
			banner.createSpan({ cls: 'ap-grow', text: tr('A sample record is shown. It is never exported or reminded about.', '正在显示示例记录，它不会被导出，也不会提醒。') });
			banner.createEl('button', { text: tr('Remove sample', '删除示例') }).onclick = () => void this.plugin.removeSamples();
		}
		const list = section.createDiv({ cls: 'ap-group' });
		[...records].reverse().forEach((record, i) => {
			const start = parseDate(record.activatedAt);
			const end = parseDate(record.expiresAt);
			const isActive = !!start && !!end && start.getTime() <= now && end.getTime() > now;
			const row = list.createDiv({ cls: `ap-row pc-row${isActive ? ' is-active' : ''}` });
			row.createSpan({ cls: 'pc-row-index ap-num', text: `#${records.length - i}` });
			const body = row.createDiv({ cls: 'ap-row-main' });
			body.createDiv({ cls: 'ap-row-title ap-num', text: `${start ? formatShort(start) : '—'} → ${end ? formatShort(end) : '—'}` });
			const extra = [record.label, record.note].filter(Boolean).join(' · ');
			if (extra) body.createDiv({ cls: 'ap-row-desc pc-row-note', text: extra });
			if (isActive) row.createSpan({ cls: 'ap-pill is-good', text: tr('Active', '使用中') });
			// Shown on hover or keyboard focus; always shown on touch screens.
			const rowActions = row.createDiv({ cls: 'ap-row-actions' });
			const edit = rowActions.createEl('button', { cls: 'pc-row-edit clickable-icon', attr: { 'aria-label': tr('Edit record', '编辑') } });
			setIcon(edit, 'pencil');
			edit.onclick = () => new RecordModal(this.app, this.plugin, record).open();
			const del = rowActions.createEl('button', { cls: 'pc-row-delete clickable-icon', attr: { 'aria-label': tr('Delete record', '删除') } });
			setIcon(del, 'trash-2');
			let armed = false;
			del.onclick = () => {
				if (!armed) {
					armed = true;
					del.addClass('is-armed');
					rowActions.addClass('is-pinned');
					del.setAttr('aria-label', tr('Click again to delete', '再点一次删除'));
					window.setTimeout(() => { armed = false; del.removeClass('is-armed'); rowActions.removeClass('is-pinned'); del.setAttr('aria-label', tr('Delete record', '删除')); }, 4000);
					return;
				}
				void this.plugin.removeRecord(record.id);
			};
		});
	}

	/** Ring for the share of the current pass that is still left. */
	private ring(parent: HTMLElement, ratio: number) {
		const circumference = 2 * Math.PI * 15;
		const wrap = parent.createDiv({ cls: 'pc-ring', attr: { 'aria-hidden': 'true' } });
		const svg = wrap.createSvg('svg', { attr: { viewBox: '0 0 36 36' } });
		svg.createSvg('circle', { cls: 'pc-ring-bg', attr: { cx: 18, cy: 18, r: 15 } });
		const fg = svg.createSvg('circle', { cls: 'pc-ring-fg', attr: { cx: 18, cy: 18, r: 15, 'stroke-dasharray': circumference.toFixed(2) } });
		fg.setAttr('stroke-dashoffset', (circumference * (1 - Math.min(Math.max(ratio, 0), 1))).toFixed(2));
	}

	/** One sentence that answers "when do I have to start the next one?". */
	private paceCallout(parent: HTMLElement, stats: PassStats) {
		const tone = stats.remaining === 0 ? 'good' : stats.cadenceTone;
		const callout = parent.createDiv({ cls: `ap-notice${tone === 'normal' ? '' : ` is-${tone}`}` });
		const text = callout.createDiv();
		if (stats.remaining === 0) {
			text.createEl('strong', { text: tr(`All ${stats.total} uses are recorded.`, `${stats.total} 次已全部记录。`) });
			return;
		}
		if (!stats.deadline || stats.daysToDeadline === null) {
			text.appendText(tr('Set a deadline in settings to see whether you can use them all.', '在设置里填截止时间，就能看出能不能全部用完。'));
			return;
		}
		if (stats.daysToDeadline <= 0) {
			text.createEl('strong', { text: tr('The deadline has passed. ', '已过截止时间。') });
			text.appendText(tr(`${stats.remaining} can no longer be started.`, `剩下的 ${stats.remaining} 次已无法激活。`));
			return;
		}
		if (stats.fitBeforeDeadline !== null && stats.fitBeforeDeadline < stats.remaining) {
			text.createEl('strong', { text: tr('Getting tight. ', '时间紧了。') });
			text.appendText(tr(`Only ${stats.fitBeforeDeadline} of ${stats.remaining} can still start before the deadline.`, `剩下 ${stats.remaining} 次，截止前只来得及激活 ${stats.fitBeforeDeadline} 次。`));
			return;
		}
		text.createEl('strong', { text: tone === 'warn' ? tr('Getting tight. ', '时间紧了。') : tr('On pace. ', '节奏正常。') });
		if (stats.latestNextActivation) {
			text.appendText(tr(`To use all ${stats.remaining} before the deadline, start the next one by `, `要在截止前用完剩下的 ${stats.remaining} 次，下一张最晚在 `));
			text.createEl('strong', { text: formatDateTime(stats.latestNextActivation) });
			text.appendText(tr('.', ' 激活。'));
		}
		if (stats.daysPerUse !== null) text.createDiv({ cls: 'ap-cap', text: tr(`${stats.daysPerUse.toFixed(1)} days per use left`, `平均每次还有 ${stats.daysPerUse.toFixed(1)} 天`) });
	}
}

class RecordModal extends Modal {
	/** Pass a record to edit it instead of recording a new activation. */
	constructor(app: App, private plugin: PassCountdownPlugin, private editing?: PassRecord) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		const { settings } = this.plugin.data;
		const stats = this.plugin.stats();
		const editing = this.editing;
		modalEl.addClass('pass-countdown-modal', 'ap', 'ap-modal');
		const position = editing ? sortRecords(this.plugin.data.records).findIndex(record => record.id === editing.id) + 1 : stats.used + 1;
		this.setTitle(editing ? tr('Edit activation', '编辑激活记录') : tr('Record activation', '记录激活'));
		contentEl.createDiv({ cls: 'ap-modal-kicker', text: `${settings.passName} · #${position}` });

		if (!editing && stats.remaining <= 0) {
			contentEl.createDiv({ cls: 'ap-notice is-danger', text: tr(`All ${stats.total} uses are recorded.`, `${stats.total} 次已全部记录。`) });
			return;
		}

		let when = (editing && parseDate(editing.activatedAt)) || new Date();
		let label = editing?.label ?? '';
		let note = editing?.note ?? '';
		const passMs = () => {
			const start = editing ? parseDate(editing.activatedAt) : null;
			const end = editing ? parseDate(editing.expiresAt) : null;
			return start && end ? end.getTime() - start.getTime() : settings.passDays * MS_DAY;
		};

		new Setting(contentEl)
			.setName(tr('Activated at', '激活时间'))
			.setDesc(tr('Your local time.', '本机当地时间。'))
			.addText(text => {
				text.inputEl.type = 'datetime-local';
				text.setValue(toLocalInput(when)).onChange(value => {
					const parsed = new Date(value);
					if (Number.isFinite(parsed.getTime())) { when = parsed; update(); }
				});
			});

		// Show the result before saving: when this pass ends and how many are left after it.
		const preview = contentEl.createDiv({ cls: 'ap-card is-flat pc-preview' });
		const endCol = preview.createDiv();
		endCol.createDiv({ cls: 'ap-cap', text: tr('This pass will end', '这张的到期时间') });
		const endValue = endCol.createDiv({ cls: 'pc-preview-value ap-num' });
		const leftCol = preview.createDiv({ cls: 'pc-preview-right' });
		leftCol.createDiv({ cls: 'ap-cap', text: editing ? tr('Left', '剩余') : tr('After this', '记完后') });
		const after = editing ? stats.remaining : stats.remaining - 1;
		leftCol.createDiv({ cls: 'pc-preview-value ap-num', text: tr(`${after} left`, `剩 ${after} 次`) });
		const warning = contentEl.createDiv({ cls: 'ap-notice is-warn pc-overlap' });

		const update = () => {
			const end = new Date(when.getTime() + passMs());
			endValue.setText(formatDateTime(end));
			const overlap = overlappingRecords(this.plugin.data.records, when, end, editing?.id);
			warning.toggle(overlap.length > 0);
			warning.setText(overlap.length > 0
				? tr(`This would overlap ${overlap.length === 1 ? 'another pass' : `${overlap.length} other passes`}. Check before activating another one.`, `会和另外 ${overlap.length} 张的使用时间重叠。再激活之前先确认一下。`)
				: '');
		};

		new Setting(contentEl)
			.setName(tr('Label', '标签'))
			.setDesc(tr('Optional, such as the last characters of the code. Do not store the full code.', '可不填，比如兑换码末几位。不要存完整的码。'))
			.addText(text => text.setValue(label).onChange(value => { label = value; }));
		new Setting(contentEl)
			.setName(tr('Note', '备注'))
			.addText(text => text.setValue(note).onChange(value => { note = value; }));
		update();

		const foot = contentEl.createDiv({ cls: 'ap-modal-foot' });
		foot.createDiv({ cls: 'ap-foot-note', text: editing ? tr('The pass keeps its length.', '有效时长不变。') : tr(`Ends ${settings.passDays} days after activation.`, `激活后 ${settings.passDays} 天到期。`) });
		const cancel = foot.createEl('button', { text: tr('Cancel', '取消') });
		cancel.onclick = () => this.close();
		const save = foot.createEl('button', { text: tr('Save', '保存'), cls: 'mod-cta' });
		save.onclick = async () => {
			save.disabled = true;
			if (editing) {
				await this.plugin.updateRecord(editRecord(editing, when, label, note));
				new Notice(tr('Saved.', '已保存。'));
			} else {
				await this.plugin.addRecord(createRecord(settings, when, label, note, new Date(), newId()));
				const left = this.plugin.stats().remaining;
				new Notice(tr(`Recorded. ${left} left.`, `已记录，还剩 ${left} 次。`));
			}
			this.close();
		};
	}

	onClose() { this.contentEl.empty(); }
}

/** A compact pass card inside a note, from a `pass-countdown` code block. */
class PassEmbed extends MarkdownRenderChild {
	private readonly render = () => this.draw();

	constructor(containerEl: HTMLElement, private plugin: PassCountdownPlugin) {
		super(containerEl);
	}

	onload() {
		this.plugin.embeds.add(this.render);
		this.draw();
	}

	onunload() {
		this.plugin.embeds.delete(this.render);
	}

	private draw() {
		const el = this.containerEl;
		el.empty();
		const { settings } = this.plugin.data;
		el.addClass('pass-countdown', 'pc-embed', 'ap');
		const stats = this.plugin.stats();
		const card = el.createDiv({ cls: 'ap-card pc-left' });
		const top = card.createDiv({ cls: 'pc-embed-top' });
		top.createDiv({ cls: 'ap-eyebrow', text: settings.passName });
		top.createSpan(statePill(stats));
		leftCard(card, stats);
		const lines = card.createDiv({ cls: 'pc-embed-lines' });
		if (stats.activeEndsAt) {
			const left = formatDuration(stats.activeEndsAt.getTime() - Date.now());
			const ends = formatShort(stats.activeEndsAt);
			lines.createDiv({ text: tr(`Current pass: ${left} left, ends ${ends}`, `当前这张还剩 ${left}，${ends} 到期`) });
		}
		if (stats.remaining > 0 && stats.daysToDeadline !== null && stats.daysToDeadline > 0) {
			const tight = stats.fitBeforeDeadline !== null && stats.fitBeforeDeadline < stats.remaining;
			const next = stats.latestNextActivation ? formatShort(stats.latestNextActivation) : '';
			lines.createDiv({
				cls: tight ? 'pc-embed-warn' : 'ap-muted',
				text: tight
					? tr(`Only ${stats.fitBeforeDeadline} of ${stats.remaining} can still start before the deadline.`, `剩下 ${stats.remaining} 次，截止前只来得及激活 ${stats.fitBeforeDeadline} 次。`)
					: next ? tr(`Start the next one by ${next}.`, `下一张最晚 ${next} 激活。`) : ''
			});
		}
	}
}

class ImportModal extends Modal {
	constructor(app: App, private plugin: PassCountdownPlugin) {
		super(app);
	}

	onOpen() {
		this.setTitle(tr('Import activations from notes', '从笔记导入激活记录'));
		this.modalEl.addClass('pass-countdown-modal', 'ap', 'ap-modal');
		let folder = '';
		const intro = this.contentEl.createEl('p');
		const [startField, endField, idField] = FRONTMATTER_FIELDS;
		intro.appendText(tr('Reads notes in the folder whose frontmatter has ', '读取文件夹里属性含 '));
		intro.createEl('code', { text: startField });
		intro.appendText(tr(' (and optionally ', '的笔记（可选 '));
		intro.createEl('code', { text: endField });
		intro.appendText(tr(', ', '、'));
		intro.createEl('code', { text: idField });
		intro.appendText(tr('). Notes already imported are skipped.', '）。已导入的会跳过。'));
		new Setting(this.contentEl)
			.setName(tr('Folder', '文件夹'))
			.addText(text => text.setPlaceholder('Activations').onChange(value => { folder = value.trim(); }));
		new Setting(this.contentEl)
			.addButton(button => button.setButtonText(tr('Import', '导入')).setCta().onClick(async () => {
				if (!folder) return;
				const added = await this.plugin.importFromFolder(folder);
				if (added === null) {
					new Notice(tr(`Folder not found: ${folder}`, `找不到文件夹：${folder}`));
					return;
				}
				new Notice(tr(`Imported ${added} record(s).`, `导入了 ${added} 条记录。`));
				this.close();
			}));
	}

	onClose() { this.contentEl.empty(); }
}

type SettingKey = keyof PassSettings;

/** Marks each group's last row so the kit rounds its lower corners where Obsidian lays rows out flat under their headings. */
function markGroupEnds(el: HTMLElement): void {
	el.querySelectorAll('.setting-item:not(.setting-item-heading)').forEach(row => {
		const next = row.nextElementSibling;
		row.toggleClass('ap-group-end', !!next && (next.matches('.setting-item-heading') || !next.matches('.setting-item')));
	});
}

class PassCountdownSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: PassCountdownPlugin) {
		super(app, plugin);
		this.containerEl.addClass('ap', 'ap-settings');
		new MutationObserver(() => markGroupEnds(this.containerEl)).observe(this.containerEl, { childList: true, subtree: true });
	}

	/** Obsidian 1.13+: rendered by Obsidian and indexed by settings search. */
	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{ name: L.passName(), control: { type: 'text', key: 'passName', placeholder: DEFAULT_SETTINGS.passName } },
			{ name: L.totalUses(), control: { type: 'number', key: 'totalUses', min: 1, step: 1, validate: v => (Number.isInteger(v) && v > 0 ? undefined : L.wholeNumber()) } },
			{ name: L.passDays(), desc: L.passDaysDesc(), control: { type: 'number', key: 'passDays', min: 1, step: 'any', validate: v => (v > 0 ? undefined : L.aboveZero()) } },
			{ name: L.deadline(), desc: L.deadlineDesc(), aliases: ['expiry', 'last activation', '截止'], control: { type: 'text', key: 'deadline', placeholder: DEFAULT_SETTINGS.deadline, validate: v => (!v.trim() || parseDate(v.trim()) ? undefined : L.deadlineInvalid()) } },
			{ name: L.deadlineMode(), desc: L.deadlineModeDesc(), control: { type: 'dropdown', key: 'deadlineMode', options: L.deadlineModes() } },
			{
				type: 'group',
				heading: L.reminders(),
				items: [
					{ name: L.inApp(), desc: L.inAppDesc(), control: { type: 'toggle', key: 'inAppReminders' } },
					{ name: L.leadHours(), desc: L.leadHoursDesc(), control: { type: 'number', key: 'reminderLeadHours', min: 1, step: 1, validate: v => (v > 0 ? undefined : L.aboveZero()) } },
					{ name: L.offsets(), desc: L.offsetsDesc(), aliases: ['ics', 'calendar', '日历'], control: { type: 'text', key: 'reminderOffsets', placeholder: DEFAULT_SETTINGS.reminderOffsets } }
				]
			},
			{
				type: 'group',
				heading: L.exports(),
				items: [
					{ name: L.icsPath(), desc: L.icsPathDesc(), control: { type: 'text', key: 'icsPath', placeholder: DEFAULT_SETTINGS.icsPath } },
					{ name: L.reportPath(), control: { type: 'text', key: 'reportPath', placeholder: DEFAULT_SETTINGS.reportPath } }
				]
			}
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.data.settings[key as SettingKey];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		applySetting(this.plugin.data.settings, key as SettingKey, value);
		await this.plugin.save();
	}

	/** Fallback for Obsidian versions before 1.13. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.data.settings;
		const set = (key: SettingKey, value: unknown) => { applySetting(s, key, value); void this.plugin.save(); };

		new Setting(containerEl).setName(L.passName()).addText(t => t.setValue(s.passName).onChange(v => set('passName', v)));
		new Setting(containerEl).setName(L.totalUses()).addText(t => {
			t.inputEl.type = 'number';
			t.setValue(String(s.totalUses)).onChange(v => set('totalUses', Number(v)));
		});
		new Setting(containerEl).setName(L.passDays()).setDesc(L.passDaysDesc()).addText(t => {
			t.inputEl.type = 'number';
			t.setValue(String(s.passDays)).onChange(v => set('passDays', Number(v)));
		});
		new Setting(containerEl).setName(L.deadline()).setDesc(L.deadlineDesc()).addText(t => t.setValue(s.deadline).onChange(v => set('deadline', v)));
		new Setting(containerEl).setName(L.deadlineMode()).setDesc(L.deadlineModeDesc())
			.addDropdown(d => d.addOptions(L.deadlineModes()).setValue(s.deadlineMode).onChange(v => set('deadlineMode', v)));

		new Setting(containerEl).setName(L.reminders()).setHeading();
		new Setting(containerEl).setName(L.inApp()).setDesc(L.inAppDesc())
			.addToggle(t => t.setValue(s.inAppReminders).onChange(v => set('inAppReminders', v)));
		new Setting(containerEl).setName(L.leadHours()).setDesc(L.leadHoursDesc()).addText(t => {
			t.inputEl.type = 'number';
			t.setValue(String(s.reminderLeadHours)).onChange(v => set('reminderLeadHours', Number(v)));
		});
		new Setting(containerEl).setName(L.offsets()).setDesc(L.offsetsDesc())
			.addText(t => t.setValue(s.reminderOffsets).onChange(v => set('reminderOffsets', v)));

		new Setting(containerEl).setName(L.exports()).setHeading();
		new Setting(containerEl).setName(L.icsPath()).setDesc(L.icsPathDesc()).addText(t => t.setValue(s.icsPath).onChange(v => set('icsPath', v)));
		new Setting(containerEl).setName(L.reportPath()).addText(t => t.setValue(s.reportPath).onChange(v => set('reportPath', v)));
	}
}

/** Setting labels, read each time the tab is drawn so a language change shows on the next open. */
const L = {
	passName: () => tr('Pass name', '名称'),
	totalUses: () => tr('Total uses', '总次数'),
	passDays: () => tr('Days per pass', '每张有效天数'),
	passDaysDesc: () => tr('New records only; existing ones keep their end time.', '只影响新记录，已有记录的到期时间不变。'),
	deadline: () => tr('Deadline', '截止时间'),
	deadlineDesc: () => tr('With time zone, such as 2027-08-24T23:59:00+09:00.', '带时区，例如 2027-08-24T23:59:00+09:00。'),
	deadlineMode: () => tr('The deadline is', '截止时间指的是'),
	deadlineModeDesc: () => tr('povo codes count as used once activated, so the default is the last moment to activate.', 'povo 的兑换码激活即算用掉，所以默认是“最后可激活时刻”。'),
	deadlineModes: () => ({ activate: tr('The last moment to activate', '最后可激活时刻'), finish: tr('When every pass must have ended', '必须全部用完的时刻') }),
	deadlineInvalid: () => tr('Use a date and time with time zone, such as 2027-08-24T23:59:00+09:00.', '请填带时区的日期时间，例如 2027-08-24T23:59:00+09:00。'),
	wholeNumber: () => tr('Enter a whole number above 0.', '请填大于 0 的整数。'),
	aboveZero: () => tr('Enter a number above 0.', '请填大于 0 的数。'),
	reminders: () => tr('Reminders', '提醒'),
	inApp: () => tr('Remind me in Obsidian', '在 Obsidian 里提醒'),
	inAppDesc: () => tr('Show a notice once when the current pass is about to end, and when the latest start that still fits every pass is near.', '当前这张快到期、或快到下一张的最晚激活时间时，各弹一次提示。'),
	leadHours: () => tr('Hours ahead', '提前小时数'),
	leadHoursDesc: () => tr('How early the notice appears.', '提示提前多久出现。'),
	offsets: () => tr('Calendar alerts before the end', '日历提前提醒'),
	offsetsDesc: () => tr('Minutes, comma separated. Used in the .ics export.', '分钟数，用逗号隔开，用于导出的 .ics。'),
	exports: () => tr('Exports', '导出'),
	icsPath: () => tr('Calendar file', '日历文件'),
	icsPathDesc: () => tr('Where the .ics export is saved.', '.ics 保存的位置。'),
	reportPath: () => tr('Report note', '报告笔记')
};

/** Status of the whole pass set, for the panel header and the note card. */
function statePill(stats: PassStats): { cls: string; text: string } {
	if (stats.remaining === 0) return { cls: 'ap-pill', text: tr('All used', '已用完') };
	if (stats.active) return { cls: 'ap-pill is-good', text: tr('Active', '使用中') };
	if (stats.daysToDeadline !== null && stats.daysToDeadline <= 0) return { cls: 'ap-pill is-danger', text: tr('Deadline passed', '已过截止') };
	return { cls: 'ap-pill', text: tr('Not active', '未在使用') };
}

/** The big count left, a meter for it and one line of context; shared by the panel and the note card. */
function leftCard(card: HTMLElement, stats: PassStats) {
	const big = card.createDiv({ cls: 'pc-count' });
	big.createSpan({ cls: 'ap-big pc-big-value', text: String(stats.remaining) });
	big.createSpan({ cls: 'pc-of', text: tr(`of ${stats.total} left`, `次剩余，共 ${stats.total} 次`) });
	const meter = card.createDiv({ cls: 'ap-meter' });
	meter.createDiv({ cls: 'ap-meter-fill' }).setCssProps({ '--ap-value': `${stats.total ? Math.min(Math.max(stats.remaining / stats.total, 0), 1) * 100 : 0}%` });
	const split = card.createDiv({ cls: 'ap-split' });
	split.createSpan({ text: tr(`${stats.used} used`, `已用 ${stats.used} 次`) });
	split.createSpan({ text: stats.deadline ? tr(`Last activation ${formatDate(stats.deadline)}`, `最晚激活 ${formatDate(stats.deadline)}`) : tr('No deadline set', '未设截止时间') });
}

function asText(value: unknown): string {
	return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

/** Store a value only when it is valid; empty text falls back to the default. */
function applySetting(s: PassSettings, key: SettingKey, value: unknown) {
	switch (key) {
		case 'totalUses': { const n = Math.floor(Number(value)); if (n > 0) s.totalUses = n; break; }
		case 'passDays': { const n = Number(value); if (n > 0) s.passDays = n; break; }
		case 'reminderLeadHours': { const n = Number(value); if (n > 0) s.reminderLeadHours = n; break; }
		case 'deadline': { const v = asText(value).trim(); if (!v || parseDate(v)) s.deadline = v; break; }
		case 'inAppReminders': s.inAppReminders = value === true; break;
		case 'deadlineMode': s.deadlineMode = value === 'finish' ? 'finish' : 'activate'; break;
		case 'reminderOffsets': s.reminderOffsets = asText(value); break;
		case 'passName': case 'icsPath': case 'reportPath': s[key] = asText(value).trim() || DEFAULT_SETTINGS[key]; break;
	}
}
