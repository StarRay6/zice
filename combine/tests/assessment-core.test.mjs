import test from "node:test";
import assert from "node:assert/strict";
import core from "../supabase/functions/_shared/assessment-core.js";

const {Q27, Q8} = core;

function todayISO() {
  const d = new Date();
  const z = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
}

function fullAnswers(sex, scale) {
  const answers = {};
  Q27.forEach(q => { if (!q.g || q.g === sex) answers[q.id] = scale; });
  Q8.forEach(q => { if (q.id !== "P35") answers[q.id] = 1; });
  return answers;
}

function payloadOf(sex, answers, extra) {
  return Object.assign({
    questionnaire_version: core.QUESTIONNAIRE_VERSION,
    sex: sex,
    birth_date: "1990-06-15",
    birth_prev_dahan: false,
    assessment_date: todayISO(),
    answers: answers
  }, extra || {});
}

test("judge：全 1 分答卷可完整计算九体且无漏答", () => {
  const R = core.judge(fullAnswers("m", 1), "m");
  assert.equal(R.missing.length, 0);
  Object.keys(R.conv).forEach(k => assert.notEqual(R.conv[k], null, k + " 应有转化分"));
});

test("judge：湿热质只按性别命中一道专属题（n=3）", () => {
  const R = core.judge(fullAnswers("f", 3), "f");
  assert.equal(R.detail.shire.n, 3);
  const Rm = core.judge(fullAnswers("m", 3), "m");
  assert.equal(Rm.detail.shire.n, 3);
});

test("judge：反向计分题（平和质第二项）随答案升高而降低", () => {
  const low = core.judge(fullAnswers("m", 1), "m").conv.pinghe;
  const high = core.judge(fullAnswers("m", 5), "m").conv.pinghe;
  assert.ok(low > high, "S02-S04 反向计分应使平和质随程度升高而下降");
});

test("tebingHit：特禀转化分不足 30 时不要求 P35", () => {
  const answers = fullAnswers("m", 1);
  const v = core.validateSubmission(payloadOf("m", answers));
  assert.equal(v.valid, true, v.errors && v.errors.join(";"));
});

test("校验：特禀转化分 ≥30 时必须作答 P35", () => {
  const answers = fullAnswers("m", 3);
  answers.S24 = 5; answers.S25 = 5; answers.S26 = 5; answers.S27 = 5;
  const v = core.validateSubmission(payloadOf("m", answers));
  assert.equal(v.valid, false);
  assert.ok(v.errors.some(e => e.includes("P35")));
  answers.P35 = 1;
  const v2 = core.validateSubmission(payloadOf("m", answers));
  assert.equal(v2.valid, true, v2.errors && v2.errors.join(";"));
});

test("校验：性别专属题交叉作答被拒绝", () => {
  const answers = fullAnswers("m", 2);
  answers.S17 = 2;
  const v = core.validateSubmission(payloadOf("m", answers));
  assert.equal(v.valid, false);
  assert.ok(v.errors.some(e => e.includes("S17")));
});

test("校验：女性缺少 S17 判为漏答", () => {
  const answers = fullAnswers("f", 2);
  delete answers.S17;
  const v = core.validateSubmission(payloadOf("f", answers));
  assert.equal(v.valid, false);
  assert.ok(v.errors.some(e => e.includes("S17")));
});

test("校验：非法日期、性别、未知题目、越界答案与版本均被拒绝", () => {
  const cases = [
    payloadOf("m", fullAnswers("m", 1), {birth_date: "2020-13-01"}),
    payloadOf("x", fullAnswers("m", 1)),
    payloadOf("m", Object.assign(fullAnswers("m", 1), {S99: 1})),
    payloadOf("m", Object.assign(fullAnswers("m", 1), {S01: 6})),
    payloadOf("m", fullAnswers("m", 1), {questionnaire_version: "q-v0.1"}),
    payloadOf("m", fullAnswers("m", 1), {birth_date: "1800-01-01"})
  ];
  cases.forEach(p => {
    const v = core.validateSubmission(p);
    assert.equal(v.valid, false, JSON.stringify(p).slice(0, 80) + " 应校验失败");
  });
});

test("大寒换年：1 月出生且在大寒前应归上一年运气年", () => {
  const thisYear = new Date().getFullYear();
  const dh = core.YQ_daHan(thisYear);
  const before = core.YQ_birthYear(thisYear, 1, Math.max(1, dh.d - 5), false);
  assert.equal(before, thisYear - 1);
  const withPrev = core.YQ_birthYear(thisYear, dh.m, dh.d, true);
  assert.equal(withPrev, thisYear - 1);
  const after = core.YQ_birthYear(thisYear, dh.m, dh.d, false);
  assert.equal(after, thisYear);
});

test("干支推演：1984 年为甲子", () => {
  assert.equal(core.YQ_ganzhi(1984), "甲子");
  assert.equal(core.YQ_ganzhi(2044), "甲子");
});

test("calculateResult：合判关系取值合法且包含五运六气结果", () => {
  const result = core.calculateResult({
    answers: fullAnswers("m", 4),
    sex: "m",
    birth_date: "1990-06-15",
    birth_prev_dahan: false,
    assessment_date: todayISO()
  });
  assert.ok(["same", "part", "diff", "none", "pinghe"].includes(result.joint_relation));
  assert.ok(result.yunqi && result.yunqi.gz, "应输出干支年");
  assert.ok(Array.isArray(result.yunqi.steps) && result.yunqi.steps.length === 6);
  assert.ok(result.constitution.mixed.length <= 3);
});

test("幂等基础：同一份答案两次计算结果一致", () => {
  const input = {answers: fullAnswers("f", 3), sex: "f", birth_date: "1985-02-03", birth_prev_dahan: true, assessment_date: "2026-01-10"};
  const a = JSON.stringify(core.calculateResult(input));
  const b = JSON.stringify(core.calculateResult(input));
  assert.equal(a, b);
});

test("前端发布副本与服务端判定核心一致", async () => {
  const fs = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const [front, server] = await Promise.all([
    fs.readFile(new URL("assessment-core.js", root), "utf8"),
    fs.readFile(new URL("supabase/functions/_shared/assessment-core.js", root), "utf8")
  ]);
  assert.equal(front, server, "更新算法后必须同步覆盖根目录 assessment-core.js");
});
