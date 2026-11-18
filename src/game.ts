export type Rng = () => number;
export type Boxes = string[] | "all" | null; // null = param missing/invalid = no restriction

export interface Params {
	time: number; // seconds
	parallel: number; // doors open at once
	boxes: Boxes;
	minopen: number; // ms a door must have been open to count
	stuck: number; // ms to wait for the OPEN event
	lang: "de" | "en";
	canSwitch: boolean;
	debug: boolean;
}

export interface Score {name: string; score: number; date: string}

const int = (v: string | null, d: number) => {
	const n = parseInt(v ?? "", 10);
	return Number.isFinite(n) ? n : d;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "2-10,12" -> ["2",...,"10","12"]; "all" -> "all"; empty/garbage -> null. Non-numeric items are kept as literal box numbers. */
export function parseBoxes(v: string | null): Boxes {
	const s = v?.trim().toLowerCase();
	if (!s) return null;
	if (s === "all") return "all";
	const out = new Set<string>();
	for (const part of s.split(",").map(p => p.trim()).filter(Boolean)) {
		const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
		if (m) {
			const [a, b] = [+m[1], +m[2]].sort((x, y) => x - y);
			if (b - a > 999) continue; // ponytail: silly ranges are ignored, not clamped
			for (let i = a; i <= b; i++) out.add(String(i));
		} else out.add(part);
	}
	return out.size ? [...out] : null;
}

export function parseParams(search: string): Params {
	const q = new URLSearchParams(search);
	// explicit `lang` wins, else derive from the kiosk's `locale` (de* -> de, other -> en), else de
	const explicit = q.get("lang");
	const locale = q.get("locale")?.trim().toLowerCase();
	const lang = explicit === "en" || explicit === "de" ? explicit : locale ? (locale.startsWith("de") ? "de" : "en") : "de";
	const langs = q.get("languages")?.toLowerCase().split(",").map(l => l.trim().slice(0, 2));
	return {
		time: clamp(int(q.get("time"), 60), 10, 600),
		parallel: clamp(int(q.get("parallel"), 2), 1, 3),
		boxes: parseBoxes(q.get("boxes")),
		minopen: clamp(int(q.get("minopen"), 400), 0, 5000),
		stuck: clamp(int(q.get("stuck"), 4000), 500, 60000),
		lang,
		canSwitch: !langs || (langs.includes("de") && langs.includes("en")),
		debug: q.get("debug") === "1",
	};
}

export interface Comp {number: string; enabled?: boolean; types?: string[]}

/** Playable set: enabled, non-Master compartments (SDK order), optionally restricted by `boxes`. */
export function eligibleBoxes(boxes: Boxes, comps: Comp[]): string[] {
	return comps
		.filter(c => c.enabled === true && !(c.types ?? []).some(t => String(t).toLowerCase() === "master"))
		.map(c => c.number)
		.filter(n => !Array.isArray(boxes) || boxes.includes(n));
}

/** Random playable box that is not in `busy`; avoids `last` if anything else is left. */
export function pickNext(playable: string[], busy: Set<string>, last: string | null, rng: Rng = Math.random): string | null {
	const free = playable.filter(b => !busy.has(b));
	const pool = free.filter(b => b !== last);
	const from = pool.length ? pool : free;
	return from.length ? from[Math.floor(rng() * from.length)] : null;
}

export const TOP = 10;

/** Rank (1-based) the score would get, or 0 if it does not make the top list. Ties rank behind existing entries. */
export function rankOf(list: Score[], score: number): number {
	if (score <= 0) return 0;
	const r = list.filter(e => e.score >= score).length + 1;
	return r <= TOP ? r : 0;
}

export function insertScore(list: Score[], entry: Score): Score[] {
	const r = rankOf(list, entry.score);
	if (!r) return list;
	return [...list.slice(0, r - 1), entry, ...list.slice(r - 1)].slice(0, TOP);
}

/** Parse stored highscores defensively. */
export function parseScores(raw: string | null): Score[] {
	try {
		const a = JSON.parse(raw ?? "[]");
		return Array.isArray(a)
			? a.filter(e => e && typeof e.name === "string" && Number.isFinite(e.score)).sort((x, y) => y.score - x.score).slice(0, TOP)
			: [];
	} catch {
		return [];
	}
}
