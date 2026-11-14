/*!
 * result-code.js —— 答卷备份短码（编码 / 解码，前后端共用）
 *
 * 用途：
 *   访客保存失败时，结果页一键把「性别 + 生日 + 评估日期 + 全部答案 + 提交标识」
 *   压成一段短码。访客把短码发给作者，作者用 tools/upload-code.mjs 还原后补录。
 *
 * 为什么要带提交标识（v1 新增）：
 *   访客保存失败时，页面把这份答卷连同「提交标识」一起暂存在本机浏览器，下次打开
 *   页面会用同一个标识补传。短码里编进同一个标识，作者补录时写库用的就是它，
 *   访客日后补传会命中唯一约束（on conflict do nothing），不会变成两条。
 *   标识只留 48 bit：170 bit 的容量里已经用掉 118.2 bit，128 bit 的 UUID 根本装不进。
 *
 * 为什么能压得这么短：
 *   1) 混合进制（mixed-radix）打包：每题按「选项数 + 1」进位，27×log2(6)、
 *      4 选项题按 log2(5) 计，不做统一的 3 bit 浪费；
 *   2) 再把整个大整数用 Crockford Base32（32 进制）表示。
 *
 * 编码格式（务必与解码顺序一致，改字段顺序 = 改版本号）：
 *   v1: ver(4) id(2^48) sex(2) 年(128) 月(12) 日(31) 大寒(2) 评估日偏移(16384)
 *       Q27 各 6 进制 → Q8 各 (选项数+1) 进制 → 校验 1 字符 = 35 字符（166.2/170 bit）
 *   v0: 同上去掉 id 字段，25 字符。老短码仍能解，只是没有标识可用于对齐。
 *
 * 显示形如：ZQ-3K7M9-P2XQR-8TVWX-YZ234-56789-ABCDE-FGHJK
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
  const PREFIX = "ZQ";

  const FORMAT_VERSION = 1;       // 当前格式：带 48 bit 提交标识
  const LEGACY_VERSION = 0;       // 老格式：无标识，保留解码能力
  const DATA_CHARS_V1 = 34;       // 34 × 5 = 170 bit 容量
  const DATA_CHARS_V0 = 24;       // 24 × 5 = 120 bit 容量
  const TOTAL_CHARS_V1 = DATA_CHARS_V1 + 1;   // 末尾 1 位校验 → 35
  const TOTAL_CHARS_V0 = DATA_CHARS_V0 + 1;   // → 25
  const TOTAL_CHARS = TOTAL_CHARS_V1;

  const BASE_YEAR = 1940;         // 出生年基准，128 年 → 1940..2067
  const BASE_DAY = Date.UTC(2024, 0, 1);  // 评估日期基准，16384 天 → 到 2068 年
  const DAY_MS = 86400000;

  const ID_RADIX = 281474976710656n;   // 2^48
  const ID_HEX = 12;                   // 48 bit = 12 个十六进制字符

  function getCore(explicit) {
    const c = explicit || (typeof globalThis !== "undefined" ? globalThis.AssessmentCore : null);
    if (!c || !c.Q27 || !c.Q8) {
      throw new Error("缺少 AssessmentCore（需要先加载 assessment-core.js）");
    }
    return c;
  }

  /* 字段表：radix 决定该字段占多少「进制位」，顺序即打包顺序 */
  function fieldsOf(core, version) {
    const list = [{name: "ver", radix: 4}];
    if (version === FORMAT_VERSION) list.push({name: "id", radix: ID_RADIX});
    list.push(
      {name: "sex", radix: 2},
      {name: "year", radix: 128},
      {name: "month", radix: 12},
      {name: "day", radix: 31},
      {name: "prevDahan", radix: 2},
      {name: "dayOffset", radix: 16384}
    );
    core.Q27.forEach(q => list.push({name: q.id, radix: 6}));
    core.Q8.forEach(q => list.push({name: q.id, radix: q.o.length + 1}));
    return list;
  }

  /* ---------- 提交标识（48 bit，包成合法 UUID） ---------- */

  function hex48(value) {
    return (BigInt(value) & (ID_RADIX - 1n)).toString(16).padStart(ID_HEX, "0");
  }

  /* 12 个十六进制字符填进前两段，version/variant 位固定，保证能通过服务端的 UUID 校验 */
  function uuidFromId(value) {
    const h = hex48(value);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-5000-a000-000000000000";
  }

  function idFromText(text) {
    const hex = String(text == null ? "" : text).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, ID_HEX);
    if (hex.length < ID_HEX) return null;
    return BigInt("0x" + hex);
  }

  function randomId() {
    const c = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    if (c && typeof c.getRandomValues === "function") {
      const buf = new Uint8Array(6);
      c.getRandomValues(buf);
      let v = 0n;
      for (let i = 0; i < 6; i++) v = (v << 8n) | BigInt(buf[i]);
      return v;
    }
    /* 极端环境（无 crypto）退化为 Math.random，仍然每次不同 */
    let v = 0n;
    for (let i = 0; i < 6; i++) v = (v << 8n) | BigInt((Math.random() * 256) | 0);
    return v;
  }

  /* 生成一个新的提交标识（UUID 形态） */
  function newSubmissionId() {
    return uuidFromId(randomId());
  }

  /* 把任意 UUID / 十六进制串收敛成同一个规范标识：
     老版本页面用 crypto.randomUUID() 生成的随机 UUID，前 12 位十六进制相同即同一份；
     收敛后短码里编的、服务端写库用的都是这一个值。 */
  function normalizeSubmissionId(value) {
    const id = idFromText(value);
    return id == null ? newSubmissionId() : uuidFromId(id);
  }

  /* 是否像一个短码（不校验内容，只做粗筛，便于 UI 即时判断） */
  function looksLike(text) {
    const n = clean(text).length;
    return n === TOTAL_CHARS_V1 || n === TOTAL_CHARS_V0;
  }

  function clean(text) {
    let s = String(text || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (s.indexOf(PREFIX) === 0) s = s.slice(PREFIX.length);
    return s.replace(/I/g, "1").replace(/L/g, "1").replace(/O/g, "0");
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

  function formatGroups(s) {
    const parts = [];
    for (let i = 0; i < s.length; i += 5) parts.push(s.slice(i, i + 5));
    return parts.join("-");
  }

  /* ---------- 对外接口 ---------- */

  /* payload → 短码（总是 v1）。payload 即前端 buildCloudPayload() 的产物；
     带 client_submission_id 时该标识会被编进短码，不带就现生成一个。 */
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

    const knownId = idFromText(payload.client_submission_id);
    const id = knownId == null ? randomId() : knownId;

    const list = fieldsOf(core, FORMAT_VERSION);
    const answers = payload.answers || {};
    const vals = [
      FORMAT_VERSION,
      id,
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
    const data = toBase32(big, DATA_CHARS_V1);
    return PREFIX + "-" + formatGroups(data + checkChar(data));
  }

  /* 短码 → {ok, payload, code, meta} 或 {ok:false, error}
     v1（35 字符）的 meta.clientSubmissionId 就是写库要用的标识；v0（25 字符）为 null。 */
  function decode(text, coreExplicit) {
    const core = getCore(coreExplicit);
    const s = clean(text);
    let version, dataChars;
    if (s.length === TOTAL_CHARS_V1) {
      version = FORMAT_VERSION;
      dataChars = DATA_CHARS_V1;
    } else if (s.length === TOTAL_CHARS_V0) {
      version = LEGACY_VERSION;
      dataChars = DATA_CHARS_V0;
    } else {
      return {ok: false, error: "短码长度不对（新码 35 个字符、旧码 25 个，实际 " + s.length + " 个）"};
    }

    const data = s.slice(0, dataChars);
    const chk = s.slice(dataChars);
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

    const list = fieldsOf(core, version);
    const vals = new Array(list.length);
    for (let i = list.length - 1; i >= 0; i--) {
      const r = BigInt(list[i].radix);
      vals[i] = Number(big % r);
      big = big / r;
    }
    if (big !== BigInt(0)) return {ok: false, error: "短码内容非法（超出可表示范围）"};

    if (vals[0] !== version) {
      return {ok: false, error: "短码格式版本是 v" + vals[0] + "，与长度推断的 v" + version + " 不一致，可能被截断"};
    }

    let at = 1;
    const idValue = version === FORMAT_VERSION ? vals[at++] : null;
    const sex = vals[at++] === 1 ? "f" : "m";
    const year = BASE_YEAR + vals[at++], month = vals[at++] + 1, day = vals[at++] + 1;
    const prevDahan = vals[at++] === 1;
    const assessmentDate = new Date(BASE_DAY + vals[at++] * DAY_MS);
    const assessmentDateText = assessmentDate.getUTCFullYear() + "-" +
      pad2(assessmentDate.getUTCMonth() + 1) + "-" + pad2(assessmentDate.getUTCDate());

    const answers = {};
    core.Q27.forEach(function (q, i) {
      const v = vals[at + i];
      if (v > 0) answers[q.id] = v;
    });
    at += core.Q27.length;
    core.Q8.forEach(function (q, i) {
      const v = vals[at + i];
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

    const clientSubmissionId = idValue == null ? null : uuidFromId(idValue);
    const value = v.value;
    if (clientSubmissionId) value.client_submission_id = clientSubmissionId;

    return {
      ok: true,
      payload: value,
      code: PREFIX + "-" + formatGroups(s),
      meta: {version: version, clientSubmissionId: clientSubmissionId}
    };
  }

  return {
    encode: encode,
    decode: decode,
    looksLike: looksLike,
    formatGroups: formatGroups,
    newSubmissionId: newSubmissionId,
    normalizeSubmissionId: normalizeSubmissionId,
    ALPHABET: ALPHABET,
    FORMAT_VERSION: FORMAT_VERSION,
    LEGACY_VERSION: LEGACY_VERSION,
    TOTAL_CHARS: TOTAL_CHARS,
    TOTAL_CHARS_V0: TOTAL_CHARS_V0
  };
});
