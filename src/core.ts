export const MS_MINUTE = 60 * 1000;
export const MS_DAY = 24 * 60 * MS_MINUTE;

export interface PassSettings {
	passName: string;
	totalUses: number;
	passDays: number;
	deadline: string; // ISO 8601 with offset, e.g. 2027-08-24T23:59:00+09:00
	/** "activate": the deadline is the last moment to start a pass. "finish": every pass must also end by it. */
	deadlineMode: DeadlineMode;
	reminderOffsets: string; // minutes before expiry, comma separated
	icsPath: string;
	reportPath: string;
	inAppReminders: boolean;
	reminderLeadHours: number;
}

export type DeadlineMode = 'activate' | 'finish';

/** Sample records carry this ID prefix; they are never exported or reminded about. */
export const SAMPLE_PREFIX = 'sample-';

export function isSample(record: { id: string }): boolean {
	return record.id.startsWith(SAMPLE_PREFIX);
}

/** The data without sample records, for exports and reminders. */
export function withoutSamples(data: PassData): PassData {
	return { ...data, records: data.records.filter(record => !isSample(record)) };
}

export interface PassRecord {
	id: string;
	activatedAt: string; // ISO
	expiresAt: string; // ISO
	label: string; // short tag, e.g. last characters of a code; never the full code
	note: string;
	createdAt: string;
}

export interface PassData {
	settings: PassSettings;
	records: PassRecord[];
	/** Keys of in-app reminders already shown, so each one appears once. */
	notified: string[];
}

export const DEFAULT_SETTINGS: PassSettings = {
	passName: 'povo2.0 7-day unlimited data',
	totalUses: 52,
	passDays: 7,
	deadline: '2027-08-24T23:59:00+09:00',
	deadlineMode: 'activate',
	reminderOffsets: '720,60,0',
	icsPath: 'Pass Countdown/reminders.ics',
	reportPath: 'Pass Countdown/report.md',
	inAppReminders: true,
	reminderLeadHours: 12
};

export type Tone = 'normal' | 'good' | 'warn' | 'danger';

export interface PassStats {
	total: number;
	used: number;
	remaining: number;
	active: PassRecord | null;
	activeEndsAt: Date | null;
	/** Last moment a pass can start: the deadline itself, or one pass length before it in "finish" mode. */
	deadline: Date | null;
	daysToDeadline: number | null;
	daysPerUse: number | null;
	latestNextActivation: Date | null;
	/** How many of the remaining passes can still start before the deadline, back to back. */
	fitBeforeDeadline: number | null;
	cadenceTone: Tone;
}

export function parseDate(value: string | undefined | null): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date : null;
}

export function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * MS_DAY);
}

export function sortRecords(records: PassRecord[], direction: 'asc' | 'desc' = 'asc'): PassRecord[] {
	const sorted = [...records].sort((a, b) => (parseDate(a.activatedAt)?.getTime() ?? 0) - (parseDate(b.activatedAt)?.getTime() ?? 0));
	return direction === 'desc' ? sorted.reverse() : sorted;
}

/** Records whose window covers `at`. */
export function activeRecords(records: PassRecord[], at: Date): PassRecord[] {
	return records.filter(record => {
		const start = parseDate(record.activatedAt);
		const end = parseDate(record.expiresAt);
		return !!start && !!end && start <= at && end > at;
	});
}

/** Records whose window overlaps [start, end). */
export function overlappingRecords(records: PassRecord[], start: Date, end: Date, ignoreId?: string): PassRecord[] {
	return records.filter(record => {
		if (record.id === ignoreId) return false;
		const s = parseDate(record.activatedAt);
		const e = parseDate(record.expiresAt);
		return !!s && !!e && s < end && e > start;
	});
}

export function computeStats(data: PassData, now: Date): PassStats {
	const { settings } = data;
	const total = Math.max(0, Math.floor(settings.totalUses));
	const used = data.records.length;
	const remaining = Math.max(total - used, 0);
	const setDeadline = parseDate(settings.deadline);
	const deadline = setDeadline && settings.deadlineMode === 'finish' ? addDays(setDeadline, -settings.passDays) : setDeadline;
	const daysToDeadline = deadline ? (deadline.getTime() - now.getTime()) / MS_DAY : null;

	const current = activeRecords(data.records, now)
		.sort((a, b) => (parseDate(a.expiresAt)?.getTime() ?? 0) - (parseDate(b.expiresAt)?.getTime() ?? 0));
	const active = current[0] ?? null;
	const activeEndsAt = active ? parseDate(active.expiresAt) : null;

	// To fit every remaining pass back to back before the deadline, the next one
	// must start no later than deadline - (remaining - 1) * passDays.
	const latestNextActivation = deadline && remaining > 0
		? addDays(deadline, -Math.max(remaining - 1, 0) * settings.passDays)
		: null;
	const daysPerUse = remaining > 0 && daysToDeadline !== null && daysToDeadline > 0
		? daysToDeadline / remaining
		: null;

	// The next pass can start once the current one ends; each later one passDays after that.
	let fitBeforeDeadline: number | null = null;
	if (deadline && remaining > 0) {
		const earliestNext = Math.max(now.getTime(), activeEndsAt?.getTime() ?? 0);
		fitBeforeDeadline = deadline.getTime() < earliestNext
			? 0
			: Math.min(remaining, Math.floor((deadline.getTime() - earliestNext) / (settings.passDays * MS_DAY)) + 1);
	}

	let cadenceTone: Tone = 'normal';
	if (remaining > 0 && daysToDeadline !== null) {
		if (daysToDeadline <= 0) cadenceTone = 'danger';
		else if (fitBeforeDeadline !== null && fitBeforeDeadline < remaining) cadenceTone = 'warn';
		else cadenceTone = 'good';
	}

	return { total, used, remaining, active, activeEndsAt, deadline, daysToDeadline, daysPerUse, latestNextActivation, fitBeforeDeadline, cadenceTone };
}

export function parseReminderOffsets(value: string): number[] {
	const offsets = String(value || '')
		.split(',')
		.map(item => Number.parseInt(item.trim(), 10))
		.filter(item => Number.isFinite(item) && item >= 0);
	return offsets.length > 0 ? Array.from(new Set(offsets)).sort((a, b) => b - a) : [720, 60, 0];
}

export function createRecord(settings: PassSettings, activatedAt: Date, label: string, note: string, now: Date, id: string): PassRecord {
	return {
		id,
		activatedAt: activatedAt.toISOString(),
		expiresAt: addDays(activatedAt, settings.passDays).toISOString(),
		label: label.trim(),
		note: note.trim(),
		createdAt: now.toISOString()
	};
}

export function icsEscape(value: string): string {
	return String(value || '')
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n');
}

export function toIcsUtc(date: Date): string {
	return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function minutesToIcsDuration(minutes: number): string {
	if (minutes === 0) return 'PT0S';
	let left = Math.abs(minutes);
	const days = Math.floor(left / (24 * 60));
	left -= days * 24 * 60;
	const hours = Math.floor(left / 60);
	left -= hours * 60;
	const datePart = days > 0 ? `${days}D` : '';
	const timePart = `${hours > 0 ? `${hours}H` : ''}${left > 0 ? `${left}M` : ''}`;
	return `-P${datePart}${timePart ? `T${timePart}` : ''}`;
}

function describeOffset(minutes: number): string {
	if (minutes === 0) return 'expires now';
	if (minutes % 60 === 0) return `expires in ${minutes / 60} h`;
	return `expires in ${minutes} min`;
}

/** iCalendar file with one event per pass and alarms before it ends. */
export function buildIcs(data: PassData, now: Date): string {
	const { settings } = data;
	const offsets = parseReminderOffsets(settings.reminderOffsets);
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Pass Countdown//Obsidian//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH'
	];
	sortRecords(data.records).forEach((record, index) => {
		const start = parseDate(record.activatedAt);
		const end = parseDate(record.expiresAt);
		if (!start || !end) return;
		const summary = `${settings.passName} (${index + 1}/${settings.totalUses})`;
		const details = [`Started ${start.toISOString()}`, `Ends ${end.toISOString()}`];
		if (record.label) details.push(`Label: ${record.label}`);
		if (record.note) details.push(record.note);
		lines.push(
			'BEGIN:VEVENT',
			`UID:pass-countdown-${record.id}`,
			`DTSTAMP:${toIcsUtc(now)}`,
			`DTSTART:${toIcsUtc(start)}`,
			`DTEND:${toIcsUtc(end)}`,
			`SUMMARY:${icsEscape(summary)}`,
			`DESCRIPTION:${icsEscape(details.join('\n'))}`
		);
		for (const minutes of offsets) {
			lines.push(
				'BEGIN:VALARM',
				'ACTION:DISPLAY',
				`DESCRIPTION:${icsEscape(`${settings.passName} ${describeOffset(minutes)}`)}`,
				`TRIGGER;RELATED=END:${minutesToIcsDuration(minutes)}`,
				'END:VALARM'
			);
		}
		lines.push('END:VEVENT');
	});
	lines.push('END:VCALENDAR');
	return `${lines.join('\r\n')}\r\n`;
}

function escapeCell(value: string): string {
	return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function buildMarkdownReport(data: PassData, now: Date, formatDate: (date: Date) => string): string {
	const stats = computeStats(data, now);
	const rows = sortRecords(data.records).map((record, index) => {
		const start = parseDate(record.activatedAt);
		const end = parseDate(record.expiresAt);
		return `| ${index + 1} | ${start ? formatDate(start) : '—'} | ${end ? formatDate(end) : '—'} | ${escapeCell(record.label)} | ${escapeCell(record.note)} |`;
	});
	return [
		'---',
		'type: pass-countdown-report',
		`pass: ${JSON.stringify(data.settings.passName)}`,
		`total_uses: ${stats.total}`,
		`used: ${stats.used}`,
		`remaining: ${stats.remaining}`,
		`deadline: ${JSON.stringify(data.settings.deadline)}`,
		`updated: ${JSON.stringify(now.toISOString())}`,
		'---',
		'',
		`# ${data.settings.passName}`,
		'',
		`- Used ${stats.used} of ${stats.total}, ${stats.remaining} left.`,
		stats.deadline ? `- Last activation by ${formatDate(stats.deadline)}.` : '- No deadline set.',
		'',
		'| # | Started | Ends | Label | Note |',
		'| ---: | --- | --- | --- | --- |',
		...rows,
		''
	].join('\n');
}

interface LegacyRecord {
	id?: string;
	activatedAt?: string;
	expiresAt?: string;
	label?: string;
	codeFragment?: string;
	context?: string;
	note?: string;
	createdAt?: string;
}

export function normalizeData(raw: unknown): PassData {
	const input = (raw && typeof raw === 'object' ? raw : {}) as { settings?: Partial<PassSettings> & { codeInputDeadline?: string; totalUses?: number }; records?: LegacyRecord[]; notified?: unknown };
	const legacySettings = input.settings || {};
	// Only known settings are kept; fields of the older single-purpose tracker (Apple Reminders sync) are dropped.
	const settings: PassSettings = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof PassSettings)[]) {
		const value = legacySettings[key];
		if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) Object.assign(settings, { [key]: value });
	}
	// Older single-purpose tracker stored the deadline under another name.
	if (!legacySettings.deadline && legacySettings.codeInputDeadline) settings.deadline = legacySettings.codeInputDeadline;
	if (settings.deadlineMode !== 'finish') settings.deadlineMode = 'activate';
	settings.totalUses = Math.max(1, Math.floor(Number(settings.totalUses) || DEFAULT_SETTINGS.totalUses));
	settings.passDays = Math.max(1, Number(settings.passDays) || DEFAULT_SETTINGS.passDays);
	settings.inAppReminders = settings.inAppReminders !== false;
	settings.reminderLeadHours = Math.max(0, Number(settings.reminderLeadHours) || 0) || DEFAULT_SETTINGS.reminderLeadHours;
	const records: PassRecord[] = Array.isArray(input.records)
		? input.records
			.filter(r => !!r && typeof r.id === 'string' && !!parseDate(r.activatedAt) && !!parseDate(r.expiresAt))
			.map(r => ({
				id: r.id as string,
				activatedAt: r.activatedAt as string,
				expiresAt: r.expiresAt as string,
				label: r.label ?? r.codeFragment ?? '',
				note: [r.context, r.note].filter(Boolean).join(' / '),
				createdAt: r.createdAt || (r.activatedAt as string)
			}))
		: [];
	const notified = Array.isArray(input.notified) ? input.notified.filter((key): key is string => typeof key === 'string').slice(-200) : [];
	return { settings, records, notified };
}

/** Read a record from note frontmatter with activated_at / expires_at fields. */
export function recordFromFrontmatter(fm: Record<string, unknown> | undefined, fallbackId: string, settings: PassSettings): PassRecord | null {
	if (!fm) return null;
	const start = parseDate(typeof fm.activated_at === 'string' ? fm.activated_at : undefined);
	if (!start) return null;
	const end = parseDate(typeof fm.expires_at === 'string' ? fm.expires_at : undefined) ?? addDays(start, settings.passDays);
	const id = typeof fm.activation_id === 'string' && fm.activation_id ? fm.activation_id : fallbackId;
	return { id, activatedAt: start.toISOString(), expiresAt: end.toISOString(), label: '', note: '', createdAt: start.toISOString() };
}

/**
 * Change when a recorded pass started, keeping its own length (which may differ
 * from the current "days per pass" if that setting changed since).
 */
export function editRecord(record: PassRecord, activatedAt: Date, label: string, note: string): PassRecord {
	const start = parseDate(record.activatedAt);
	const end = parseDate(record.expiresAt);
	const length = start && end ? end.getTime() - start.getTime() : 0;
	return {
		...record,
		activatedAt: activatedAt.toISOString(),
		expiresAt: new Date(activatedAt.getTime() + length).toISOString(),
		label: label.trim(),
		note: note.trim()
	};
}

export interface DueReminder {
	key: string;
	kind: 'ending' | 'start-by';
	at: Date;
}

/**
 * Reminders that are due now and not yet shown: the running pass ends within the
 * lead time, or the latest start that still fits every pass is within it.
 */
export function dueReminders(data: PassData, now: Date): DueReminder[] {
	const { settings } = data;
	if (!settings.inAppReminders) return [];
	const lead = settings.reminderLeadHours * 3_600_000;
	const seen = new Set(data.notified);
	const stats = computeStats(data, now);
	const due: DueReminder[] = [];
	if (stats.active && stats.activeEndsAt) {
		const left = stats.activeEndsAt.getTime() - now.getTime();
		const key = `ending:${stats.active.id}`;
		if (left > 0 && left <= lead && !seen.has(key)) due.push({ key, kind: 'ending', at: stats.activeEndsAt });
	}
	const next = stats.latestNextActivation;
	if (next && stats.remaining > 0 && stats.fitBeforeDeadline === stats.remaining) {
		const left = next.getTime() - now.getTime();
		const key = `start-by:${next.toISOString()}`;
		// Only useful when nothing is running past that moment.
		const coveredUntil = stats.activeEndsAt?.getTime() ?? 0;
		if (left > 0 && left <= lead && coveredUntil < next.getTime() && !seen.has(key)) due.push({ key, kind: 'start-by', at: next });
	}
	return due;
}
