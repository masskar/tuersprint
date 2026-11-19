export type Rng = () => number;
export type Boxes = string[] | "all" | null; // null = param missing/invalid = no restriction

export interface Params {
	time: number; // seconds
	parallel: number; // doors open at once at the start
	maxparallel: number; // ramp ceiling
	step: number; // points per extra open door
	boxes: Boxes;
	minopen: number; // ms a door must have been open to count
	stuck: number; // ms to wait for the OPEN event
	lang: "de" | "en";
	canSwitch: boolean;
	debug: boolean;
	controller: string; // host of the controller that verifies service codes
	controllerport: number;
	svcidle: number; // ms of no touch before Service mode exits (shortenable only with debug=1)
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
	const parallel = clamp(int(q.get("parallel"), 3), 1, 8);
	const debug = q.get("debug") === "1";
	return {
		time: clamp(int(q.get("time"), 60), 10, 600),
		parallel,
		maxparallel: clamp(int(q.get("maxparallel"), 6), parallel, 8),
		step: clamp(int(q.get("step"), 5), 1, 100),
		boxes: parseBoxes(q.get("boxes")),
		minopen: clamp(int(q.get("minopen"), 400), 0, 5000),
		stuck: clamp(int(q.get("stuck"), 4000), 500, 60000),
		lang,
		canSwitch: !langs || (langs.includes("de") && langs.includes("en")),
		debug,
		controller: /^[A-Za-z0-9.-]{1,253}$/.test(q.get("controller") ?? "") ? q.get("controller")! : "localhost",
		controllerport: clamp(int(q.get("controllerport"), 9000), 1, 65535),
		svcidle: debug ? clamp(int(q.get("svcidle"), 120), 1, 3600) * 1000 : 120_000,
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

/** Doors to keep open: starts at `parallel`, +1 every `step` points, capped by `maxparallel` and by playable-1 (one box always stays closed). */
export function doorsFor(score: number, p: Pick<Params, "parallel" | "maxparallel" | "step">, playable: number): number {
	return Math.max(1, Math.min(p.parallel + Math.floor(score / p.step), p.maxparallel, playable - 1));
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

/** Service-code lockout: 5 wrong codes lock the code screen for 60 s. */
export interface Lock {fails: number; until: number}
export const MAX_FAILS = 5;
export const LOCK_MS = 60_000;
export const NO_LOCK: Lock = {fails: 0, until: 0};

/** State after a code attempt (`ok` = the controller answered "wrong"/"right"; network errors must not call this). */
export function nextLock(s: Lock, now: number, ok: boolean): Lock {
	if (ok) return NO_LOCK;
	const fails = s.fails + 1;
	return fails >= MAX_FAILS ? {fails: 0, until: now + LOCK_MS} : {fails, until: s.until};
}

/** Seconds of lockout left (0 = unlocked). */
export const lockLeft = (s: Lock, now: number) => Math.max(0, Math.ceil((s.until - now) / 1000));

export function parseLock(raw: string | null): Lock {
	try {
		const o = JSON.parse(raw ?? "null");
		return Number.isFinite(o?.fails) && Number.isFinite(o?.until) ? {fails: o.fails, until: o.until} : NO_LOCK;
	} catch {
		return NO_LOCK;
	}
}
