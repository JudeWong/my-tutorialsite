import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createTournament, buildTournamentView, advanceTournament, MAX_BATTLE_PLAYERS } from "../battle-engine.js";

// Exercise the actual UI functions without a CDN, browser, Supabase or WebGL.
// JSX-free React elements are expanded to an inspectable tree; effects do not run.
const source = await readFile(new URL("../arena.js", import.meta.url), "utf8");
let selectedRound = "live";
const element = (tag, props, ...children) => {
  const flat = children.flat(Infinity).filter((child) => child !== null && child !== false && child !== undefined);
  if (typeof tag === "function") return tag({ ...props, children: flat });
  return { tag, props: props || {}, children: flat };
};
const sandbox = {
  React: { Component: class {}, createElement: element, Fragment: "fragment" },
  useState: (initial) => [initial === "live" ? selectedRound : typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: () => {}, useRef: (current) => ({ current }), useMemo: (fn) => fn(),
  createRoot: () => { throw new Error("Teacher component must not mount a 3D canvas"); },
  createPortal: (node) => node, readTournament: () => null, buildTournamentView, MAX_BATTLE_PLAYERS,
  MutationObserver: class { disconnect() {} observe() {} },
  document: { querySelector: () => null }, Date, console
};
vm.runInNewContext(source.replace(/^import .*;\r?$/gm, "").replace(/export function /g, "function ")
  + "\nglobalThis.testUI = { projectTeacherStandings, TeacherTournamentDashboard, TeacherPlayerMetric };", sandbox);
const { projectTeacherStandings, TeacherTournamentDashboard, TeacherPlayerMetric } = sandbox.testUI;
const BASE = Date.parse("2026-10-19T08:00:00Z");
const make = (count) => createTournament(Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `学生${index + 1}`, className: "高一甲" })),
  { id: `class-${count}`, startedAt: BASE, durationSeconds: 180, random: () => 0.9999 });
const at = (state, delta) => Date.parse(state.startedAt) + delta;
const wins = (state) => state.matches.filter((match) => match.playerIds.length === 2).map((match) => ({
  id: `answer-${match.id}`, matchId: match.id, playerId: match.playerIds[0], targetPlayerId: match.playerIds[1],
  type: "answer", round: 0, correct: true, damage: 100, effect: "", createdAt: new Date(at(state, 1000)).toISOString()
}));
const nodes = (node, predicate) => !node || typeof node !== "object" ? []
  : [...(predicate(node) ? [node] : []), ...node.children.flatMap((child) => nodes(child, predicate))];
const text = (node) => !node || typeof node !== "object" ? String(node ?? "") : node.children.map(text).join(" ");
const render = (state, view, extra = {}) => TeacherTournamentDashboard({ state, view, lastSynced: Date.now(), syncing: false, syncError: "", onRetry: () => {}, ...extra });
let checks = 0;
function test(name, fn) { fn(); checks += 1; console.log(`PASS ${name}`); }

test("34/40-player first rounds render all 17/20 matches and every roster row without WebGL", () => {
  for (const count of [34, 40]) {
    const state = make(count);
    const view = buildTournamentView(state, [], BASE + 100);
    const tree = render(state, view);
    assert.equal(nodes(tree, (node) => node.props.className?.split(" ").includes("arena-monitor-card")).length, count / 2);
    assert.equal(nodes(tree, (node) => node.tag === "tbody")[0].children.length, count);
    assert.equal(nodes(tree, (node) => node.props.role === "meter").length, count * 2);
    assert.equal(nodes(tree, (node) => node.tag === "canvas").length, 0);
    assert.match(text(tree), /累计得分/);
  }
});

test("live correct answers show each student's actual score and damaged HP", () => {
  const state = make(40);
  const events = wins(state).map((event) => ({ ...event, damage: 20 }));
  const view = buildTournamentView(state, events, at(state, 1500));
  const projection = projectTeacherStandings(state, view);
  assert.equal(projection.rows.filter((row) => row.score === 100 && row.hp === 100).length, 20);
  assert.equal(projection.rows.filter((row) => row.score === 0 && row.hp === 80).length, 20);
  const tree = render(state, view);
  assert.equal(nodes(tree, (node) => node.props.role === "meter" && node.props["aria-valuenow"] === 80).length, 40);
});

test("round changes reset only active-round metrics; eliminated players and byes are not fake zero HP", () => {
  const initial = make(34);
  const events = wins(initial);
  const state = advanceTournament(initial, events, at(initial, 3000));
  const view = buildTournamentView(state, events, at(state, 0));
  const projection = projectTeacherStandings(state, view);
  const bye = view.matches.find((match) => match.players.length === 1);
  assert.ok(bye);
  const byeRow = projection.rows.find((row) => row.player.id === bye.players[0].id);
  assert.equal(byeRow.score, null);
  assert.equal(byeRow.hp, null);
  assert.equal(byeRow.total, 100);
  assert.equal(byeRow.last.score, 100);
  const eliminated = projection.rows.filter((row) => row.status.includes("已淘汰"));
  assert.equal(eliminated.length, 17);
  assert.ok(eliminated.every((row) => row.score === null && row.hp === null && row.last.hp === 0));
  const active = projection.rows.filter((row) => row.score !== null);
  assert.equal(active.length, 16);
  assert.ok(active.every((row) => row.score === 0 && row.hp === 100 && row.total === 100));
});

test("history selector renders saved score/HP while keeping whole-tournament totals", () => {
  const initial = make(8);
  const events = wins(initial);
  const state = advanceTournament(initial, events, at(initial, 3000));
  events.push(...wins(state));
  const view = buildTournamentView(state, events, at(state, 1500));
  const projection = projectTeacherStandings(state, view, "0");
  assert.equal(projection.historical, true);
  assert.equal(projection.round, 1);
  assert.equal(projection.rows.filter((row) => row.score === 100).length, 4);
  assert.equal(projection.rows.filter((row) => row.total === 200).length, 2);
  selectedRound = "0";
  const tree = render(state, view);
  assert.match(text(tree), /SAVED ROUND/);
  assert.match(text(tree), /第 1 轮得分/);
  const select = nodes(tree, (node) => node.tag === "select")[0];
  assert.equal(select.props.value, "0");
  assert.equal(select.children.length, 2);
  selectedRound = "live";
});

test("final table retains all entrants including automatic three-player bronze", () => {
  let state = make(6);
  const events = [];
  while (state.status !== "finished") {
    events.push(...wins(state));
    state = advanceTournament(state, events, at(state, 3000));
  }
  const view = buildTournamentView(state, [], at(state, 6000));
  const projection = projectTeacherStandings(state, view);
  assert.equal(projection.rows.length, 6);
  assert.equal(projection.rows.filter((row) => row.status === "季军").length, 1);
  assert.equal(projection.rows.find((row) => row.status === "季军").score, null);
  assert.equal(projection.rows.find((row) => row.status === "季军").total, 100);
  assert.equal(nodes(render(state, view), (node) => node.tag === "tbody")[0].children.length, 6);
});

test("missing stats render a placeholder and no invented health bar", () => {
  const tree = TeacherPlayerMetric({ player: { id: "p", name: "未同步学生" }, stat: undefined, side: "left" });
  assert.match(text(tree), /等待完整比分同步/);
  assert.match(text(tree), /—/);
  assert.equal(nodes(tree, (node) => node.props.role === "meter").length, 0);
});

test("sync errors and stale snapshots are explicitly labelled without wiping scores", () => {
  const state = make(4);
  const view = buildTournamentView(state, wins(state), at(state, 1500));
  const failed = render(state, view, { syncError: "network error" });
  assert.match(text(failed), /同步失败.*不代表实时比分/);
  assert.match(text(failed), /100/);
  const stale = render(state, view, { lastSynced: Date.now() - 20000 });
  assert.match(text(stale), /数据更新延迟/);
  const pending = render(state, view, { syncing: true });
  assert.equal(nodes(pending, (node) => node.tag === "button")[0].props.disabled, true);
  const uncalibrated = render(state, view, { clockSynchronized: false });
  assert.match(text(uncalibrated), /云端时间尚未校准/);
  assert.doesNotMatch(text(uncalibrated), /比分同步正常/);
});

test("capacity guard, calibrated clock and pending-bracket gate are wired in the actual app", () => {
  assert.match(source, /players\.length <= MAX_BATTLE_PLAYERS/);
  assert.match(source, /players\.length > MAX_BATTLE_PLAYERS/);
  assert.match(source, /const timer = setInterval\(\(\) => setNow\(battleNow\(\)\)/);
  assert.match(source, /const createdAt = Math\.floor\(battleNow\(\)\)/);
  assert.match(source, /const pair = awaitingBracket \? \[\]/);
  assert.match(source, /onClick: startRoom, disabled: busy[\s\S]*?重试生成赛程/);
});

test("history labels derive from actual round entrants, not stale saved labels", () => {
  let state=make(32);
  let events=[];
  for (let stage=0;stage<3;stage++) {
    events.push(...wins(state));
    state=advanceTournament(state,events,at(state,3000));
  }
  state.history.forEach((stage)=>stage.label="32 强赛");
  const view=buildTournamentView(state,events,at(state,1000));
  assert.equal(projectTeacherStandings(state,view,"1").title,"16 强赛");
  assert.equal(projectTeacherStandings(state,view,"2").title,"8 强赛");
  assert.equal(projectTeacherStandings(state,view).title,"半决赛");
});
test("countdown is not counted as an active match; odd roster shows one bye", () => {
  selectedRound="live";
  const state=make(5);
  const view=buildTournamentView(state,[],BASE-1000);
  const tree=render(state,view);
  const ongoing=nodes(tree,(node)=>node.tag==="article" && text(node).includes("正在进行"))[0];
  assert.match(text(ongoing),/正在进行 0/);
  assert.match(text(tree),/4 人参战 · 1 人轮空/);
});
console.log(`${checks} teacher scoreboard regressions passed.`);
