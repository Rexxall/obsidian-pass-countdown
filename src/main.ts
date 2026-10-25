import { App, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, moment, normalizePath, setIcon } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MS_DAY,
	PassData,
	PassRecord,
	PassStats,
	buildIcs,
	buildMarkdownReport,
	computeStats,
	createRecord,
	normalizeData,
	overlappingRecords,
	parseDate,
	recordFromFrontmatter,
	sortRecords
} from './core';

const VIEW_TYPE = 'pass-countdown-view';
/** Above this many uses the dot grid gets too dense; a meter is used instead. */
const MAX_DOTS = 120;

/** Follows the Obsidian interface language rather than the system locale. */
function formatDateTime(date: Date): string {
	return date.toLocaleString(moment.locale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Month, day and time only; the year is shown when it is not this year. */
function formatShort(date: Date): string {
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleString(moment.locale(), { year: sameYear ? undefined : 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
	return date.toLocaleDateString(moment.locale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDuration(ms: number): string {
	if (ms <= 0) return '0 min';
	const days = Math.floor(ms / MS_DAY);
	const hours = Math.floor((ms % MS_DAY) / 3_600_000);
	if (days > 0) return `${days} d ${hours} h`;
	const minutes = Math.floor((ms % 3_600_000) / 60_000);
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

	async onload() {
		this.data = normalizeData(await this.loadData());

		this.registerView(VIEW_TYPE, leaf => new PassCountdownView(leaf, this));
		this.addRibbonIcon('ticket', 'Open pass countdown', () => void this.activateView());

		this.addCommand({ id: 'open', name: 'Open tracker', callback: () => void this.activateView() });
		this.addCommand({ id: 'record', name: 'Record an activation', callback: () => new RecordModal(this.app, this).open() });
		this.addCommand({ id: 'export-ics', name: 'Export reminders (.ics)', callback: () => void this.exportIcs() });
		this.addCommand({ id: 'export-report', name: 'Export Markdown report', callback: () => void this.exportReport() });
		this.addCommand({ id: 'import-notes', name: 'Import activations from notes in a folder', callback: () => new ImportModal(this.app, this).open() });

		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass('pass-countdown-status');
		this.updateStatusBar();
		this.registerInterval(window.setInterval(() => this.refreshAll(), 60_000));

		this.addSettingTab(new PassCountdownSettingTab(this.app, this));
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
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof PassCountdownView) leaf.view.render();
		}
	}

	updateStatusBar() {
		if (!this.statusBar) return;
		const stats = this.stats();
		const active = stats.activeEndsAt ? ` · ${formatDuration(stats.activeEndsAt.getTime() - Date.now())} left` : '';
		this.statusBar.setText(`${stats.remaining}/${stats.total}${active}`);
		this.statusBar.setAttr('aria-label', `${this.data.settings.passName}: ${stats.remaining} of ${stats.total} left`);
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

	async removeRecord(id: string) {
		this.data.records = this.data.records.filter(record => record.id !== id);
		await this.save();
	}

	async writeVaultFile(path: string, content: string): Promise<string> {
		const target = normalizePath(path);
		const folder = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '';
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		const existing = this.app.vault.getAbstractFileByPath(target);
		if (existing instanceof TFile) await this.app.vault.modify(existing, content);
		else await this.app.vault.create(target, content);
		return target;
	}

	async exportIcs() {
		const path = await this.writeVaultFile(this.data.settings.icsPath, buildIcs(this.data, new Date()));
		new Notice(`Saved ${path}. Open it to add the reminders to your calendar.`);
	}

	async exportReport() {
		const path = await this.writeVaultFile(this.data.settings.reportPath, buildMarkdownReport(this.data, new Date(), formatDateTime));
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
	}

	async importFromFolder(folderPath: string): Promise<number> {
		const prefix = normalizePath(folderPath).replace(/\/$/, '') + '/';
		const known = new Set(this.data.records.map(record => record.id));
		let added = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(prefix)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
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
	getDisplayText() { return 'Pass countdown'; }
	getIcon() { return 'ticket'; }

	async onOpen() { this.render(); }

	render() {
		const root = this.contentEl;
		root.empty();
		root.addClass('pass-countdown');
		const { settings } = this.plugin.data;
		root.toggleClass('rk-paper', settings.paperStyle);
		const stats = this.plugin.stats();
		const now = Date.now();
		const records = sortRecords(this.plugin.data.records, 'asc');

		const head = root.createDiv({ cls: 'rk-head' });
		const headMain = head.createDiv({ cls: 'rk-head-main' });
		headMain.createDiv({ cls: 'rk-kicker', text: 'Pass countdown' });
		headMain.createEl('h3', { cls: 'rk-title', text: settings.passName });
		const actions = head.createDiv({ cls: 'rk-head-actions' });
		const reportBtn = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Export Markdown report' } });
		setIcon(reportBtn, 'file-text');
		reportBtn.onclick = () => void this.plugin.exportReport();

		const stack = root.createDiv({ cls: 'rk-stack' });

		// How many are left: the one number this tool exists for.
		const leftCard = stack.createDiv({ cls: 'rk-card' });
		const big = leftCard.createDiv({ cls: 'pc-big' });
		big.createSpan({ cls: 'pc-big-value', text: String(stats.remaining) });
		big.createSpan({ cls: 'rk-muted', text: `left of ${stats.total}` });
		const activeIndex = stats.active ? records.findIndex(record => record.id === stats.active?.id) : -1;
		if (stats.total <= MAX_DOTS) {
			const dots = leftCard.createDiv({ cls: 'pc-dots', attr: { 'aria-hidden': 'true' } });
			for (let i = 0; i < stats.total; i++) {
				dots.createSpan({ cls: `pc-dot ${i === activeIndex ? 'is-current' : i < stats.used ? 'is-used' : 'is-left'}` });
			}
		} else {
			this.meter(leftCard, stats.total ? stats.used / stats.total : 0, '');
		}
		const split = leftCard.createDiv({ cls: 'rk-split pc-split' });
		split.createSpan({ text: `${stats.used} used` });
		split.createSpan({ text: stats.deadline ? `deadline ${formatDate(stats.deadline)}` : 'no deadline set' });

		// The pass that is running now.
		const current = stack.createDiv({ cls: 'rk-card is-flat' });
		if (stats.active && stats.activeEndsAt) {
			const start = parseDate(stats.active.activatedAt);
			const end = stats.activeEndsAt;
			current.createDiv({ cls: 'rk-label', text: `Current pass · #${activeIndex + 1}` });
			const value = current.createDiv();
			value.createSpan({ cls: 'rk-stat-value pc-duration', text: formatDuration(end.getTime() - now) });
			value.createSpan({ cls: 'rk-stat-unit', text: 'left' });
			const span = start ? end.getTime() - start.getTime() : 0;
			this.meter(current, span > 0 && start ? (now - start.getTime()) / span : 0, 'is-good');
			const range = current.createDiv({ cls: 'rk-split' });
			range.createSpan({ text: start ? formatShort(start) : '—' });
			range.createSpan({ text: `ends ${formatShort(end)}` });
		} else {
			current.createDiv({ cls: 'rk-label', text: 'Current pass' });
			current.createDiv({ text: 'No active pass' });
			current.createDiv({ cls: 'rk-cap', text: 'Record one right after you activate it.' });
		}

		this.paceCallout(stack, stats);

		const buttons = stack.createDiv({ cls: 'rk-actions' });
		const recordBtn = buttons.createEl('button', { text: 'Record activation', cls: 'mod-cta rk-wide pc-record' });
		recordBtn.disabled = stats.remaining <= 0;
		recordBtn.onclick = () => new RecordModal(this.app, this.plugin).open();
		const icsBtn = buttons.createEl('button', { text: 'Export .ics', attr: { 'aria-label': 'Export reminders (.ics)' } });
		icsBtn.onclick = () => void this.plugin.exportIcs();

		const list = stack.createDiv({ cls: 'pc-list' });
		list.createDiv({ cls: 'rk-label', text: 'History' });
		if (records.length === 0) {
			list.createDiv({ cls: 'rk-muted', text: 'No activations yet.' });
			return;
		}
		[...records].reverse().forEach((record, i) => {
			const start = parseDate(record.activatedAt);
			const end = parseDate(record.expiresAt);
			const isActive = !!start && !!end && start.getTime() <= now && end.getTime() > now;
			const row = list.createDiv({ cls: `rk-row pc-row${isActive ? ' is-active' : ''}` });
			row.createSpan({ cls: 'pc-row-index rk-num', text: `#${records.length - i}` });
			const body = row.createDiv({ cls: 'rk-grow' });
			body.createDiv({ cls: 'rk-num', text: `${start ? formatShort(start) : '—'} → ${end ? formatShort(end) : '—'}` });
			const extra = [record.label, record.note].filter(Boolean).join(' · ');
			if (extra) body.createDiv({ cls: 'rk-cap pc-row-note', text: extra });
			if (isActive) row.createSpan({ cls: 'rk-chip is-good', text: 'active' });
			const del = row.createEl('button', { cls: 'pc-row-delete clickable-icon', attr: { 'aria-label': 'Delete record' } });
			setIcon(del, 'trash-2');
			let armed = false;
			del.onclick = () => {
				if (!armed) {
					armed = true;
					del.addClass('is-armed');
					del.setAttr('aria-label', 'Click again to delete');
					window.setTimeout(() => { armed = false; del.removeClass('is-armed'); del.setAttr('aria-label', 'Delete record'); }, 4000);
					return;
				}
				void this.plugin.removeRecord(record.id);
			};
		});
	}

	private meter(parent: HTMLElement, ratio: number, tone: string) {
		const meter = parent.createDiv({ cls: `rk-meter ${tone}`.trim() });
		const fill = meter.createDiv({ cls: 'rk-meter-fill' });
		fill.style.setProperty('--rk-fill', `${Math.min(Math.max(ratio, 0), 1) * 100}%`);
	}

	/** One sentence that answers "when do I have to start the next one?". */
	private paceCallout(parent: HTMLElement, stats: PassStats) {
		const tone = stats.remaining === 0 ? 'good' : stats.cadenceTone;
		const callout = parent.createDiv({ cls: `rk-callout${tone === 'normal' ? '' : ` is-${tone}`}` });
		const text = callout.createDiv();
		if (stats.remaining === 0) {
			text.createEl('strong', { text: `All ${stats.total} uses are recorded.` });
			return;
		}
		if (!stats.deadline || stats.daysToDeadline === null) {
			text.appendText('Set a deadline in settings to see whether you can use them all.');
			return;
		}
		if (stats.daysToDeadline <= 0) {
			text.createEl('strong', { text: 'The deadline has passed. ' });
			text.appendText(`${stats.remaining} can no longer be started.`);
			return;
		}
		if (stats.fitBeforeDeadline !== null && stats.fitBeforeDeadline < stats.remaining) {
			text.createEl('strong', { text: 'Getting tight. ' });
			text.appendText(`Only ${stats.fitBeforeDeadline} of ${stats.remaining} can still start before the deadline.`);
			return;
		}
		text.createEl('strong', { text: tone === 'warn' ? 'Getting tight. ' : 'On pace. ' });
		if (stats.latestNextActivation) {
			text.appendText(`To use all ${stats.remaining} before the deadline, start the next one by `);
			text.createEl('strong', { text: formatDateTime(stats.latestNextActivation) });
			text.appendText('.');
		}
		if (stats.daysPerUse !== null) text.createDiv({ cls: 'rk-cap', text: `${stats.daysPerUse.toFixed(1)} days per use left` });
	}
}

class RecordModal extends Modal {
	constructor(app: App, private plugin: PassCountdownPlugin) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		const { settings } = this.plugin.data;
		const stats = this.plugin.stats();
		modalEl.addClass('pass-countdown-modal');
		modalEl.toggleClass('rk-paper', settings.paperStyle);
		this.setTitle('Record activation');
		contentEl.createDiv({ cls: 'rk-modal-kicker', text: `${settings.passName} · #${stats.used + 1}` });

		if (stats.remaining <= 0) {
			contentEl.createDiv({ cls: 'rk-callout is-danger', text: `All ${stats.total} uses are recorded.` });
			return;
		}

		let when = new Date();
		let label = '';
		let note = '';

		new Setting(contentEl)
			.setName('Activated at')
			.setDesc('Your local time.')
			.addText(text => {
				text.inputEl.type = 'datetime-local';
				text.setValue(toLocalInput(when)).onChange(value => {
					const parsed = new Date(value);
					if (Number.isFinite(parsed.getTime())) { when = parsed; update(); }
				});
			});

		// Show the result before saving: when this pass ends and how many are left after it.
		const preview = contentEl.createDiv({ cls: 'rk-card is-flat pc-preview' });
		const endCol = preview.createDiv();
		endCol.createDiv({ cls: 'rk-cap', text: 'This pass will end' });
		const endValue = endCol.createDiv({ cls: 'pc-preview-value rk-num' });
		const leftCol = preview.createDiv({ cls: 'pc-preview-right' });
		leftCol.createDiv({ cls: 'rk-cap', text: 'After this' });
		leftCol.createDiv({ cls: 'pc-preview-value rk-num', text: `${stats.remaining - 1} left` });
		const warning = contentEl.createDiv({ cls: 'rk-callout is-warn pc-overlap' });

		const update = () => {
			const end = new Date(when.getTime() + settings.passDays * MS_DAY);
			endValue.setText(formatDateTime(end));
			const overlap = overlappingRecords(this.plugin.data.records, when, end);
			warning.toggle(overlap.length > 0);
			warning.setText(overlap.length > 0 ? `This would overlap ${overlap.length === 1 ? 'another pass' : `${overlap.length} other passes`}. Check before activating another one.` : '');
		};

		new Setting(contentEl)
			.setName('Label')
			.setDesc('Optional, e.g. the last characters of the code. Do not store the full code.')
			.addText(text => text.onChange(value => { label = value; }));
		new Setting(contentEl)
			.setName('Note')
			.addText(text => text.onChange(value => { note = value; }));
		update();

		const foot = contentEl.createDiv({ cls: 'rk-modal-foot' });
		foot.createDiv({ cls: 'rk-foot-note', text: `Ends ${settings.passDays} days after activation.` });
		const cancel = foot.createEl('button', { text: 'Cancel' });
		cancel.onclick = () => this.close();
		const save = foot.createEl('button', { text: 'Save', cls: 'mod-cta' });
		save.onclick = async () => {
			save.disabled = true;
			await this.plugin.addRecord(createRecord(settings, when, label, note, new Date(), newId()));
			new Notice(`Recorded. ${this.plugin.stats().remaining} left.`);
			this.close();
		};
	}

	onClose() { this.contentEl.empty(); }
}

class ImportModal extends Modal {
	constructor(app: App, private plugin: PassCountdownPlugin) {
		super(app);
	}

	onOpen() {
		this.setTitle('Import activations from notes');
		this.modalEl.addClass('pass-countdown-modal');
		this.modalEl.toggleClass('rk-paper', this.plugin.data.settings.paperStyle);
		let folder = '';
		this.contentEl.createEl('p', { text: 'Reads notes in the folder whose frontmatter has activated_at (and optionally expires_at, activation_id). Notes already imported are skipped.' });
		new Setting(this.contentEl)
			.setName('Folder')
			.addText(text => text.setPlaceholder('povo-activations').onChange(value => { folder = value.trim(); }));
		new Setting(this.contentEl)
			.addButton(button => button.setButtonText('Import').setCta().onClick(async () => {
				if (!folder) return;
				const added = await this.plugin.importFromFolder(folder);
				new Notice(`Imported ${added} record(s).`);
				this.close();
			}));
	}

	onClose() { this.contentEl.empty(); }
}

class PassCountdownSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: PassCountdownPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.data.settings;
		const save = () => void this.plugin.save();

		new Setting(containerEl)
			.setName('Paper & ink style')
			.setDesc('Paper background, ink lines and serif numbers. Off follows your Obsidian theme.')
			.addToggle(t => t.setValue(s.paperStyle).onChange(v => { s.paperStyle = v; save(); }));
		new Setting(containerEl).setName('Pass name').addText(t => t.setValue(s.passName).onChange(v => { s.passName = v.trim() || DEFAULT_SETTINGS.passName; save(); }));
		new Setting(containerEl).setName('Total uses').addText(t => {
			t.inputEl.type = 'number';
			t.setValue(String(s.totalUses)).onChange(v => { const n = Math.floor(Number(v)); if (n > 0) { s.totalUses = n; save(); } });
		});
		new Setting(containerEl).setName('Days per pass').setDesc('New records only; existing ones keep their end time.').addText(t => {
			t.inputEl.type = 'number';
			t.setValue(String(s.passDays)).onChange(v => { const n = Number(v); if (n > 0) { s.passDays = n; save(); } });
		});
		new Setting(containerEl)
			.setName('Deadline')
			.setDesc('Last moment you can activate, with time zone, e.g. 2027-08-24T23:59:00+09:00.')
			.addText(t => t.setValue(s.deadline).onChange(v => {
				const value = v.trim();
				if (!value || parseDate(value)) { s.deadline = value; save(); }
			}));
		new Setting(containerEl)
			.setName('Reminders before the end')
			.setDesc('Minutes, comma separated. Used in the .ics export.')
			.addText(t => t.setValue(s.reminderOffsets).onChange(v => { s.reminderOffsets = v; save(); }));
		new Setting(containerEl).setName('Reminder file').addText(t => t.setValue(s.icsPath).onChange(v => { s.icsPath = v.trim() || DEFAULT_SETTINGS.icsPath; save(); }));
		new Setting(containerEl).setName('Report note').addText(t => t.setValue(s.reportPath).onChange(v => { s.reportPath = v.trim() || DEFAULT_SETTINGS.reportPath; save(); }));
	}
}
