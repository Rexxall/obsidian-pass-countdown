import { App, ItemView, MarkdownRenderChild, Modal, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, TFile, Vault, WorkspaceLeaf, moment, normalizePath, setIcon } from 'obsidian';
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
	sortRecords
} from './core';

const VIEW_TYPE = 'pass-countdown-view';
const CODE_BLOCK = 'pass-countdown';
const FRONTMATTER_FIELDS = ['activated_at', 'expires_at', 'activation_id'];
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
	/** Pass cards embedded in notes, redrawn with the panel. */
	readonly embeds = new Set<() => void>();

	async onload() {
		this.data = normalizeData(await this.loadData());

		this.registerView(VIEW_TYPE, leaf => new PassCountdownView(leaf, this));
		this.addRibbonIcon('ticket', 'Open pass countdown', () => void this.activateView());

		this.addCommand({ id: 'open', name: 'Open tracker', callback: () => void this.activateView() });
		this.addCommand({ id: 'record', name: 'Record an activation', callback: () => new RecordModal(this.app, this).open() });
		this.addCommand({ id: 'export-ics', name: 'Export reminders (.ics)', callback: () => void this.exportIcs() });
		this.addCommand({ id: 'export-report', name: 'Export Markdown report', callback: () => void this.exportReport() });
		this.addCommand({ id: 'import-notes', name: 'Import activations from notes in a folder', callback: () => new ImportModal(this.app, this).open() });
		this.addCommand({
			id: 'insert-card',
			name: 'Insert pass card into the current note',
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

	async updateRecord(record: PassRecord) {
		this.data.records = this.data.records.map(existing => existing.id === record.id ? record : existing);
		await this.save();
	}

	/** Show each due reminder once, while Obsidian is open. */
	async checkReminders() {
		const due = dueReminders(this.data, new Date());
		if (due.length === 0) return;
		const name = this.data.settings.passName;
		for (const reminder of due) {
			const when = formatDateTime(reminder.at);
			const message = reminder.kind === 'ending'
				? `${name}: the current pass ends ${when}.`
				: `${name}: start the next pass by ${when} to use every one before the deadline.`;
			new Notice(message, 0);
			this.data.notified.push(reminder.key);
		}
		this.data.notified = this.data.notified.slice(-200);
		await this.saveData(this.data);
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
		const path = await this.writeVaultFile(this.data.settings.icsPath, buildIcs(this.data, new Date()));
		new Notice(`Saved ${path}. Open it to add the reminders to your calendar.`);
	}

	async exportReport() {
		const path = await this.writeVaultFile(this.data.settings.reportPath, buildMarkdownReport(this.data, new Date(), formatDateTime));
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
			const edit = row.createEl('button', { cls: 'pc-row-edit clickable-icon', attr: { 'aria-label': 'Edit record' } });
			setIcon(edit, 'pencil');
			edit.onclick = () => new RecordModal(this.app, this.plugin, record).open();
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
	/** Pass a record to edit it instead of recording a new activation. */
	constructor(app: App, private plugin: PassCountdownPlugin, private editing?: PassRecord) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		const { settings } = this.plugin.data;
		const stats = this.plugin.stats();
		const editing = this.editing;
		modalEl.addClass('pass-countdown-modal');
		modalEl.toggleClass('rk-paper', settings.paperStyle);
		const position = editing ? sortRecords(this.plugin.data.records).findIndex(record => record.id === editing.id) + 1 : stats.used + 1;
		this.setTitle(editing ? 'Edit activation' : 'Record activation');
		contentEl.createDiv({ cls: 'rk-modal-kicker', text: `${settings.passName} · #${position}` });

		if (!editing && stats.remaining <= 0) {
			contentEl.createDiv({ cls: 'rk-callout is-danger', text: `All ${stats.total} uses are recorded.` });
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
		leftCol.createDiv({ cls: 'rk-cap', text: editing ? 'Left' : 'After this' });
		leftCol.createDiv({ cls: 'pc-preview-value rk-num', text: `${editing ? stats.remaining : stats.remaining - 1} left` });
		const warning = contentEl.createDiv({ cls: 'rk-callout is-warn pc-overlap' });

		const update = () => {
			const end = new Date(when.getTime() + passMs());
			endValue.setText(formatDateTime(end));
			const overlap = overlappingRecords(this.plugin.data.records, when, end, editing?.id);
			warning.toggle(overlap.length > 0);
			warning.setText(overlap.length > 0 ? `This would overlap ${overlap.length === 1 ? 'another pass' : `${overlap.length} other passes`}. Check before activating another one.` : '');
		};

		new Setting(contentEl)
			.setName('Label')
			.setDesc('Optional, such as the last characters of the code. Do not store the full code.')
			.addText(text => text.setValue(label).onChange(value => { label = value; }));
		new Setting(contentEl)
			.setName('Note')
			.addText(text => text.setValue(note).onChange(value => { note = value; }));
		update();

		const foot = contentEl.createDiv({ cls: 'rk-modal-foot' });
		foot.createDiv({ cls: 'rk-foot-note', text: editing ? 'The pass keeps its length.' : `Ends ${settings.passDays} days after activation.` });
		const cancel = foot.createEl('button', { text: 'Cancel' });
		cancel.onclick = () => this.close();
		const save = foot.createEl('button', { text: 'Save', cls: 'mod-cta' });
		save.onclick = async () => {
			save.disabled = true;
			if (editing) {
				await this.plugin.updateRecord(editRecord(editing, when, label, note));
				new Notice('Saved.');
			} else {
				await this.plugin.addRecord(createRecord(settings, when, label, note, new Date(), newId()));
				new Notice(`Recorded. ${this.plugin.stats().remaining} left.`);
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
		el.addClass('pass-countdown', 'pc-embed');
		el.toggleClass('rk-paper', settings.paperStyle);
		const stats = this.plugin.stats();
		const card = el.createDiv({ cls: 'rk-card' });
		const top = card.createDiv({ cls: 'pc-embed-top' });
		const big = top.createDiv({ cls: 'pc-big' });
		big.createSpan({ cls: 'pc-big-value pc-embed-value', text: String(stats.remaining) });
		big.createSpan({ cls: 'rk-muted', text: `left of ${stats.total}` });
		top.createDiv({ cls: 'rk-cap pc-embed-name', text: settings.passName });
		const lines = card.createDiv({ cls: 'pc-embed-lines' });
		if (stats.activeEndsAt) {
			lines.createDiv({ text: `Current pass: ${formatDuration(stats.activeEndsAt.getTime() - Date.now())} left, ends ${formatShort(stats.activeEndsAt)}` });
		} else {
			lines.createDiv({ cls: 'rk-muted', text: 'No active pass' });
		}
		if (stats.remaining > 0 && stats.daysToDeadline !== null && stats.daysToDeadline > 0) {
			const tight = stats.fitBeforeDeadline !== null && stats.fitBeforeDeadline < stats.remaining;
			lines.createDiv({
				cls: tight ? 'pc-embed-warn' : 'rk-muted',
				text: tight
					? `Only ${stats.fitBeforeDeadline} of ${stats.remaining} can still start before the deadline.`
					: stats.latestNextActivation ? `Start the next one by ${formatShort(stats.latestNextActivation)}.` : ''
			});
		}
	}
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
		const intro = this.contentEl.createEl('p');
		const [startField, endField, idField] = FRONTMATTER_FIELDS;
		intro.appendText('Reads notes in the folder whose frontmatter has ');
		intro.createEl('code', { text: startField });
		intro.appendText(' (and optionally ');
		intro.createEl('code', { text: endField });
		intro.appendText(', ');
		intro.createEl('code', { text: idField });
		intro.appendText('). Notes already imported are skipped.');
		new Setting(this.contentEl)
			.setName('Folder')
			.addText(text => text.setPlaceholder('Activations').onChange(value => { folder = value.trim(); }));
		new Setting(this.contentEl)
			.addButton(button => button.setButtonText('Import').setCta().onClick(async () => {
				if (!folder) return;
				const added = await this.plugin.importFromFolder(folder);
				if (added === null) {
					new Notice(`Folder not found: ${folder}`);
					return;
				}
				new Notice(`Imported ${added} record(s).`);
				this.close();
			}));
	}

	onClose() { this.contentEl.empty(); }
}

type SettingKey = keyof PassSettings;

class PassCountdownSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: PassCountdownPlugin) {
		super(app, plugin);
	}

	/** Obsidian 1.13+: rendered by Obsidian and indexed by settings search. */
	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{ name: 'Pass name', control: { type: 'text', key: 'passName', placeholder: DEFAULT_SETTINGS.passName } },
			{ name: 'Total uses', control: { type: 'number', key: 'totalUses', min: 1, step: 1, validate: v => (Number.isInteger(v) && v > 0 ? undefined : 'Enter a whole number above 0.') } },
			{ name: 'Days per pass', desc: 'New records only; existing ones keep their end time.', control: { type: 'number', key: 'passDays', min: 1, step: 'any', validate: v => (v > 0 ? undefined : 'Enter a number above 0.') } },
			{ name: 'Deadline', desc: DEADLINE_DESC, aliases: ['expiry', 'last activation'], control: { type: 'text', key: 'deadline', placeholder: DEFAULT_SETTINGS.deadline, validate: v => (!v.trim() || parseDate(v.trim()) ? undefined : 'Use a date and time with time zone, such as 2027-08-24T23:59:00+09:00.') } },
			{
				type: 'group',
				heading: 'Reminders',
				items: [
					{ name: 'Remind me in Obsidian', desc: 'Show a notice once when the current pass is about to end, and when the latest start that still fits every pass is near.', control: { type: 'toggle', key: 'inAppReminders' } },
					{ name: 'Hours ahead', desc: 'How early the notice appears.', control: { type: 'number', key: 'reminderLeadHours', min: 1, step: 1, validate: v => (v > 0 ? undefined : 'Enter a number above 0.') } },
					{ name: 'Calendar alerts before the end', desc: 'Minutes, comma separated. Used in the .ics export.', aliases: ['ics', 'calendar'], control: { type: 'text', key: 'reminderOffsets', placeholder: DEFAULT_SETTINGS.reminderOffsets } }
				]
			},
			{
				type: 'group',
				heading: 'Exports',
				items: [
					{ name: 'Calendar file', desc: 'Where the .ics export is saved.', control: { type: 'text', key: 'icsPath', placeholder: DEFAULT_SETTINGS.icsPath } },
					{ name: 'Report note', control: { type: 'text', key: 'reportPath', placeholder: DEFAULT_SETTINGS.reportPath } }
				]
			},
			{
				type: 'group',
				heading: 'Appearance',
				items: [
					{ name: 'Paper and ink style', desc: 'Paper background, ink lines and serif numbers. Off follows your theme.', control: { type: 'toggle', key: 'paperStyle' } }
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

		new Setting(containerEl).setName('Pass name').addText(t => t.setValue(s.passName).onChange(v => set('passName', v)));
		new Setting(containerEl).setName('Total uses').addText(t => {
			t.inputEl.type = 'number';
			t.setValue(String(s.totalUses)).onChange(v => set('totalUses', Number(v)));
		});
		new Setting(containerEl).setName('Days per pass').setDesc('New records only; existing ones keep their end time.').addText(t => {
			t.inputEl.type = 'number';
			t.setValue(String(s.passDays)).onChange(v => set('passDays', Number(v)));
		});
		new Setting(containerEl).setName('Deadline').setDesc(DEADLINE_DESC).addText(t => t.setValue(s.deadline).onChange(v => set('deadline', v)));

		new Setting(containerEl).setName('Reminders').setHeading();
		new Setting(containerEl).setName('Remind me in Obsidian').setDesc('Show a notice once when the current pass is about to end, and when the latest start that still fits every pass is near.')
			.addToggle(t => t.setValue(s.inAppReminders).onChange(v => set('inAppReminders', v)));
		new Setting(containerEl).setName('Hours ahead').addText(t => {
			t.inputEl.type = 'number';
			t.setValue(String(s.reminderLeadHours)).onChange(v => set('reminderLeadHours', Number(v)));
		});
		new Setting(containerEl).setName('Calendar alerts before the end').setDesc('Minutes, comma separated. Used in the .ics export.')
			.addText(t => t.setValue(s.reminderOffsets).onChange(v => set('reminderOffsets', v)));

		new Setting(containerEl).setName('Exports').setHeading();
		new Setting(containerEl).setName('Calendar file').addText(t => t.setValue(s.icsPath).onChange(v => set('icsPath', v)));
		new Setting(containerEl).setName('Report note').addText(t => t.setValue(s.reportPath).onChange(v => set('reportPath', v)));

		new Setting(containerEl).setName('Appearance').setHeading();
		new Setting(containerEl).setName('Paper and ink style').setDesc('Paper background, ink lines and serif numbers. Off follows your theme.')
			.addToggle(t => t.setValue(s.paperStyle).onChange(v => set('paperStyle', v)));
	}
}

const DEADLINE_DESC = 'Last moment you can activate, with time zone, such as 2027-08-24T23:59:00+09:00.';

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
		case 'paperStyle': s.paperStyle = value === true; break;
		case 'inAppReminders': s.inAppReminders = value === true; break;
		case 'reminderOffsets': s.reminderOffsets = asText(value); break;
		case 'passName': case 'icsPath': case 'reportPath': s[key] = asText(value).trim() || DEFAULT_SETTINGS[key]; break;
	}
}
