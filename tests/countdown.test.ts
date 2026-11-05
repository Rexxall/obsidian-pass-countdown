import test from 'node:test';
import assert from 'node:assert/strict';
import { byClosest, elapsed, parseWhen, timeLeft } from '../src/countdown';

test('dates, times and junk are read as written', () => {
	assert.deepEqual(parseWhen('2026-11-14'), { date: new Date(2026, 10, 14), allDay: true });
	assert.equal(parseWhen('2026-11-14 09:30')?.allDay, false);
	assert.equal(parseWhen('2026-11-14T09:30')?.date.getHours(), 9);
	assert.equal(parseWhen('2026-02-30'), null);
	assert.equal(parseWhen('next friday'), null);
	assert.equal(parseWhen(42), null);
	assert.equal(parseWhen(null), null);
});

test('a date alone counts calendar days, whatever the hour', () => {
	const late = new Date(2026, 10, 13, 23, 50);
	assert.deepEqual(timeLeft(parseWhen('2026-11-14')!, late), { past: false, days: 1, hours: 0, minutes: 0, today: false });
	assert.deepEqual(timeLeft(parseWhen('2026-11-13')!, late), { past: false, days: 0, hours: 0, minutes: 0, today: true });
	assert.equal(timeLeft(parseWhen('2026-11-12')!, late).past, true);
});

test('a time counts down to the minute and past times count up', () => {
	const now = new Date(2026, 10, 13, 8, 0);
	assert.deepEqual(timeLeft(parseWhen('2026-11-14 10:30')!, now), { past: false, days: 1, hours: 2, minutes: 30, today: false });
	const ago = timeLeft(parseWhen('2026-11-13 07:15')!, now);
	assert.equal(ago.past, true);
	assert.equal(ago.minutes, 45);
});

test('progress runs from the start to the end of the last day', () => {
	const start = parseWhen('2026-11-01')!;
	const end = parseWhen('2026-11-10')!;
	assert.equal(elapsed(start, end, new Date(2026, 9, 1)), 0);
	assert.equal(elapsed(start, end, new Date(2026, 10, 6)), 0.5);
	assert.equal(elapsed(start, end, new Date(2026, 11, 1)), 1);
	assert.equal(elapsed(end, start, new Date(2026, 10, 6)), null);
});

test('upcoming soonest first, then past most recent first; today counts as upcoming', () => {
	const now = new Date(2026, 10, 13, 12, 0);
	const items = ['2026-11-20', '2026-11-13', '2026-11-01', '2026-11-12', '2026-11-15 09:00'].map(text => ({ item: text, when: parseWhen(text)! }));
	assert.deepEqual(byClosest(items, now), { upcoming: ['2026-11-13', '2026-11-15 09:00', '2026-11-20'], past: ['2026-11-12', '2026-11-01'] });
});
