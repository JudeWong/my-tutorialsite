import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
const context = vm.createContext({
  MAIN_CATEGORY_EN: {}, SUBJECT_EN: {}, AbortController, DOMException,
  setTimeout, clearTimeout, location: { hostname: "school.test" },
  getGeminiApiKey: () => "", setGenerationProgress: () => {},
  localized: (en) => en, showToast: () => {},
});
vm.runInContext([
  "hasPositionDependentChoices", "diversifyGeneratedQuestions",
  "getQuestionGenerationLimits", "getQuestionGenerationTarget",
  "buildQuestionGenerationPrompt", "buildQuestionSupplementPrompt", "requestAIQuestions",
].map(extract).join("\n"), context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const fixture = (length, count = 4) => Array.from({ length }, (_, index) => ({
  id: `q${index}`, type: "mcq", title: `题目${index}`, level: "中等", correct: index % count,
  options: Array.from({ length: count }, (_, i) => `内容${index}-${i}`),
  optionsEn: Array.from({ length: count }, (_, i) => `Translated content ${index}-${i}`),
  explanation: "根据题目条件和原理判断。", mistake: "常见错误是忽略条件。",
}));
function rng(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const distribute = (items, options, seed = 18) => plain(context.diversifyGeneratedQuestions(items, options, rng(seed)));
const teaching = { materialType: "teaching-material" };

const past = fixture(48);
past.forEach((q) => { q.correct = 0; });
assert.deepEqual(distribute(past, { materialType: "past-paper" }), past);
assert.deepEqual(distribute(past, {}), past, "default must preserve source order");
console.log("PASS past papers preserve choices, answers and metadata, including biased source keys");

for (const count of [4, 5, 6]) {
  for (const size of [1, 3, 10, 11, 39, 40, 41, 50, 100]) {
    for (let seed = 1; seed <= 100; seed += 1) {
      const input = fixture(size, count);
      const before = structuredClone(input);
      const output = distribute(input, teaching, seed);
      const totals = Array(count).fill(0);
      output.forEach((q, i) => {
        totals[q.correct] += 1;
        assert.equal(q.options[q.correct], before[i].options[before[i].correct]);
        assert.equal(q.optionsEn[q.correct], before[i].optionsEn[before[i].correct]);
        assert.deepEqual([...q.options].sort(), [...before[i].options].sort());
        assert.equal(q.explanation, before[i].explanation);
      });
      assert.ok(Math.max(...totals) - Math.min(...totals) <= 1);
      assert.deepEqual(input, before, "must not mutate source question objects or arrays");
    }
  }
}
const keys = Array.from({ length: 20 }, (_, seed) => distribute(fixture(40), teaching, seed).map((q) => q.correct).join(""));
assert.ok(new Set(keys).size > 15, "distribution must vary across generations");
assert.ok(keys.every((key) => key !== "0123".repeat(10)), "not the old ABCD loop");
assert.ok(keys.some((key) => Array.from({ length: 10 }, (_, i) => new Set(key.slice(i * 4, i * 4 + 4)).size).some((size) => size < 4)), "not predictable four-choice blocks");
console.log("PASS 2,700 generated sets: balanced quotas, randomized order, correct bilingual answer mapping, no mutation");

const sensitive = fixture(5);
sensitive[0].options[3] = "以上皆是";
sensitive[1].explanation = "选项 B 正确，因为……";
sensitive[2].title = "A 与 C 哪个正确？";
sensitive[3].options[1] = "A、C 都正确";
sensitive[4].mistakeEn = "Option D is incorrect.";
const mixed = [...sensitive, ...fixture(25), { type: "fill", title: "填充", correctAnswer: "计算机" }];
const result = distribute(mixed, teaching);
sensitive.forEach((q, i) => {
  assert.deepEqual(result[i].options, q.options);
  assert.equal(result[i].correct, q.correct);
});
assert.deepEqual(result.at(-1), mixed.at(-1));
assert.equal(context.hasPositionDependentChoices({ title: "I、II、III 和 IV", options: ["CPU", "SQL", "16", "I 和 II"] }), false);
console.log("PASS letter/positional dependencies preserved, Roman statements and technical terms supported, fill questions untouched");

const pastPrompt = context.buildQuestionGenerationPrompt("资料", "paper.pdf", "初中", { materialType: "past-paper" });
assert.match(pastPrompt, /Never balance, shuffle, or cycle/);
const teachingPrompt = context.buildQuestionGenerationPrompt("资料", "notes.pdf", "初中", teaching);
assert.match(teachingPrompt, /Never use a repeating A\/B\/C\/D cycle/);
const supplement = context.buildQuestionSupplementPrompt("资料", "paper.pdf", "初中", { materialType: "past-paper" }, past.slice(0, 39), 1);
assert.match(supplement, /Preserve the source A\/B\/C\/D option order/);
assert.match(supplement, /Do not invent additional questions/);

// Exercise actual generation orchestration: preserve past-paper initial + supplemental
// keys, and balance only AFTER truncation of a proxy response to the final count.
let calls = 0;
context.requestQuestionsFromProxy = async () => {
  calls += 1;
  return calls === 1 ? past.slice(0, 39) : past.slice(39);
};
assert.deepEqual(plain(await context.requestAIQuestions("资料", "paper.pdf", "paper", "初中", { materialType: "past-paper" })), past);
assert.equal(calls, 2);
context.requestQuestionsFromProxy = async () => fixture(57);
const generated = plain(await context.requestAIQuestions("资料", "notes.pdf", "paper", "初中", { ...teaching, questionCount: 10 }));
assert.equal(generated.length, 10);
const totals = [0, 0, 0, 0];
generated.forEach((q) => totals[q.correct]++);
assert.ok(Math.max(...totals) - Math.min(...totals) <= 1);
console.log("PASS prompts, source-only supplement, actual generation pipeline, balance after truncation");
