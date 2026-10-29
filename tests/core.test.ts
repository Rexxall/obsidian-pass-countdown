import test from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_SETTINGS,
	MS_DAY,
	PassData,
	buildIcs,
	buildMarkdownReport,
	computeStats,
	createRecord,
	dueReminders,
	editRecord,
	minutesToIcsDuration,
	normalizeData,
	overlappingRecords,
	parseReminderOffsets,
	recordFromFrontmatter
} from '../src/core';

const settings = { ...DEFAULT_SETTINGS, totalUses: 4, passDays: 7, deadline: '2026-12-31T23:59:00+09:00' };

function data(records: PassData['records'] = []): PassData {
	return { settings, records, notified: [] };
}

test('pass ends exactly passDays later, independent of the local time zone', () => {
	const start = new Date('2026-05-06T13:58:32Z');
	const record = createRecord(settings, start, ' ab ', '', start, 'id1');
	assert.equal(record.expiresAt, '2026-05-13T13:58:32.000Z');
	assert.equal(record.label, 'ab');
});

test('stats: remaining, active pass and the latest start that still fits every pass', () => {
	const start = new Date('2026-12-01T00:00:00Z');
	const d = data([createRecord(settings, start, '', '', start, 'a')]);
	const stats = computeStats(d, new Date('2026-12-03T00:00:00Z'));
	assert.equal(stats.used, 1);
	assert.equal(stats.remaining, 3);
	assert.equal(stats.active?.id, 'a');
	// Three passes of 7 days must fit before the deadline: the next must start 14 days before it.
	assert.equal(stats.latestNextActivation?.toISOString(), new Date(new Date(settings.deadline).getTime() - 14 * MS_DAY).toISOString());
	assert.equal(stats.fitBeforeDeadline, 3);
});

test('stats: says how many passes still fit once the latest start has passed', () => {
	const big = { ...settings, totalUses: 52, deadline: '2027-08-24T23:59:00+09:00' };
	const stats = computeStats({ settings: big, records: [] }, new Date('2026-10-25T00:00:00+09:00'));
	// 303.99 days left: passes can start on day 0, 7, ..., 301, so 44 of 52 fit.
	assert.equal(stats.fitBeforeDeadline, 44);
	assert.equal(stats.cadenceTone, 'warn');
	assert.ok(stats.latestNextActivation!.getTime() < new Date('2026-10-25T00:00:00+09:00').getTime());
});

test('pace turns to a warning when fewer days are left than one pass per remaining use needs', () => {
	const stats = computeStats(data(), new Date('2026-12-20T00:00:00+09:00'));
	assert.equal(stats.remaining, 4);
	assert.ok(stats.daysPerUse !== null && stats.daysPerUse < 7);
	assert.equal(stats.cadenceTone, 'warn');
	const late = computeStats(data(), new Date('2027-01-05T00:00:00Z'));
	assert.equal(late.cadenceTone, 'danger');
});

test('overlap detection ignores passes that ended before the new one starts', () => {
	const a = createRecord(settings, new Date('2026-10-01T00:00:00Z'), '', '', new Date(), 'a');
	const b = createRecord(settings, new Date('2026-10-10T00:00:00Z'), '', '', new Date(), 'b');
	const start = new Date('2026-10-12T00:00:00Z');
	const hits = overlappingRecords([a, b], start, new Date(start.getTime() + 7 * MS_DAY));
	assert.deepEqual(hits.map(r => r.id), ['b']);
});

test('reminder offsets are cleaned and sorted, with a safe default', () => {
	assert.deepEqual(parseReminderOffsets('60, x, 720,0,60'), [720, 60, 0]);
	assert.deepEqual(parseReminderOffsets(''), [720, 60, 0]);
	assert.equal(minutesToIcsDuration(0), 'PT0S');
	assert.equal(minutesToIcsDuration(720), '-PT12H');
	assert.equal(minutesToIcsDuration(1500), '-P1DT1H');
});

test('ics has one event per pass, alarms before the end, and escapes text', () => {
	const start = new Date('2026-10-01T00:00:00Z');
	const ics = buildIcs({ settings: { ...settings, passName: 'Data, 7 days', reminderOffsets: '60,0' }, records: [createRecord(settings, start, 'x;y', '', start, 'r1')] }, start);
	assert.match(ics, /BEGIN:VEVENT[\s\S]*END:VEVENT/);
	assert.match(ics, /SUMMARY:Data\\, 7 days \(1\/4\)/);
	assert.match(ics, /Label: x\\;y/);
	assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
	assert.match(ics, /TRIGGER;RELATED=END:-PT1H/);
	assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('report escapes table cells', () => {
	const start = new Date('2026-10-01T00:00:00Z');
	const md = buildMarkdownReport(data([createRecord(settings, start, 'a|b', 'line1\nline2', start, 'r')]), start, d => d.toISOString());
	assert.match(md, /a\\\|b/);
	assert.match(md, /line1<br>line2/);
});

test('reads data saved by the older single-purpose tracker', () => {
	const legacy = {
		settings: { totalUses: 52, codeInputDeadline: '2027-08-24T23:59:00+09:00' },
		records: [{ id: 'old', activatedAt: '2026-04-29T10:31:00.000Z', expiresAt: '2026-05-06T10:31:00.000Z', codeFragment: 'll', context: 'trip', note: '' }, { bad: true }]
	};
	const d = normalizeData(legacy);
	assert.equal(d.settings.deadline, '2027-08-24T23:59:00+09:00');
	assert.equal(d.records.length, 1);
	assert.equal(d.records[0].label, 'll');
	assert.equal(d.records[0].note, 'trip');
});

test('imports a record from note frontmatter', () => {
	const r = recordFromFrontmatter({ activation_id: '202605062258', activated_at: '2026-05-06T22:58:32+09:00', expires_at: '2026-05-13T22:58:32+09:00' }, 'fallback', settings);
	assert.equal(r?.id, '202605062258');
	assert.equal(r?.activatedAt, '2026-05-06T13:58:32.000Z');
	assert.equal(recordFromFrontmatter({ title: 'not a pass' }, 'x', settings), null);
	const noEnd = recordFromFrontmatter({ activated_at: '2026-05-06T00:00:00Z' }, 'n', settings);
	assert.equal(noEnd?.expiresAt, '2026-05-13T00:00:00.000Z');
});

test('editing a record moves its start and keeps its own length', () => {
	const start = new Date('2026-10-01T00:00:00Z');
	// Recorded when passes were 3 days long; the setting is 7 days now.
	const old = createRecord({ ...settings, passDays: 3 }, start, 'a', '', start, 'e');
	const moved = editRecord(old, new Date('2026-10-02T06:00:00Z'), ' b ', 'n');
	assert.equal(moved.expiresAt, '2026-10-05T06:00:00.000Z');
	assert.equal(moved.label, 'b');
	assert.equal(moved.id, 'e');
	assert.equal(moved.createdAt, old.createdAt);
});

test('in-app reminders: once each, only within the lead time', () => {
	const s = { ...settings, totalUses: 2, deadline: '2026-12-31T23:59:00Z', reminderLeadHours: 12, inAppReminders: true };
	const start = new Date('2026-10-01T00:00:00Z');
	const d: PassData = { settings: s, records: [createRecord(s, start, '', '', start, 'p')], notified: [] };
	// 7 days later minus 13 h: not yet.
	assert.equal(dueReminders(d, new Date('2026-10-07T11:00:00Z')).length, 0);
	const due = dueReminders(d, new Date('2026-10-07T13:00:00Z'));
	assert.deepEqual(due.map(r => r.kind), ['ending']);
	d.notified.push(due[0].key);
	assert.equal(dueReminders(d, new Date('2026-10-07T20:00:00Z')).length, 0);
	// One pass left: the latest start is the deadline itself.
	const near = dueReminders(d, new Date('2026-12-31T12:00:00Z'));
	assert.deepEqual(near.map(r => r.kind), ['start-by']);
	assert.equal(dueReminders({ ...d, settings: { ...s, inAppReminders: false } }, new Date('2026-12-31T12:00:00Z')).length, 0);
});

test('new settings get defaults and the reminder log is kept', () => {
	const d = normalizeData({ settings: { passName: 'x' }, records: [], notified: ['ending:a', 3] });
	assert.equal(d.settings.inAppReminders, true);
	assert.equal(d.settings.reminderLeadHours, 12);
	assert.deepEqual(d.notified, ['ending:a']);
});

test('the deadline is the last moment to activate: a last pass may start right at it and run past it', () => {
	const s = { ...settings, totalUses: 1, deadline: '2026-12-31T23:59:00Z' };
	const stats = computeStats({ settings: s, records: [], notified: [] }, new Date('2026-12-31T00:00:00Z'));
	assert.equal(stats.latestNextActivation?.toISOString(), '2026-12-31T23:59:00.000Z');
	assert.equal(stats.fitBeforeDeadline, 1);
	assert.equal(stats.cadenceTone, 'good');
	// Two left and less than one pass length before the deadline: only one can still start.
	const two = computeStats({ settings: { ...s, totalUses: 2 }, records: [], notified: [] }, new Date('2026-12-31T00:00:00Z'));
	assert.equal(two.fitBeforeDeadline, 1);
	assert.equal(two.cadenceTone, 'warn');
});

test('"finish" mode: every pass must also end by the deadline, so the last start is one pass earlier', () => {
	const s = { ...settings, totalUses: 1, deadline: '2026-12-31T23:59:00Z', deadlineMode: 'finish' as const };
	const stats = computeStats({ settings: s, records: [], notified: [] }, new Date('2026-12-20T00:00:00Z'));
	assert.equal(stats.latestNextActivation?.toISOString(), '2026-12-24T23:59:00.000Z');
	assert.equal(stats.deadline?.toISOString(), '2026-12-24T23:59:00.000Z');
	// Past that point nothing can be started and still finish in time.
	const late = computeStats({ settings: s, records: [], notified: [] }, new Date('2026-12-26T00:00:00Z'));
	assert.equal(late.fitBeforeDeadline, 0);
	assert.equal(late.cadenceTone, 'danger');
});

test('full data of the older tracker (shape of a real file, values made up) migrates without loss', () => {
	const records = Array.from({ length: 12 }, (_, i) => {
		const start = new Date(Date.UTC(2026, 3, 29 + i * 7, 10, 31));
		return { id: `mov${i}`, activatedAt: start.toISOString(), expiresAt: new Date(start.getTime() + 7 * MS_DAY).toISOString(), codeFragment: i % 2 ? 'xy' : '', context: '', note: i === 3 ? 'exam week' : '', createdAt: start.toISOString(), updatedAt: start.toISOString() };
	});
	const legacy = {
		settings: { totalUses: 52, codeInputDeadline: '2027-08-24T23:59:00+09:00', reportPath: 'Notes/povo report.md', icsPath: 'Notes/povo.ics', reminderOffsets: '720,60', autoSyncAppleReminders: true, appleReminderListName: 'List', appleReminderLeadMinutes: 0 },
		records
	};
	const d = normalizeData(legacy);
	assert.equal(d.records.length, 12);
	assert.deepEqual(d.records.map(r => r.activatedAt), records.map(r => r.activatedAt));
	assert.equal(d.records[3].note, 'exam week');
	assert.equal(d.settings.reportPath, 'Notes/povo report.md');
	assert.equal(d.settings.reminderOffsets, '720,60');
	assert.equal(d.settings.deadlineMode, 'activate');
	assert.ok(!('autoSyncAppleReminders' in d.settings), 'fields of the old tracker are dropped');
	assert.equal(computeStats(d, new Date('2026-07-20T00:00:00Z')).remaining, 40);
});
