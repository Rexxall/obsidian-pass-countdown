import { BasesEntry, BasesPropertyId, BasesView, BasesViewRegistration, Keymap, Plugin, QueryController } from 'obsidian';
import { byClosest, elapsed, parseWhen, timeLeft, When } from './countdown';
import { rawValue } from './basesSupport';
import { tr } from './i18n';

export const COUNTDOWN_VIEW_ID = 'pass-countdown-countdown';

interface Card {
	entry: BasesEntry;
	end: When;
	start: When | null;
}

function whenOf(plugin: Plugin, entry: BasesEntry, prop: BasesPropertyId | null): When | null {
	return prop ? parseWhen(rawValue(plugin, entry, prop)) : null;
}

/** The first visible property that most entries hold as a date, so the view works before anything is chosen. */
function guessDateProperty(plugin: Plugin, view: BasesView): BasesPropertyId | null {
	const entries = view.data.data.slice(0, 50);
	if (!entries.length) return null;
	for (const prop of view.config.getOrder()) {
		if (prop.startsWith('file.')) continue;
		const dated = entries.filter(entry => whenOf(plugin, entry, prop)).length;
		if (dated * 2 >= entries.length) return prop;
	}
	return null;
}

function formatWhen(when: When): string {
	const options: Intl.DateTimeFormatOptions = when.allDay
		? { month: 'short', day: 'numeric', weekday: 'short' }
		: { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' };
	if (when.date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
	return when.date.toLocaleString(undefined, options);
}

/** The large number and its unit, and the tone of the card. */
function headline(when: When, now: Date): { value: string; unit: string; tone: string } {
	const left = timeLeft(when, now);
	if (left.past) {
		const ago = left.days > 0 ? { value: String(left.days), unit: tr(left.days === 1 ? 'day ago' : 'days ago', '天前') } : left.hours > 0 ? { value: String(left.hours), unit: tr('h ago', '小时前') } : { value: String(left.minutes), unit: tr('min ago', '分钟前') };
		return { ...ago, tone: 'is-past' };
	}
	if (when.allDay && left.days === 0) return { value: tr('Today', '今天'), unit: '', tone: 'is-bad' };
	const tone = left.days < 1 ? 'is-bad' : left.days < 7 ? 'is-warn' : 'is-accent';
	if (left.days > 0) return { value: String(left.days), unit: tr(left.days === 1 ? 'day' : 'days', '天'), tone };
	if (left.hours > 0) return { value: String(left.hours), unit: tr('h', '小时'), tone };
	return { value: String(left.minutes), unit: tr('min', '分钟'), tone };
}

/** The countdown view for Bases: one card per note, counting down to the date in a chosen property. */
export function countdownViewRegistration(plugin: Plugin): BasesViewRegistration {
	class CountdownView extends BasesView {
		type = COUNTDOWN_VIEW_ID;
		private root: HTMLElement;

		constructor(controller: QueryController, parent: HTMLElement) {
			super(controller);
			this.root = parent.createDiv({ cls: 'pass-countdown ap pc-bases' });
			// Minutes tick over while the base stays open.
			this.registerInterval(window.setInterval(() => this.render(), 60_000));
		}

		onDataUpdated(): void {
			this.render();
		}

		private render(): void {
			const now = new Date();
			const endProp = this.config.getAsPropertyId('end') ?? guessDateProperty(plugin, this);
			const startProp = this.config.getAsPropertyId('start');
			const showPast = this.config.get('showPast') !== false;
			this.root.empty();

			const cards: { item: Card; when: When }[] = [];
			let undated = 0;
			for (const entry of this.data.data) {
				const end = whenOf(plugin, entry, endProp);
				if (!end) { undated++; continue; }
				cards.push({ item: { entry, end, start: whenOf(plugin, entry, startProp) }, when: end });
			}

			if (!cards.length) {
				const empty = this.root.createDiv({ cls: 'ap-empty' });
				empty.createDiv({ cls: 'ap-empty-title', text: endProp ? tr('No dates to count down to', '没有可以倒计时的日期') : tr('Choose a date property', '选一个日期属性') });
				empty.createDiv({
					cls: 'ap-empty-text',
					text: endProp
						? tr(`None of these notes has a date in “${this.config.getDisplayName(endProp)}”.`, `这些笔记的“${this.config.getDisplayName(endProp)}”里都没有日期。`)
						: tr('Open the view options and pick the property that holds the date, such as a deadline.', '在视图选项里选出存日期的属性，比如截止日期。')
				});
				return;
			}

			// Keep the user's own sort when there is one; otherwise soonest first.
			const sorted = this.config.getSort().length
				? { upcoming: cards.filter(c => !timeLeft(c.when, now).past).map(c => c.item), past: cards.filter(c => timeLeft(c.when, now).past).map(c => c.item) }
				: byClosest(cards, now);

			this.renderGrid(sorted.upcoming, now, endProp, startProp);
			if (showPast && sorted.past.length) {
				const section = this.root.createDiv({ cls: 'ap-section pc-bases-past' });
				section.createDiv({ cls: 'ap-section-title', text: tr('Passed', '已过') });
				this.renderGrid(sorted.past, now, endProp, startProp, section);
			}
			if (undated) this.root.createDiv({ cls: 'ap-section-note pc-bases-note', text: tr(`${undated} without a date not shown`, `另有 ${undated} 篇没有日期，未显示`) });
		}

		private renderGrid(items: Card[], now: Date, endProp: BasesPropertyId | null, startProp: BasesPropertyId | null, parent: HTMLElement = this.root): void {
			if (!items.length) return;
			const grid = parent.createDiv({ cls: 'pc-bases-grid' });
			const extra = this.config.getOrder().filter(prop => prop !== 'file.name' && prop !== endProp && prop !== startProp).slice(0, 2);
			for (const card of items) {
				const head = headline(card.end, now);
				const el = grid.createEl('a', { cls: `pc-bases-card ${head.tone}`, href: '#' });
				el.createDiv({ cls: 'pc-bases-title', text: card.entry.file.basename });
				const big = el.createDiv({ cls: 'pc-bases-left' });
				big.createSpan({ cls: head.unit ? 'pc-bases-value' : 'pc-bases-value is-word', text: head.value });
				if (head.unit) big.createSpan({ cls: 'ap-unit', text: head.unit });
				el.createDiv({ cls: 'pc-bases-date', text: formatWhen(card.end) });
				const done = card.start ? elapsed(card.start, card.end, now) : null;
				if (done !== null) {
					const meter = el.createDiv({ cls: 'ap-meter pc-bases-meter', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(done * 100)) } });
					meter.createDiv({ cls: 'ap-meter-fill' }).setCssProps({ '--ap-value': `${done * 100}%` });
				}
				for (const prop of extra) {
					const value = card.entry.getValue(prop);
					const text = value?.toString() ?? '';
					if (!text || text === 'null') continue;
					const line = el.createDiv({ cls: 'pc-bases-extra' });
					line.createSpan({ cls: 'pc-bases-extra-name', text: this.config.getDisplayName(prop) });
					line.createSpan({ text });
				}
				el.addEventListener('click', evt => {
					evt.preventDefault();
					void this.app.workspace.openLinkText(card.entry.file.path, '', Keymap.isModEvent(evt));
				});
			}
		}
	}

	return {
		name: tr('Countdown', '倒计时'),
		icon: 'hourglass',
		factory: (controller, containerEl) => new CountdownView(controller, containerEl),
		options: () => [
			{ type: 'property', key: 'end', displayName: tr('Count down to', '倒计时到'), placeholder: tr('A date property, e.g. deadline', '日期属性，比如截止日期') },
			{ type: 'property', key: 'start', displayName: tr('Starts on (shows progress)', '开始日期（显示进度）'), placeholder: tr('Optional', '可不选') },
			{ type: 'toggle', key: 'showPast', displayName: tr('Show dates that have passed', '显示已过的日期'), default: true }
		]
	};
}
