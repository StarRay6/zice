#!/usr/bin/env node
/* 历史数据重算：读取 raw_submissions，用共享判定核心重新计算，
   按 (submission_id, constitution_version, yunqi_version) 插入 assessment_results。
   已有同版本结果的记录自动跳过，不修改原始数据。

   用法：
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tools/recompute.mjs \
       --cv constitution-v2.0 --yv yunqi-v2.0 --commit abc1234

   说明：
   - 密钥只从环境变量读取，只在本机使用，绝不写进仓库。
   - 更新判定算法时：先改 supabase/functions/_shared/assessment-core.js，
     升级其中 CONSTITUTION_VERSION / YUNQI_VERSION，再运行本工具生成新版本结果。
   - 问卷版本不兼容的历史记录会明确列出，不做任何补造。 */
import core from "../supabase/functions/_shared/assessment-core.js";

const args = process.argv.slice(2);
function argOf(name) {
  const index = args.indexOf("--" + name);
  return index >= 0 ? args[index + 1] : null;
}

const CONSTITUTION_VERSION = argOf("cv") || core.CONSTITUTION_VERSION;
const YUNQI_VERSION = argOf("yv") || core.YUNQI_VERSION;
const CODE_COMMIT = argOf("commit") || "untracked";
const BATCH = 100;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("缺少环境变量 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。");
  console.error("密钥只在命令行环境临时提供，不要写进任何文件。");
  process.exit(1);
}

const base = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";
const headers = {
  "apikey": SERVICE_KEY,
  "Authorization": "Bearer " + SERVICE_KEY,
  "Content-Type": "application/json"
};

async function rest(path, init) {
  const response = await fetch(base + path, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(path + " -> HTTP " + response.status + " " + body.slice(0, 300));
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function loadExistingResultIds() {
  const existing = new Set();
  let from = 0;
  for (;;) {
    const rows = await rest(
      "/assessment_results?select=submission_id&constitution_version=eq." + encodeURIComponent(CONSTITUTION_VERSION) +
      "&yunqi_version=eq." + encodeURIComponent(YUNQI_VERSION) +
      "&order=submission_id&limit=1000&offset=" + from,
      {headers}
    );
    rows.forEach(row => existing.add(row.submission_id));
    if (rows.length < 1000) break;
    from += 1000;
  }
  return existing;
}

function buildResultRow(raw) {
  const result = core.calculateResult({
    answers: raw.answers,
    sex: raw.sex,
    birth_date: raw.birth_date,
    birth_prev_dahan: raw.birth_prev_dahan,
    assessment_date: raw.assessment_date
  });
  const constitution = result.constitution;
  return {
    submission_id: raw.id,
    constitution_version: CONSTITUTION_VERSION,
    yunqi_version: YUNQI_VERSION,
    code_commit: CODE_COMMIT,
    constitution_detail: constitution,
    main_constitution: constitution.main || null,
    main_level: constitution.mainLevel || "",
    mixed_constitutions: constitution.mixed,
    yunqi_detail: result.yunqi,
    joint_relation: result.joint_relation
  };
}

async function main() {
  console.log("算法版本：" + CONSTITUTION_VERSION + " + " + YUNQI_VERSION + "（代码提交 " + CODE_COMMIT + "）");
  const existing = await loadExistingResultIds();

  let processed = 0, inserted = 0, skippedExisting = 0, incompatible = 0, failed = 0;
  const incompatibleVersions = new Map();
  const errors = [];
  let offset = 0;
  const pending = [];

  for (;;) {
    const rows = await rest(
      "/raw_submissions?select=id,questionnaire_version,sex,birth_date,birth_prev_dahan,answers,assessment_date" +
      "&order=submitted_at&limit=500&offset=" + offset,
      {headers}
    );
    if (!rows.length) break;

    for (const raw of rows) {
      processed++;
      if (!core.SUPPORTED_QUESTIONNAIRE_VERSIONS.includes(raw.questionnaire_version)) {
        incompatible++;
        incompatibleVersions.set(raw.questionnaire_version, (incompatibleVersions.get(raw.questionnaire_version) || 0) + 1);
        continue;
      }
      if (existing.has(raw.id)) { skippedExisting++; continue; }
      try {
        pending.push(buildResultRow(raw));
      } catch (error) {
        failed++;
        errors.push(raw.id + ": " + (error && error.message ? error.message : error));
      }
      if (pending.length >= BATCH) {
        await flush(pending, headers, rest);
        inserted += pending.length;
        pending.length = 0;
      }
    }

    if (rows.length < 500) break;
    offset += 500;
  }

  if (pending.length) {
    await flush(pending, headers, rest);
    inserted += pending.length;
  }

  console.log("处理原始记录：" + processed);
  console.log("新插入结果：" + inserted);
  console.log("已有同版本结果跳过：" + skippedExisting);
  console.log("问卷版本不兼容跳过：" + incompatible);
  incompatibleVersions.forEach((count, version) => console.log("  - " + version + "：" + count + " 条"));
  if (failed) {
    console.log("计算失败：" + failed);
    errors.forEach(line => console.log("  - " + line));
  }
  if (incompatible || failed) process.exitCode = 2;
}

async function flush(rows, headers, rest) {
  const body = JSON.stringify(rows);
  const response = await fetch(base + "/assessment_results", {
    method: "POST",
    headers: Object.assign({}, headers, {"Prefer": "resolution=merge-duplicates"}),
    body: body
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error("批量插入失败 HTTP " + response.status + " " + text.slice(0, 300));
  }
  await response.text();
}

main().catch(error => {
  console.error("重算中断：" + (error && error.message ? error.message : error));
  process.exit(1);
});
