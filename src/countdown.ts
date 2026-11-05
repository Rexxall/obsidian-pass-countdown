import { MS_DAY } from './core';

/** A point in time read from a note property. `allDay` is true when only a date was written. */
export interface When {
	date: Date;
	allDay: boolean;
}

/**
 * Reads a property value as a time: `2026-11-14`, `2026-11-14T09:30`, `2026-11-14 09:30`, a full ISO string,
 * a Date or milliseconds. A date alone is that day in local time. Anything else is null.
 */
export function parseWhen(raw: unknown): When | null {
	if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? { date: raw, allDay: false } : null;
	if (typeof raw === 'number') return Number.isFinite(raw) && raw > 1e11 ? { date: new Date(raw), allDay: false } : null;
	if (typeof raw !== 'string') return null;
	const text = raw.trim();
	const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (day) {
		const date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
		return date.getMonth() === Number(day[2]) - 1 ? { date, allDay: true } : null;
	}
	if (!/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(text)) return null;
	const date = new Date(text.replace(' ', 'T'));
	return Number.isFinite(date.getTime()) ? { date, allDay: false } : null;
}

export interface Left {
	past: boolean;
	/** Whole days between the two calendar days, for a date alone; otherwise whole days of the time left. */
	days: number;
	hours: number;
	minutes: number;
	/** The date falls on today's calendar day. */
	today: boolean;
}

function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Time from `now` until `when`. A date alone counts calendar days, so tomorrow is 1 day whatever the hour. */
export function timeLeft(when: When, now: Date): Left {
	const today = startOfDay(when.date) === startOfDay(now);
	if (when.allDay) {
		const days = Math.round((startOfDay(when.date) - startOfDay(now)) / MS_DAY);
		return { past: days < 0, days: Math.abs(days), hours: 0, minutes: 0, today };
	}
	const ms = when.date.getTime() - now.getTime();
	const abs = Math.abs(ms);
	return {
		past: ms < 0,
		days: Math.floor(abs / MS_DAY),
		hours: Math.floor((abs % MS_DAY) / 3_600_000),
		minutes: Math.floor((abs % 3_600_000) / 60_000),
		today
	};
}

/** How far `now` is from `start` to `end`, between 0 and 1; null when the span is empty or reversed. */
export function elapsed(start: When, end: When, now: Date): number | null {
	const from = start.date.getTime();
	const to = end.allDay ? startOfDay(end.date) + MS_DAY : end.date.getTime();
	if (!(to > from)) return null;
	return Math.min(Math.max((now.getTime() - from) / (to - from), 0), 1);
}

/** Upcoming first, soonest first; then past, most recent first. */
export function byClosest<T>(items: { item: T; when: When }[], now: Date): { upcoming: T[]; past: T[] } {
	const time = (when: When) => (when.allDay ? startOfDay(when.date) + MS_DAY - 1 : when.date.getTime());
	const upcoming = items.filter(x => !timeLeft(x.when, now).past).sort((a, b) => time(a.when) - time(b.when));
	const past = items.filter(x => timeLeft(x.when, now).past).sort((a, b) => time(b.when) - time(a.when));
	return { upcoming: upcoming.map(x => x.item), past: past.map(x => x.item) };
}
