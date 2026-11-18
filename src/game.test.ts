import assert from "node:assert/strict";
import {insertScore, parseBoxes, parseParams, parseScores, pickNext, eligibleBoxes, rankOf, type Score} from "./game.ts";

// boxes
assert.deepEqual(parseBoxes("2-4,7"), ["2", "3", "4", "7"]);
assert.deepEqual(parseBoxes("5-3"), ["3", "4", "5"]);
assert.deepEqual(parseBoxes("1,1, 2"), ["1", "2"]);
assert.equal(parseBoxes("ALL"), "all");
assert.equal(parseBoxes(""), null);
assert.equal(parseBoxes(null), null);
assert.equal(parseBoxes(",,"), null);
assert.equal(parseBoxes("1-99999"), null);

// params
assert.deepEqual(parseParams(""), {time: 60, parallel: 2, boxes: null, minopen: 400, stuck: 4000, lang: "de", canSwitch: true, debug: false});
const p = parseParams("?time=1&parallel=9&boxes=1-3&minopen=-5&stuck=x&lang=fr&debug=1");
assert.deepEqual(p, {time: 10, parallel: 3, boxes: ["1", "2", "3"], minopen: 0, stuck: 4000, lang: "de", canSwitch: true, debug: true});
assert.equal(parseParams("?time=9999").time, 600);
assert.equal(parseParams("?minopen=99999").minopen, 5000);
assert.equal(parseParams("?locale=en-GB").lang, "en");
assert.equal(parseParams("?locale=de-AT&lang=en").lang, "en");
assert.equal(parseParams("?languages=de").canSwitch, false);

// eligible = enabled, non-Master, optionally restricted by boxes
const comps = [
	{number: "1", enabled: true, types: ["S"]}, {number: "2", enabled: false, types: ["S"]},
	{number: "9", enabled: true, types: ["M"]}, {number: "31", enabled: true, types: ["Master"]},
	{number: "32", enabled: true, types: ["master", "L"]}, {number: "5", enabled: true},
];
assert.deepEqual(eligibleBoxes(null, comps), ["1", "9", "5"]);
assert.deepEqual(eligibleBoxes("all", comps), ["1", "9", "5"]);
assert.deepEqual(eligibleBoxes(["1", "2", "31", "7"], comps), ["1"]);
assert.deepEqual(eligibleBoxes(null, []), []);

// pickNext
const all = ["1", "2", "3", "4"];
assert.equal(pickNext(all, new Set(["1", "2"]), "3", () => 0), "4"); // avoids last
assert.equal(pickNext(all, new Set(["1", "2", "4"]), "3", () => 0), "3"); // last only if unavoidable
assert.equal(pickNext(all, new Set(all), null), null);
for (let i = 0; i < 200; i++) {
	const b = pickNext(all, new Set(["2"]), "1")!;
	assert.ok(b === "3" || b === "4");
}
assert.equal(pickNext(all, new Set(), null, () => 0.999), "4");

// highscores
const mk = (n: number): Score => ({name: "AAA", score: n, date: "d"});
let l: Score[] = [];
for (const s of [5, 9, 7]) l = insertScore(l, mk(s));
assert.deepEqual(l.map(e => e.score), [9, 7, 5]);
assert.equal(rankOf(l, 8), 2);
assert.equal(rankOf(l, 7), 3); // ties go behind
assert.equal(rankOf(l, 0), 0);
for (let i = 1; i <= 12; i++) l = insertScore(l, mk(i * 10));
assert.equal(l.length, 10);
assert.equal(l[9].score, 30);
assert.equal(rankOf(l, 30), 0); // full list, tie with last does not qualify
assert.equal(rankOf(l, 31), 10);
assert.equal(insertScore(l, mk(1)), l);
assert.deepEqual(parseScores("garbage"), []);
assert.deepEqual(parseScores(null), []);
assert.deepEqual(parseScores('[{"name":"A","score":1,"date":"x"},{"x":1}]').length, 1);

console.log("game.test.ts: ok");
