import {useCompartments, useConnected, useCube, useLockEvent} from "@variocube/cube-app-react-sdk";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {doorsFor, insertScore, parseParams, parseScores, pickNext, eligibleBoxes, rankOf, type Score} from "./game.ts";

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
	},
};

type Phase = "start" | "countdown" | "play" | "name" | "result" | "error";
const KEY = "tuersprint.scores";
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

	// staff reset: hold the title for 5 s
	const holdTimer = useRef(0);
	const titleDown = () => { holdTimer.current = window.setTimeout(() => phase === "start" && setConfirm(true), 5000); };
	const titleUp = () => clearTimeout(holdTimer.current);
	const wipe = () => { save([]); setScores([]); setConfirm(false); };

	const quitTimer = useRef(0);
	const quitDown = () => { setHold(true); quitTimer.current = window.setTimeout(() => { setHold(false); quit(); }, 1000); };
	const quitUp = () => { setHold(false); clearTimeout(quitTimer.current); };

	const secs = Math.ceil(leftMs / 1000);
	const tone = secs <= 5 ? "red" : secs <= 10 ? "warn" : "";
	const W = window.innerWidth, H = window.innerHeight;
	const gridArea = W > H * 1.1 ? {w: W * 0.94, h: H * 0.6} : {w: W * 0.94, h: H * 0.62};
	const {cols, size} = gridCols(Math.max(playable.length, 1), gridArea.w, gridArea.h);
	const openList = stillOpen.join(", ");

	const langBox = P.canSwitch && phase === "start" && (
		<div className="lang">
			{(["de", "en"] as const).map(l => <button key={l} className={l === lang ? "on" : ""} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
		</div>
	);

	return (
		<main>
			<h1 onPointerDown={titleDown} onPointerUp={titleUp} onPointerLeave={titleUp} onPointerCancel={titleUp}>
				<span className="dial" />{T.title}
			</h1>
			{langBox}

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
