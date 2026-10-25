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
	minutesToIcsDuration,
	normalizeData,
	overlappingRecords,
	parseReminderOffsets,
	recordFromFrontmatter
} from '../src/core';

const settings = { ...DEFAULT_SETTINGS, totalUses: 4, passDays: 7, deadline: '2026-12-31T23:59:00+09:00' };

function data(records: PassData['records'] = []): PassData {
	return { settings, records };
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
