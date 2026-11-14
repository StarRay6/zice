(function () {
  "use strict";

  /* 告知与同意已移到问卷开始之前，结果页据此自动保存，不再二次勾选。
     Edge Function 只校验 consent === true 与版本号非空，版本可随告知流程升级。 */
  const CONSENT_VERSION = "data-consent-v2.0";

  /* 保存策略：
     1) 单次请求 12 秒超时；失败自动重试（共 3 次，间隔 1.2s / 2.4s）。
        手机网络常有"一阵一阵连不上"的情况，重试能救回大部分。
     2) 3 次都失败，就把这份答卷暂存在本机浏览器里，联网/下次打开本页时自动补传。
        补传用同一个 client_submission_id，服务端是幂等的，不会产生重复记录。
        这个标识同时被编进「备份短码」，作者若先拿短码手工补录了，访客再补传也会
        命中同一个唯一约束被挡掉，同样不会变两条。
     3) 暂存内容只放在本设备，补传成功即删除。 */
  const QUEUE_KEY = "assessment_pending_v1";
  const MAX_ATTEMPTS = 3;
  const TIMEOUT_MS = 12000;

  let clientSubmissionId = newId();
  let saving = false;
  let saved = false;

  /* 提交标识：优先用短码库的 48 bit 版本 —— 它能被编进备份短码，作者补录时写库用的
     就是同一个标识，访客下次联网补传会命中唯一约束，不会变成两条。
     短码库没加载上时退回随机 UUID（只能保证本机重试不重复）。 */
  function newId() {
    if (window.ZiceCode && typeof window.ZiceCode.newSubmissionId === "function") {
      return window.ZiceCode.newSubmissionId();
    }
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    /* 老版本 iOS Safari 没有 randomUUID，退化成随机串，避免整个脚本报错。 */
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /* 把任意标识收敛成规范形态：老队列里存的整串随机 UUID，会收敛成同一个 48 bit 标识，
     这样它和短码里编的、服务端记的才对得上。 */
  function canonicalId(id) {
    if (window.ZiceCode && typeof window.ZiceCode.normalizeSubmissionId === "function") {
      return window.ZiceCode.normalizeSubmissionId(id);
    }
    return id || newId();
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function configured() {
    const config = window.APP_PUBLIC_CONFIG || {};
    return /^https:\/\/.+\.supabase\.co\/?$/.test(config.supabaseUrl || "") &&
      typeof config.supabaseAnonKey === "string" && config.supabaseAnonKey.length > 20;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ---------- 本机待补传队列 ---------- */
  function readQueue() {
    try {
      const list = JSON.parse(window.localStorage.getItem(QUEUE_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeQueue(list) {
    try {
      if (!list.length) window.localStorage.removeItem(QUEUE_KEY);
      else window.localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-5)));
    } catch (e) { /* 无痕模式等场景写不了，忽略 */ }
  }

  function enqueue(payload) {
    const list = readQueue().filter(function (x) {
      return x.client_submission_id !== payload.client_submission_id;
    });
    list.push(payload);
    writeQueue(list);
  }

  function dequeue(id) {
    writeQueue(readQueue().filter(function (x) { return x.client_submission_id !== id; }));
  }

  /* ---------- 网络 ---------- */
  function friendly(error) {
    const msg = String((error && error.message) || "");
    if (error && error.name === "AbortError") return "网络太慢或无法连接（超时）";
    if (/Load failed|Failed to fetch|NetworkError|network connection was lost|The network connection was lost/i.test(msg)) {
      return "网络无法连接（手机网络访问该服务器失败）";
    }
    return msg || "未知错误";
  }

  async function sendOnce(payload) {
    const config = window.APP_PUBLIC_CONFIG;
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    try {
      const response = await fetch(config.supabaseUrl.replace(/\/$/, "") + "/functions/v1/submit-assessment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": config.supabaseAnonKey,
          "Authorization": "Bearer " + config.supabaseAnonKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      let data = {};
      try { data = await response.json(); } catch (e) { /* 响应不是 JSON */ }
      if (!response.ok || !data.ok) {
        const detail = data.error
          ? String(data.error)
          : "HTTP " + response.status + (response.statusText ? " " + response.statusText : "");
        throw new Error(detail);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendWithRetry(payload, onAttempt) {
    let lastError = null;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      try {
        return await sendOnce(payload);
      } catch (error) {
        lastError = error;
        if (i < MAX_ATTEMPTS) {
          if (typeof onAttempt === "function") onAttempt(i, error);
          await sleep(i * 1200);
        }
      }
    }
    throw lastError;
  }

  /* 补传此前失败的记录（成功一条删一条）。 */
  async function flushQueue() {
    if (!configured()) return;
    const list = readQueue();
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      /* 老队列里可能存着整串随机 UUID，补传前统一收敛，跟短码里的标识对齐 */
      const id = canonicalId(item.client_submission_id);
      try {
        await sendOnce(Object.assign({}, item, {client_submission_id: id}));
        dequeue(item.client_submission_id);
      } catch (e) { /* 还是连不上，留着下次 */ }
    }
  }

  function mount(container, rawPayload) {
    const card = element("section", "data-save");
    card.appendChild(element("p", "lead", "数据保存状态"));
    card.appendChild(element("p", "data-save-copy",
      "你已在开始前同意保存。本次的性别、出生日期、问卷答案与判定结果将匿名保存，用于统计分析和改进判定标准。" +
      "若网络中断，结果会先暂存在本机浏览器，联网后自动补传，补传成功后即从本机删除。"));

    const status = element("p", "data-save-status", "");
    status.setAttribute("role", "status");
    const retry = element("button", "primary", "重试保存");
    retry.type = "button";
    retry.style.display = "none";
    card.appendChild(status);
    card.appendChild(retry);
    /* 结果页很长，放在最底部容易看不到保存失败；放到最前面让状态一眼可见。 */
    container.insertBefore(card, container.firstChild);

    function fail(text) {
      saving = false;
      retry.style.display = "";
      status.className = "data-save-status is-error";
      status.textContent = text;
    }

    async function submit() {
      if (saving || saved) return;

      if (window.__consentGranted !== true) {
        fail("未获得保存同意，本次记录不会上传。请返回首页重新勾选同意后再做一次。");
        return;
      }
      if (!configured()) {
        fail("数据保存尚未配置：请先在 config.public.js 填写公开的 Supabase 配置。");
        return;
      }

      saving = true;
      retry.style.display = "none";
      status.className = "data-save-status";
      status.textContent = "正在保存，请稍候…";

      const payload = Object.assign({}, rawPayload, {
        client_submission_id: canonicalId(clientSubmissionId),
        consent: true,
        consent_version: CONSENT_VERSION
      });

      try {
        const data = await sendWithRetry(payload, function (attempt) {
          status.textContent = "正在保存…第 " + (attempt + 1) + " 次尝试（前一次没连上）";
        });
        saved = true;
        dequeue(payload.client_submission_id);
        status.className = "data-save-status is-ok";
        status.textContent = "保存成功。记录编号：" + data.submissionId + "。请保存此编号，以便后续定位或申请删除记录。";
        flushQueue();                            // 顺手把以前没传上的也补一遍
      } catch (error) {
        enqueue(payload);                        // 暂存本机，等网络恢复自动补传
        fail("保存失败：" + friendly(error) +
          "。本次结果已暂存在本机浏览器，联网后会自动补传（记录编号：" + clientSubmissionId +
          "）。也可点「重试保存」立即再试。");
      } finally {
        saving = false;
      }
    }

    retry.addEventListener("click", submit);
    window.addEventListener("online", function () { flushQueue(); });
    submit();                                  // 结果生成后自动保存
  }

  function reset() {
    clientSubmissionId = newId();
    saving = false;
    saved = false;
  }

  /* 页面一打开就试着补传以前失败的记录（不必重新答题）。
     延时 1.5 秒，避免和页面首屏渲染抢带宽。 */
  function bootFlush() {
    if (!configured()) return;
    setTimeout(function () {
      if (readQueue().length) flushQueue();
    }, 1500);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootFlush);
  } else {
    bootFlush();
  }

  /* currentSubmissionId：结果页生成备份短码时要用它，保证短码里的标识和真正写库的一致 */
  window.AssessmentCloud = {
    mount: mount,
    reset: reset,
    flushQueue: flushQueue,
    currentSubmissionId: function () { return canonicalId(clientSubmissionId); }
  };
})();
