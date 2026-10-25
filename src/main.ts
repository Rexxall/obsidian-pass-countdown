import { App, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, moment, normalizePath, setIcon } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MS_DAY,
	PassData,
	PassRecord,
	PassStats,
	Tone,
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

/** Follows the Obsidian interface language rather than the system locale. */
function formatDateTime(date: Date): string {
	return date.toLocaleString(moment.locale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
		const stats = this.plugin.stats();
		const now = Date.now();

		const header = root.createDiv({ cls: 'pc-header' });
		header.createEl('h3', { text: settings.passName });
		const actions = header.createDiv({ cls: 'pc-actions' });
		const recordBtn = actions.createEl('button', { text: 'Record', cls: 'mod-cta' });
		recordBtn.onclick = () => new RecordModal(this.app, this.plugin).open();
		const icsBtn = actions.createEl('button', { attr: { 'aria-label': 'Export reminders (.ics)' } });
		setIcon(icsBtn, 'calendar-plus');
		icsBtn.onclick = () => void this.plugin.exportIcs();
		const reportBtn = actions.createEl('button', { attr: { 'aria-label': 'Export Markdown report' } });
		setIcon(reportBtn, 'file-text');
		reportBtn.onclick = () => void this.plugin.exportReport();

		const meter = root.createDiv({ cls: 'pc-meter' });
		const fill = meter.createDiv({ cls: 'pc-meter-fill' });
		fill.style.setProperty('--pc-used', `${stats.total ? (stats.used / stats.total) * 100 : 0}%`);
		root.createDiv({ cls: 'pc-meter-label', text: `${stats.used} used · ${stats.remaining} left of ${stats.total}` });

		const grid = root.createDiv({ cls: 'pc-grid' });
		this.card(grid, 'Now',
			stats.activeEndsAt ? `${formatDuration(stats.activeEndsAt.getTime() - now)} left` : 'No active pass',
			stats.activeEndsAt ? `Ends ${formatDateTime(stats.activeEndsAt)}` : 'Record one after you activate it.',
			stats.activeEndsAt ? 'good' : 'normal');
		this.card(grid, 'Deadline',
			stats.daysToDeadline === null ? 'Not set' : stats.daysToDeadline < 0 ? 'Passed' : `${Math.ceil(stats.daysToDeadline)} days`,
			stats.deadline ? `Last activation ${formatDateTime(stats.deadline)}` : 'Set it in settings.',
			stats.daysToDeadline === null ? 'warn' : stats.daysToDeadline < 0 ? 'danger' : stats.daysToDeadline < 30 ? 'warn' : 'normal');
		this.card(grid, 'Pace',
			stats.remaining === 0 ? 'All used' : stats.daysPerUse === null ? '—' : `${stats.daysPerUse.toFixed(1)} days / use`,
			stats.fitBeforeDeadline !== null && stats.fitBeforeDeadline < stats.remaining
				? `Only ${stats.fitBeforeDeadline} of ${stats.remaining} can still start before the deadline`
				: stats.latestNextActivation && stats.remaining > 0 ? `Start the next one by ${formatDateTime(stats.latestNextActivation)} to use them all` : '',
			stats.cadenceTone);

		const list = root.createDiv({ cls: 'pc-list' });
		list.createEl('h4', { text: 'History' });
		const records = sortRecords(this.plugin.data.records, 'desc');
		if (records.length === 0) {
			list.createDiv({ cls: 'pc-empty', text: 'No activations yet.' });
			return;
		}
		records.forEach((record, i) => {
			const start = parseDate(record.activatedAt);
			const end = parseDate(record.expiresAt);
			const isActive = !!start && !!end && start.getTime() <= now && end.getTime() > now;
			const row = list.createDiv({ cls: `pc-row${isActive ? ' is-active' : ''}` });
			row.createDiv({ cls: 'pc-row-index', text: `#${records.length - i}` });
			const body = row.createDiv({ cls: 'pc-row-body' });
			body.createDiv({ cls: 'pc-row-dates', text: `${start ? formatDateTime(start) : '—'} → ${end ? formatDateTime(end) : '—'}` });
			const extra = [record.label, record.note].filter(Boolean).join(' · ');
			if (extra) body.createDiv({ cls: 'pc-row-note', text: extra });
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

	private card(parent: HTMLElement, label: string, value: string, detail: string, tone: Tone) {
		const card = parent.createDiv({ cls: `pc-card tone-${tone}` });
		card.createDiv({ cls: 'pc-card-label', text: label });
		card.createDiv({ cls: 'pc-card-value', text: value });
		if (detail) card.createDiv({ cls: 'pc-card-detail', text: detail });
	}
}

class RecordModal extends Modal {
	constructor(app: App, private plugin: PassCountdownPlugin) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		const { settings } = this.plugin.data;
		const stats = this.plugin.stats();
		this.setTitle('Record an activation');

		if (stats.remaining <= 0) {
			contentEl.createDiv({ cls: 'pc-callout tone-danger', text: `All ${stats.total} uses are recorded.` });
			return;
		}

		let when = new Date();
		let label = '';
		let note = '';
		const warning = contentEl.createDiv({ cls: 'pc-callout tone-warn' });
		const checkOverlap = () => {
			const end = new Date(when.getTime() + settings.passDays * MS_DAY);
			const overlap = overlappingRecords(this.plugin.data.records, when, end);
			warning.toggle(overlap.length > 0);
			warning.setText(overlap.length > 0 ? `This would overlap ${overlap.length === 1 ? 'another pass' : `${overlap.length} other passes`}. Check before activating another one.` : '');
		};

		new Setting(contentEl)
			.setName('Activated at')
			.setDesc(`Your local time. The pass ends ${settings.passDays} days later.`)
			.addText(text => {
				text.inputEl.type = 'datetime-local';
				text.setValue(toLocalInput(when)).onChange(value => {
					const parsed = new Date(value);
					if (Number.isFinite(parsed.getTime())) { when = parsed; checkOverlap(); }
				});
			});
		new Setting(contentEl)
			.setName('Label')
			.setDesc('Optional, e.g. the last characters of the code. Do not store the full code.')
			.addText(text => text.onChange(value => { label = value; }));
		new Setting(contentEl)
			.setName('Note')
			.addText(text => text.onChange(value => { note = value; }));
		checkOverlap();

		new Setting(contentEl)
			.addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton(button => button.setButtonText('Save').setCta().onClick(async () => {
				button.setDisabled(true);
				await this.plugin.addRecord(createRecord(settings, when, label, note, new Date(), newId()));
				new Notice(`Recorded. ${this.plugin.stats().remaining} left.`);
				this.close();
			}));
	}

	onClose() { this.contentEl.empty(); }
}

class ImportModal extends Modal {
	constructor(app: App, private plugin: PassCountdownPlugin) {
		super(app);
	}

	onOpen() {
		this.setTitle('Import activations from notes');
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
