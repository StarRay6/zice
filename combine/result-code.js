/*!
 * result-code.js —— 答卷备份短码（编码 / 解码，前后端共用）
 *
 * 用途：
 *   访客保存失败时，结果页一键把「性别 + 生日 + 评估日期 + 全部答案」压成一段短码。
 *   访客把短码发给作者，作者用 tools/upload-code.mjs 还原后补录，数据不丢。
 *
 * 为什么能压得这么短：
 *   1) 混合进制（mixed-radix）打包：每题按「选项数 + 1」进位，27×log2(6)、
 *      4 选项题按 log2(5) 计，不做统一的 3 bit 浪费；
 *   2) 再把整个大整数用 Crockford Base32（32 进制）表示。
 *   合计约 118 bit，24 个字符就能装下，再加 1 位校验 = 25 字符。
 *
 * 编码格式（务必与解码顺序一致，改字段顺序 = 改版本号）：
 *   ver(4) sex(2) 年(128, 基准 1940) 月(12) 日(31) 大寒标记(2) 评估日偏移(16384)
 *   Q27 各 6 进制 → Q8 各 (选项数+1) 进制 → 校验 1 字符
 *
 * 显示形如：ZQ-3K7M9-P2XQR-8TVWX-YZ234-56789
 *
 * 注意：短码里含出生日期与全部答案，属于敏感信息，只应发给问卷作者本人。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiceCode = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Crockford Base32：去掉 I L O U，避免 1/0 混淆；解码时 I/L→1、O→0 */
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const DATA_CHARS = 24;          // 数据部分字符数（24 × 5 = 120 bit 容量）
  const TOTAL_CHARS = DATA_CHARS + 1;  // 末尾 1 位校验
  const PREFIX = "ZQ";
  const FORMAT_VERSION = 0;       // 编码格式版本（不是问卷版本）
  const BASE_YEAR = 1940;         // 出生年基准，128 年 → 1940..2067
  const BASE_DAY = Date.UTC(2024, 0, 1);  // 评估日期基准，16384 天 → 到 2068 年
  const DAY_MS = 86400000;

  function getCore(explicit) {
    const c = explicit || (typeof globalThis !== "undefined" ? globalThis.AssessmentCore : null);
    if (!c || !c.Q27 || !c.Q8) {
      throw new Error("缺少 AssessmentCore（需要先加载 assessment-core.js）");
    }
    return c;
  }

  /* 字段表：radix 决定该字段占多少「进制位」，顺序即打包顺序 */
  function fieldsOf(core) {
    const list = [
      {name: "ver", radix: 4},
      {name: "sex", radix: 2},
      {name: "year", radix: 128},
      {name: "month", radix: 12},
      {name: "day", radix: 31},
      {name: "prevDahan", radix: 2},
      {name: "dayOffset", radix: 16384}
    ];
    core.Q27.forEach(q => list.push({name: q.id, radix: 6}));
    core.Q8.forEach(q => list.push({name: q.id, radix: q.o.length + 1}));
    return list;
  }

  /* 与 assessment-core 的 parseBirthDate 保持一致的最小心解析 */
  function ymd(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return {y: y, m: mo, d: d};
  }
  const pad2 = n => String(n).padStart(2, "0");

  function digit(value, radix) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n >= radix) return 0;
    return n;
  }

  /* ---------- Base32（大整数） ---------- */

  function toBase32(big, len) {
    const out = new Array(len);
    let v = big;
    const B = BigInt(ALPHABET.length);
    for (let i = len - 1; i >= 0; i--) {
      out[i] = ALPHABET[Number(v % B)];
      v = v / B;
    }
    if (v !== BigInt(0)) throw new Error("数据超出短码容量（字段变多了？需要提高 FORMAT_VERSION）");
    return out.join("");
  }

  function fromBase32(text) {
    const B = BigInt(ALPHABET.length);
    let v = BigInt(0);
    for (let i = 0; i < text.length; i++) {
      const d = ALPHABET.indexOf(text.charAt(i));
      if (d < 0) throw new Error("短码里有非法字符：" + text.charAt(i));
      v = v * B + BigInt(d);
    }
    return v;
  }

  /* 校验位：位置加权和，能挡住绝大多数单字符抄错与相邻换位 */
  function checkChar(data) {
    let h = 7;
    for (let i = 0; i < data.length; i++) {
      h = (h * 31 + ALPHABET.indexOf(data.charAt(i)) * (i + 3)) % 9973;
    }
    return ALPHABET[h % 32];
  }

  /* ---------- 对外接口 ---------- */

  /* payload → 短码。payload 即前端 buildCloudPayload() 的产物。 */
  function encode(payload, coreExplicit) {
    const core = getCore(coreExplicit);
    if (!payload || typeof payload !== "object") throw new Error("payload 必须是对象");

    const birth = ymd(payload.birth_date);
    if (!birth) throw new Error("出生日期格式无效：" + payload.birth_date);
    const yearIdx = birth.y - BASE_YEAR;
    if (yearIdx < 0 || yearIdx >= 128) throw new Error("出生年份超出短码可表示范围（1940–2067）");

    const ad = ymd(payload.assessment_date) || ymd(new Date().toISOString().slice(0, 10));
    const dayOffset = Math.round((Date.UTC(ad.y, ad.m - 1, ad.d) - BASE_DAY) / DAY_MS);
    if (dayOffset < 0 || dayOffset >= 16384) throw new Error("评估日期超出短码可表示范围（2024–2068）");

    const list = fieldsOf(core);
    const answers = payload.answers || {};
    const vals = [
      FORMAT_VERSION,
      payload.sex === "f" ? 1 : 0,
      yearIdx,
      birth.m - 1,
      birth.d - 1,
      payload.birth_prev_dahan ? 1 : 0,
      dayOffset
    ];
    core.Q27.forEach(q => vals.push(digit(answers[q.id], 6)));
    core.Q8.forEach(q => vals.push(digit(answers[q.id], q.o.length + 1)));

    let big = BigInt(0);
    for (let i = 0; i < list.length; i++) {
      big = big * BigInt(list[i].radix) + BigInt(vals[i]);
    }
    const data = toBase32(big, DATA_CHARS);
    return PREFIX + "-" + formatGroups(data + checkChar(data));
  }

  /* 是否像一个短码（不校验内容，只做粗筛，便于 UI 即时判断） */
  function looksLike(text) {
    return clean(text).length === TOTAL_CHARS;
  }

  function clean(text) {
    let s = String(text || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (s.indexOf(PREFIX) === 0) s = s.slice(PREFIX.length);
    return s.replace(/I/g, "1").replace(/L/g, "1").replace(/O/g, "0");
  }

  function formatGroups(s) {
    const parts = [];
    for (let i = 0; i < s.length; i += 5) parts.push(s.slice(i, i + 5));
    return parts.join("-");
  }

  /* 短码 → {ok, payload, meta} 或 {ok:false, error} */
  function decode(text, coreExplicit) {
    const core = getCore(coreExplicit);
    const s = clean(text);
    if (s.length !== TOTAL_CHARS) {
      return {ok: false, error: "短码长度不对（应为 25 个字符，实际 " + s.length + " 个）"};
    }
    const data = s.slice(0, DATA_CHARS);
    const chk = s.slice(DATA_CHARS);
    const expect = checkChar(data);
    if (chk !== expect) {
      return {ok: false, error: "校验位不匹配，短码可能抄错或漏字符（末位应为 " + expect + "）"};
    }

    let big;
    try {
      big = fromBase32(data);
    } catch (e) {
      return {ok: false, error: String(e.message || e)};
    }

    const list = fieldsOf(core);
    const vals = new Array(list.length);
    for (let i = list.length - 1; i >= 0; i--) {
      const r = BigInt(list[i].radix);
      vals[i] = Number(big % r);
      big = big / r;
    }
    if (big !== BigInt(0)) return {ok: false, error: "短码内容非法（超出可表示范围）"};

    if (vals[0] !== FORMAT_VERSION) {
      return {ok: false, error: "短码格式版本是 v" + vals[0] + "，本工具只认 v" + FORMAT_VERSION + "，请更新工具"};
    }

    const sex = vals[1] === 1 ? "f" : "m";
    const year = BASE_YEAR + vals[2], month = vals[3] + 1, day = vals[4] + 1;
    const prevDahan = vals[5] === 1;
    const assessmentDate = new Date(BASE_DAY + vals[6] * DAY_MS);
    const assessmentDateText = assessmentDate.getUTCFullYear() + "-" +
      pad2(assessmentDate.getUTCMonth() + 1) + "-" + pad2(assessmentDate.getUTCDate());

    const answers = {};
    core.Q27.forEach(function (q, i) {
      const v = vals[7 + i];
      if (v > 0) answers[q.id] = v;
    });
    const off = 7 + core.Q27.length;
    core.Q8.forEach(function (q, i) {
      const v = vals[off + i];
      if (v > 0) answers[q.id] = v;
    });

    const payload = {
      questionnaire_version: core.QUESTIONNAIRE_VERSION,
      assessment_date: assessmentDateText,
      sex: sex,
      birth_date: year + "-" + pad2(month) + "-" + pad2(day),
      birth_prev_dahan: prevDahan,
      answers: answers
    };

    /* 用判定核心复核一遍：缺题、越界、性别专属题都能在这里拦住 */
    const v = core.validateSubmission(payload);
    if (!v.valid) {
      return {ok: false, error: "还原后的答卷没通过校验：" + v.errors.slice(0, 6).join("；")};
    }
    return {ok: true, payload: v.value, code: PREFIX + "-" + formatGroups(s)};
  }

  return {
    encode: encode,
    decode: decode,
    looksLike: looksLike,
    formatGroups: formatGroups,
    ALPHABET: ALPHABET,
    FORMAT_VERSION: FORMAT_VERSION,
    TOTAL_CHARS: TOTAL_CHARS
  };
});
