/// <reference types="vite/client" />
import {useCompartments, useConnected, useCube, useLockEvent} from "@variocube/cube-app-react-sdk";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import logo from "./variocube-logo.svg"; // official VC_LOGO_RGB_White_On_Alpha
import {doorsFor, insertScore, lockLeft, nextLock, parseLock, parseParams, parseScores, pickNext, eligibleBoxes, rankOf, type Lock, type Score} from "./game.ts";

const P = parseParams(window.location.search);

const TEXT = {
	de: {
		title: "Türsprint", howto: "So geht's",
		steps: ["Türen springen auf", "So schnell wie möglich zuklappen", `${P.time} Sekunden – wie viele schaffst du?`],
		start: "Spiel starten", soon: "Gleich geht's los …", offline: "Nicht verbunden",
		setup: "Einrichtung nötig", setupHow: "Zu wenige spielbare Fächer", setupMore: (n: number) => `Mindestens ${n} Fächer nötig (Fächer per boxes=… einschränken oder freigeben).`,
		top: "Bestenliste", none: "Noch kein Eintrag – sei der Erste!",
		go: "Los!", time: "Zeit", points: "Punkte", close: "ZU!", quit: "Abbrechen", hold: "gedrückt halten",
		name: "Neuer Rekord!", nameHint: "Tippe deine 3 Initialen", done: "Fertig", skip: "Überspringen", del: "Löschen",
		result: "Geschafft!", doors: (n: number): string => (n === 1 ? "Tür" : "Türen"),
		rank: (r: number) => `Platz ${r} in der Bestenliste`, norank: "Diesmal nicht in den Top 10",
		pleaseClose: (b: string) => `Bitte noch Fach ${b} schließen`, allClosed: "Alle Fächer sind wieder zu. Danke!",
		again: "Nochmal", reset: "Bestenliste löschen?", yes: "Ja, löschen", no: "Abbrechen",
		err: "Bitte wende dich an das Standpersonal",
		svc: "Service", svcCode: "Service – Code eingeben", bad: "Code ungültig", unavail: "Prüfung nicht möglich", checking: "Prüfe …",
		locked: (s: number) => `Gesperrt – noch ${s} s`, cancel: "Abbrechen", ok: "OK", wipe: "Bestenliste löschen", finish: "Fertig",
		opening: "öffnet …", opened: "offen", closed: "zu", failed: "Fehler", disabled: "deaktiviert", master: "Master", gear: "Service",
	},
	en: {
		title: "Door Sprint", howto: "How to play",
		steps: ["Doors pop open", "Slam them shut as fast as you can", `${P.time} seconds – how many can you do?`],
		start: "Start game", soon: "Starting soon …", offline: "Not connected",
		setup: "Setup required", setupHow: "Too few playable compartments", setupMore: (n: number) => `At least ${n} compartments needed (check boxes=…).`,
		top: "High scores", none: "No entry yet – be the first!",
		go: "Go!", time: "Time", points: "Score", close: "CLOSE!", quit: "Cancel", hold: "hold to cancel",
		name: "New record!", nameHint: "Tap your 3 initials", done: "Done", skip: "Skip", del: "Delete",
		result: "Well done!", doors: (n: number): string => (n === 1 ? "door" : "doors"),
		rank: (r: number) => `Rank ${r} on the high score list`, norank: "Not in the top 10 this time",
		pleaseClose: (b: string) => `Please close compartment ${b}`, allClosed: "All compartments are closed again. Thanks!",
		again: "Play again", reset: "Delete high scores?", yes: "Yes, delete", no: "Cancel",
		err: "Please contact the staff",
		svc: "Service", svcCode: "Service – enter code", bad: "Invalid code", unavail: "Check not possible", checking: "Checking …",
		locked: (s: number) => `Locked – ${s} s left`, cancel: "Cancel", ok: "OK", wipe: "Delete high scores", finish: "Done",
		opening: "opening …", opened: "open", closed: "closed", failed: "error", disabled: "disabled", master: "Master", gear: "Service",
	},
};

type Phase = "start" | "countdown" | "play" | "name" | "result" | "error" | "code" | "service";
type Tile = "opening" | "open" | "closed" | "error";
const KEY = "tuersprint.scores";
const LOCK_KEY = "tuersprint.svclock";
const CODE_MAX = 12;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];
const loadLock = (): Lock => { try { return parseLock(localStorage.getItem(LOCK_KEY)); } catch { return parseLock(null); } };
const saveLock = (l: Lock) => { try { localStorage.setItem(LOCK_KEY, JSON.stringify(l)); } catch { /* storage unavailable: lockout is session-only */ } };

/** Ask the controller whether the code is a FullAccess code. Never logs or returns the code. */
async function checkCode(code: string): Promise<"granted" | "denied" | "failed"> {
	const ctl = new AbortController();
	const t = setTimeout(() => ctl.abort(), 5000);
	try {
		const r = await fetch(`http://${P.controller}:${P.controllerport}/permissions/${encodeURIComponent(code)}`, {cache: "no-store", signal: ctl.signal});
		if (r.status === 404) return "denied";
		if (r.status !== 200) return "failed";
		return (await r.json())?.accessLevel === "FullAccess" ? "granted" : "denied";
	} catch {
		return "failed";
	} finally {
		clearTimeout(t);
	}
}

const Gear = () => (
	<svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="3.2" />
		<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
	</svg>
);
const RESULT_IDLE_MS = 45_000;
const NAME_IDLE_MS = 60_000;
const OPEN_LIST_MAX_MS = 180_000; // ponytail: fixed 3 min, then we stop nagging about still-open doors
const ERROR_MS = 15_000;
const LETTERS = Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i));

const load = () => { try { return parseScores(localStorage.getItem(KEY)); } catch { return []; } };
const save = (l: Score[]) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage unavailable: list is session-only */ } };

type Act = {openedAt: number | null; timer: number};

/** Best column count so square-ish cells fill a w x h area. */
function gridCols(n: number, w: number, h: number) {
	let best = 1, size = 0;
	for (let c = 1; c <= n; c++) {
		const s = Math.min(w / c, h / Math.ceil(n / c));
		if (s > size) { size = s; best = c; }
	}
	return {cols: best, size};
}

function Top({list, T, mark}: {list: Score[]; T: typeof TEXT.de; mark?: number}) {
	return (
		<div className="top">
			<h2>{T.top}</h2>
			{list.length === 0 ? <p className="none">{T.none}</p> : (
				<ol>
					{list.map((e, i) => (
						<li key={i} className={i === mark ? "me" : ""}><i>{i + 1}</i><span>{e.name}</span><b>{e.score}</b></li>
					))}
				</ol>
			)}
		</div>
	);
}

export function App() {
	const cube = useCube();
	const online = useConnected();
	const compartments = useCompartments();
	const [phase, setPhase] = useState<Phase>("start");
	const [lang, setLang] = useState(P.lang);
	const [count, setCount] = useState(3);
	const [leftMs, setLeftMs] = useState(P.time * 1000);
	const [score, setScore] = useState(0);
	const [view, setView] = useState<string[]>([]); // currently active (glowing) boxes
	const [stillOpen, setStillOpen] = useState<string[]>([]);
	const [scores, setScores] = useState<Score[]>(load);
	const [rank, setRank] = useState(0);
	const [saved, setSaved] = useState(false);
	const [initials, setInitials] = useState("");
	const [confirm, setConfirm] = useState(false);
	const [hold, setHold] = useState(false);
	const [code, setCode] = useState("");
	const [codeMsg, setCodeMsg] = useState<"" | "bad" | "unavail" | "checking">("");
	const [lock, setLock] = useState<Lock>(loadLock);
	const [now, setNow] = useState(Date.now());
	const [tiles, setTiles] = useState<Record<string, Tile>>({});
	const checkId = useRef(0);
	const T = TEXT[lang];

	const available = useMemo(() => compartments.map(c => c.number), [compartments]);
	const playable = useMemo(() => eligibleBoxes(P.boxes, compartments), [compartments]);
	const needed = P.parallel + 1;
	const setupOk = playable.length >= needed;
	const ready = online && available.length > 0;

	// engine state lives in refs: lock events and timers must see the latest values
	const R = useRef({
		playable, phase, score: 0, last: null as string | null,
		active: new Map<string, Act>(), open: new Set<string>(), commanded: new Set<string>(), dead: new Set<string>(),
		openedByGame: new Set<string>(), endedAt: 0, scores,
	});
	R.current.playable = playable; R.current.phase = phase; R.current.scores = scores;

	const syncOpen = useCallback(() => {
		const r = R.current;
		setStillOpen([...r.openedByGame].filter(b => r.open.has(b)).sort((a, b) => a.localeCompare(b, undefined, {numeric: true})));
	}, []);
	const syncView = () => setView([...R.current.active.keys()]);
	const clearActive = () => {
		R.current.active.forEach(a => clearTimeout(a.timer));
		R.current.active.clear();
		setView([]);
	};
	const fail = useCallback(() => {
		clearActive();
		setPhase("error");
	}, []);

	const activate = (box: string) => {
		const r = R.current;
		const a: Act = {openedAt: null, timer: 0};
		a.timer = window.setTimeout(() => { // no OPEN event: door blocked or command lost, give up on it
			if (r.active.get(box) === a) {
				r.active.delete(box);
				r.last = box;
				syncView();
				fill();
			}
		}, P.stuck);
		r.active.set(box, a);
		r.commanded.add(box);
		(async () => {
			try {
				await cube.openCompartment(box);
			} catch {
				console.error("tuersprint: openCompartment failed, box", box); // number only
				clearTimeout(a.timer);
				r.dead.add(box);
				if (r.active.get(box) === a) r.active.delete(box);
				syncView();
				fill();
			}
		})();
	};

	// keep exactly P.parallel doors active; ends the game if too few boxes remain usable
	const fill = () => {
		const r = R.current;
		if (r.phase !== "play") return;
		const usable = r.playable.filter(b => !r.dead.has(b));
		if (usable.length < P.parallel) return fail();
		const want = doorsFor(r.score, P, usable.length);
		while (r.active.size < want) {
			const busy = new Set([...r.active.keys(), ...r.open, ...r.dead]);
			const box = pickNext(usable, busy, r.last);
			if (!box) break; // all remaining boxes are open right now; the tick retries
			activate(box);
		}
		syncView();
	};

	const begin = () => {
		if (!ready || !setupOk) return;
		const r = R.current;
		r.score = 0; r.last = null; r.dead.clear(); r.commanded.clear(); r.openedByGame.clear();
		clearActive();
		setScore(0); setLeftMs(P.time * 1000); setStillOpen([]); setSaved(false); setRank(0); setInitials(""); setCount(3);
		setPhase("countdown");
	};

	const quit = () => {
		clearActive();
		R.current.endedAt = Date.now();
		syncOpen();
		setPhase("start");
	};

	const finish = () => {
		clearActive();
		const r = R.current;
		r.endedAt = Date.now();
		syncOpen();
		const rk = rankOf(r.scores, r.score);
		setRank(rk);
		setPhase(rk ? "name" : "result");
	};

	const commit = (name: string) => {
		const r = R.current;
		const list = insertScore(r.scores, {name, score: r.score, date: new Date().toISOString().slice(0, 10)});
		save(list); setScores(list); setSaved(true); setPhase("result");
	};

	// countdown 3-2-1-Los
	useEffect(() => {
		if (phase !== "countdown") return;
		if (count < 0) { R.current.phase = "play"; setPhase("play"); return; }
		const t = window.setTimeout(() => setCount(count - 1), count === 0 ? 700 : 1000);
		return () => clearTimeout(t);
	}, [phase, count]);

	// game clock
	useEffect(() => {
		if (phase !== "play") return;
		const end = Date.now() + P.time * 1000;
		fill();
		const i = window.setInterval(() => {
			const l = end - Date.now();
			if (l <= 0) { clearInterval(i); setLeftMs(0); finish(); } else { setLeftMs(l); fill(); }
		}, 100);
		return () => clearInterval(i);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [phase]);

	// disconnect mid-game
	useEffect(() => {
		if (!online && (phase === "countdown" || phase === "play")) fail();
	}, [online, phase, fail]);

	useEffect(() => {
		if (phase !== "error") return;
		const t = window.setTimeout(() => setPhase("start"), ERROR_MS);
		return () => clearTimeout(t);
	}, [phase]);

	// idle: result -> start, initials -> "???"; any touch re-arms
	useEffect(() => {
		if (phase !== "result" && phase !== "name") return;
		let t = 0;
		const arm = () => {
			clearTimeout(t);
			t = window.setTimeout(() => (phase === "result" ? setPhase("start") : commit("???")), phase === "result" ? RESULT_IDLE_MS : NAME_IDLE_MS);
		};
		arm();
		document.addEventListener("pointerdown", arm);
		return () => { clearTimeout(t); document.removeEventListener("pointerdown", arm); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [phase]);

	// stop listing still-open doors after 3 min
	useEffect(() => {
		if (!stillOpen.length || phase === "play" || phase === "countdown") return;
		const t = window.setTimeout(() => { R.current.openedByGame.clear(); syncOpen(); },
			Math.max(0, R.current.endedAt + OPEN_LIST_MAX_MS - Date.now()));
		return () => clearTimeout(t);
	}, [stillOpen.length, phase, syncOpen]);

	useLockEvent(({compartmentNumber: box, status}) => {
		if (!box) return;
		if (status === "OPEN" || status === "CLOSED") setTiles(t => (box in t ? {...t, [box]: status === "OPEN" ? "open" : "closed"} : t));
		const r = R.current;
		const now = Date.now();
		if (P.debug) console.log("lock", box, status);
		if (status === "OPEN") {
			r.open.add(box);
			if (r.commanded.has(box)) r.openedByGame.add(box);
			const a = r.active.get(box);
			if (a && a.openedAt === null) { a.openedAt = now; clearTimeout(a.timer); }
		} else if (status === "CLOSED") {
			r.open.delete(box);
			const a = r.active.get(box);
			if (a && a.openedAt !== null && r.phase === "play") {
				clearTimeout(a.timer);
				r.active.delete(box);
				r.last = box;
				if (now - a.openedAt >= P.minopen) { r.score++; setScore(r.score); }
				fill();
			}
		}
		syncOpen();
	});

	// Service mode: gear -> code (checked by the controller) -> compartment tiles
	const wipe = () => { save([]); setScores([]); setConfirm(false); };
	const openCode = () => { checkId.current++; setCode(""); setCodeMsg(""); setNow(Date.now()); setPhase("code"); };
	const leaveService = () => { checkId.current++; setConfirm(false); setTiles({}); setPhase("start"); };
	const locked = lockLeft(lock, now);
	const press = (k: string) => {
		if (locked || codeMsg === "checking") return;
		if (k === "del") { setCode(code.slice(0, -1)); setCodeMsg(""); }
		else if (k === "ok") void submit();
		else if (code.length < CODE_MAX) { setCode(code + k); setCodeMsg(""); }
	};
	const submit = async () => {
		if (!code || lockLeft(lock, Date.now())) return;
		const id = ++checkId.current;
		setCodeMsg("checking");
		const res = await checkCode(code);
		if (id !== checkId.current) return; // cancelled meanwhile
		console.log(`service: ${res === "granted" ? "granted" : res === "denied" ? "denied" : "check failed"}`);
		setCode("");
		if (res === "failed") return setCodeMsg("unavail"); // not a wrong attempt
		const l = nextLock(lock, Date.now(), res === "granted");
		setLock(l); saveLock(l); setNow(Date.now());
		if (res === "granted") { setTiles({}); setPhase("service"); setCodeMsg(""); } else setCodeMsg("bad");
	};
	const openTile = async (box: string) => {
		setTiles(t => ({...t, [box]: "opening"}));
		try { await cube.openCompartment(box); } catch { setTiles(t => ({...t, [box]: "error"})); }
	};

	// lockout countdown
	useEffect(() => {
		if (phase !== "code" || lockLeft(lock, Date.now()) === 0) return;
		const i = window.setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(i);
	}, [phase, lock]);

	// idle: code screen and Service mode return to start; any touch re-arms
	useEffect(() => {
		if (phase !== "code" && phase !== "service") return;
		let t = 0;
		const arm = () => { clearTimeout(t); t = window.setTimeout(leaveService, phase === "code" ? 60_000 : P.svcidle); };
		arm();
		document.addEventListener("pointerdown", arm);
		return () => { clearTimeout(t); document.removeEventListener("pointerdown", arm); };
	}, [phase]);

	const quitTimer = useRef(0);
	const quitDown = () => { setHold(true); quitTimer.current = window.setTimeout(() => { setHold(false); quit(); }, 1000); };
	const quitUp = () => { setHold(false); clearTimeout(quitTimer.current); };

	const secs = Math.ceil(leftMs / 1000);
	const tone = secs <= 5 ? "red" : secs <= 10 ? "warn" : "";
	const W = window.innerWidth, H = window.innerHeight;
	const gridArea = W > H * 1.1 ? {w: W * 0.94, h: H * 0.6} : {w: W * 0.94, h: H * 0.62};
	const {cols, size} = gridCols(Math.max(playable.length, 1), gridArea.w, gridArea.h);
	const openList = stillOpen.join(", ");

	const gearBtn = (phase === "start" || phase === "result") && (
		<button className="gear" onClick={openCode} aria-label={T.gear}><Gear /></button>
	);
	const sGrid = gridCols(Math.max(compartments.length, 1), W * 0.94, H * (W > H * 1.1 ? 0.64 : 0.7));
	const tileLabel = (st?: Tile) => (st ? T[st === "opening" ? "opening" : st === "open" ? "opened" : st === "closed" ? "closed" : "failed"] : "");

	const langBox = P.canSwitch && phase === "start" && (
		<div className="lang">
			{(["de", "en"] as const).map(l => <button key={l} className={l === lang ? "on" : ""} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
		</div>
	);

	return (
		<main>
			<h1>
				<img className="logo" src={logo} alt="VARIOCUBE" draggable={false} />
			</h1>
			{langBox}
			{gearBtn}

			{phase === "start" && (
				<section className="start">
					<div className="howto">
						<h2>{T.howto}</h2>
						<ol className="steps">
							{T.steps.map((s, i) => <li key={i}><b>{i + 1}</b>{s}</li>)}
						</ol>
					</div>
					<Top list={scores} T={T} />
					<div className="go">
						{stillOpen.length > 0 && <p className="notice">{T.pleaseClose(openList)}</p>}
						{ready && !setupOk ? (
							<div className="staff">
								<b>{T.setup}</b>: {T.setupHow}
								<small>{T.setupMore(needed)}{` (${playable.length}/${needed})`}</small>
							</div>
						) : (
							<>
								<button className="big" disabled={!ready} onClick={begin}>{T.start}</button>
								{!ready && <p className="soon">{T.soon}</p>}
								{!online && <p className="tech">{T.offline}</p>}
							</>
						)}
					</div>
				</section>
			)}

			{phase === "countdown" && (
				<section className="msg"><div className="count" key={count}>{count > 0 ? count : T.go}</div></section>
			)}

			{phase === "play" && (
				<section className="play">
					<div className="hud">
						<div className={`time ${tone}`}><small>{T.time}</small><b>{secs}</b></div>
						<div className="bar"><i style={{width: `${(leftMs / (P.time * 1000)) * 100}%`}} className={tone} /></div>
						<div className="score"><small>{T.points}</small><b key={score} className={score ? "bump" : ""}>{score}</b>{score > 0 && <em key={"p" + score}>+1</em>}</div>
					</div>
					<div className="grid" style={{gridTemplateColumns: `repeat(${cols}, ${size - 8}px)`, gridAutoRows: `${size - 8}px`, fontSize: size * 0.36}}>
						{playable.map(b => (
							<div key={b} className={`cell${view.includes(b) ? " act" : ""}${R.current.dead.has(b) ? " dead" : ""}`}>
								<span>{b}</span>{view.includes(b) && <small style={{fontSize: size * 0.17}}>{T.close}</small>}
							</div>
						))}
					</div>
					<button className={`quit${hold ? " holding" : ""}`} onPointerDown={quitDown} onPointerUp={quitUp} onPointerLeave={quitUp} onPointerCancel={quitUp}>
						{T.quit} <small>({T.hold})</small>
					</button>
					{P.debug && <p className="debug">active: {view.join(",")}</p>}
				</section>
			)}

			{phase === "name" && (
				<section className="name">
					<h2>{T.name}</h2>
					<p className="sc">{score} <span>{T.doors(score)}</span></p>
					<p>{T.nameHint}</p>
					<div className="slots">{[0, 1, 2].map(i => <div key={i} className={i === initials.length ? "cur" : ""}>{initials[i] ?? ""}</div>)}</div>
					<div className="letters">
						{LETTERS.map(l => <button key={l} disabled={initials.length >= 3} onClick={() => setInitials(initials + l)}>{l}</button>)}
					</div>
					<div className="row">
						<button className="fn" onClick={() => setInitials(initials.slice(0, -1))}>⌫ {T.del}</button>
						<button className="fn" onClick={() => commit("???")}>{T.skip}</button>
						<button className="fn ok" disabled={initials.length < 3} onClick={() => commit(initials)}>{T.done}</button>
					</div>
				</section>
			)}

			{phase === "result" && (
				<section className="result">
					<div className="res-l">
						<h2>{T.result}</h2>
						<p className="sc">{score} <span>{T.doors(score)}</span></p>
						<p className="rank">{saved && rank ? T.rank(rank) : T.norank}</p>
						{stillOpen.length > 0
							? <p className="notice">{T.pleaseClose(openList)}</p>
							: R.current.openedByGame.size > 0 && <p className="okmsg">{T.allClosed}</p>}
						<button className="big" disabled={!ready || !setupOk} onClick={begin}>{T.again}</button>
					</div>
					<Top list={scores} T={T} mark={saved && rank ? rank - 1 : undefined} />
				</section>
			)}

			{phase === "error" && <section className="msg"><h2 className="bad">{T.err}</h2></section>}

			{phase === "code" && (
				<section className="code">
					<h2>{T.svcCode}</h2>
					<div className="dots">{Array.from({length: CODE_MAX}, (_, i) => <i key={i} className={i < code.length ? "on" : ""} />)}</div>
					<p className={`cmsg${codeMsg && codeMsg !== "checking" || locked ? " bad" : ""}`}>
						{locked ? T.locked(locked) : codeMsg === "bad" ? T.bad : codeMsg === "unavail" ? T.unavail : codeMsg === "checking" ? T.checking : "\u00a0"}
					</p>
					<div className="pad">
						{KEYS.map(k => (
							<button key={k} className={k === "ok" ? "ok" : k === "del" ? "fn" : ""} disabled={!!locked || codeMsg === "checking" || (k === "ok" && !code)} onClick={() => press(k)}>
								{k === "del" ? T.del : k === "ok" ? T.ok : k}
							</button>
						))}
					</div>
					<button className="fn cancel" onClick={leaveService}>{T.cancel}</button>
				</section>
			)}

			{phase === "service" && (
				<section className="svc">
					<div className="svc-h">
						<h2>{T.svc}</h2>
						<button className="fn" onClick={() => setConfirm(true)}>{T.wipe}</button>
						<button className="fn ok" onClick={leaveService}>{T.finish}</button>
					</div>
					<div className="grid" style={{gridTemplateColumns: `repeat(${sGrid.cols}, ${sGrid.size - 8}px)`, gridAutoRows: `${sGrid.size - 8}px`, fontSize: sGrid.size * 0.3}}>
						{compartments.map(c => {
							const st = tiles[c.number];
							const master = (c.types ?? []).some(t => String(t).toLowerCase() === "master");
							return (
								<button key={c.number} className={`tile ${st ?? ""}${c.enabled ? "" : " off"}`} onClick={() => void openTile(c.number)}>
									<span>{c.number}</span>
									<small style={{fontSize: sGrid.size * 0.14}}>{tileLabel(st) || "\u00a0"}</small>
									<em style={{fontSize: sGrid.size * 0.12}}>{[master && T.master, !c.enabled && T.disabled].filter(Boolean).join(" · ") || "\u00a0"}</em>
								</button>
							);
						})}
					</div>
				</section>
			)}

			{confirm && (
				<div className="modal">
					<div>
						<h2>{T.reset}</h2>
						<div className="row">
							<button className="fn" onClick={() => setConfirm(false)}>{T.no}</button>
							<button className="fn ok" onClick={wipe}>{T.yes}</button>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}
