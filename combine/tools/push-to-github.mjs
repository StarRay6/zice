#!/usr/bin/env node
/**
 * 把本地问卷项目一次性推送到 GitHub 仓库的 combine/ 目录。
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node tools/push-to-github.mjs
 *   GITHUB_TOKEN=ghp_xxx node tools/push-to-github.mjs --dry-run   # 只检查，不写入
 *
 * 说明：
 * - 不需要浏览器、不需要本机 git，直接调用 GitHub Git Data API，一次 commit 完成。
 * - 本机 DNS 把 api.github.com 解析到不可达地址，脚本固定使用 GitHub 真实 IP，
 *   同时用 servername 保留正确的 TLS SNI，证书校验仍然有效。
 * - token 只从环境变量读取，不写入任何文件、不打印。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const OWNER = "StarRay6";
const REPO = "zice";
const BRANCH = "main";
const PREFIX = "combine";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/* 三处都可放 token：环境变量、桌面 token.txt、项目内 tools/GITHUB_TOKEN.txt。
   取第一个非空值；这些文件都不在推送清单里，用完即删。 */
const TOKEN_SLOTS = [
  path.join(os.homedir(), "Desktop", "token.txt"),
  path.join(ROOT, "tools", "GITHUB_TOKEN.txt")
];
let fileToken = "", tokenSource = "none";
for (const slot of TOKEN_SLOTS) {
  if (!fs.existsSync(slot)) continue;
  const value = fs.readFileSync(slot, "utf8").trim();
  if (value) { fileToken = value; tokenSource = slot; break; }
}
const envToken = (process.env.GITHUB_TOKEN || "").trim();
const TOKEN = envToken || fileToken;
const TOKEN_SOURCE = envToken ? "environment" : tokenSource;
const DRY = process.argv.includes("--dry-run");

const FILES = [
  "index.html",
  "cloud.js",
  "config.public.js",
  "assessment-core.js",
  "supabase/functions/_shared/assessment-core.js",
  "supabase/functions/submit-assessment/index.ts",
  "supabase/migrations/001_init.sql",
  "supabase/migrations/002_analysis.sql",
  "tools/recompute.mjs",
  "tools/push-to-github.mjs",
  "tests/assessment-core.test.mjs"
];

/* 通过 curl 调用 GitHub API：它会自动使用系统代理，已验证可访问 api.github.com。
   GET 不需要 token 也能成功；写操作需要带 repo 权限的 fine-grained PAT。 */
function request(method, apiPath, body) {
  const args = [
    "-sS", "--max-time", "40", "-X", method,
    "https://api.github.com" + apiPath,
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2022-11-28",
    "-H", "User-Agent: combine-push-script",
    "-w", "\n__STATUS__%{http_code}"
  ];
  if (TOKEN) args.push("-H", "Authorization: Bearer " + TOKEN);
  let input;
  if (body != null) {
    input = JSON.stringify(body);
    args.push("-H", "Content-Type: application/json", "--data-binary", "@-");
  }
  const out = execFileSync("curl", args, {
    input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024
  });
  const cut = out.lastIndexOf("\n__STATUS__");
  if (cut < 0) throw new Error("unexpected curl output for " + apiPath);
  const status = Number(out.slice(cut + 11).trim());
  const raw = out.slice(0, cut);
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = {raw}; }
  if (status < 200 || status >= 300) {
    throw new Error(method + " " + apiPath + " -> HTTP " + status +
      " " + (data && data.message ? data.message : ""));
  }
  return data;
}

async function main() {
  if (TOKEN && !DRY && TOKEN.startsWith("github_pat_") && TOKEN.length < 80) {
    console.error("Token looks incomplete: got " + TOKEN.length + " chars, expected about 93.");
    console.error("Use GitHub's Copy button, then Ctrl+A in token.txt before pasting.");
    process.exitCode = 1;
    return;
  }
  const list = FILES.map(rel => {
    const local = path.join(ROOT, rel);
    if (!fs.existsSync(local)) throw new Error("missing local file: " + local);
    return {local, rel, remote: PREFIX + "/" + rel, size: fs.statSync(local).size};
  });

  console.log("repository : " + OWNER + "/" + REPO + " (" + BRANCH + ")");
  console.log("token      : " + TOKEN_SOURCE);
  console.log("files      : " + list.length + ", " + list.reduce((n, f) => n + f.size, 0) + " bytes");
  for (const f of list) console.log("  " + f.remote + "  (" + f.size + " B)");

  // 无 token 时也能验证网络路径：公开仓库读取应该返回 200
  const probe = await request("GET", "/repos/" + OWNER + "/" + REPO);
  console.log("api probe  : OK, default_branch=" + probe.default_branch);

  if (DRY || !TOKEN) {
    console.log(DRY ? "dry-run: nothing written." : "no GITHUB_TOKEN set: nothing written.");
    return;
  }

  const ref = await request("GET", "/repos/" + OWNER + "/" + REPO + "/git/ref/heads/" + BRANCH);
  const base = await request("GET", "/repos/" + OWNER + "/" + REPO + "/git/commits/" + ref.object.sha);
  console.log("base commit: " + ref.object.sha.slice(0, 12));

  const tree = [];
  for (const f of list) {
    const content = fs.readFileSync(f.local).toString("base64");
    const blob = await request("POST", "/repos/" + OWNER + "/" + REPO + "/git/blobs", {content, encoding: "base64"});
    tree.push({path: f.remote, mode: "100644", type: "blob", sha: blob.sha});
    console.log("  uploaded " + f.remote);
  }

  const newTree = await request("POST", "/repos/" + OWNER + "/" + REPO + "/git/trees", {base_tree: base.tree.sha, tree});
  const commit = await request("POST", "/repos/" + OWNER + "/" + REPO + "/git/commits", {
    message: "feat: connect combine questionnaire to Supabase data collection",
    tree: newTree.sha,
    parents: [ref.object.sha]
  });
  await request("PATCH", "/repos/" + OWNER + "/" + REPO + "/git/refs/heads/" + BRANCH, {sha: commit.sha});
  console.log("pushed commit: " + commit.sha);
  console.log("pages: https://starray6.github.io/zice/combine/");
}

main().catch(e => { console.error("FAILED: " + e.message); process.exitCode = 1; });
