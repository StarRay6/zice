(function () {
  "use strict";

  /* 告知与同意已移到问卷开始之前，结果页据此自动保存，不再二次勾选。
     Edge Function 只校验 consent === true 与版本号非空，版本可随告知流程升级。 */
  const CONSENT_VERSION = "data-consent-v2.0";
  let clientSubmissionId = crypto.randomUUID();
  let saving = false;
  let saved = false;

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

  function mount(container, rawPayload) {
    const card = element("section", "data-save");
    card.appendChild(element("p", "lead", "数据保存状态"));
    card.appendChild(element("p", "data-save-copy",
      "你已在开始前同意保存。本次的性别、出生日期、问卷答案与判定结果将匿名保存，用于统计分析和改进判定标准。请保存下方记录编号，以便日后申请删除。"));

    const status = element("p", "data-save-status", "");
    status.setAttribute("role", "status");
    const retry = element("button", "primary", "重试保存");
    retry.type = "button";
    retry.style.display = "none";
    card.appendChild(status);
    card.appendChild(retry);
    /* 结果页很长，放在最底部容易看不到保存失败；放到最前面让状态一眼可见。 */
    container.insertBefore(card, container.firstChild);

    async function submit() {
      if (saving || saved) return;

      function fail(text) {
        saving = false;
        retry.style.display = "";
        status.className = "data-save-status is-error";
        status.textContent = text;
      }

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

      const config = window.APP_PUBLIC_CONFIG;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(config.supabaseUrl.replace(/\/$/, "") + "/functions/v1/submit-assessment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": config.supabaseAnonKey,
            "Authorization": "Bearer " + config.supabaseAnonKey
          },
          body: JSON.stringify(Object.assign({}, rawPayload, {
            client_submission_id: clientSubmissionId,
            consent: true,
            consent_version: CONSENT_VERSION
          })),
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

        saved = true;
        status.className = "data-save-status is-ok";
        status.textContent = "保存成功。记录编号：" + data.submissionId + "。请保存此编号，以便后续定位或申请删除记录。";
      } catch (error) {
        const reason = error && error.message ? String(error.message) : "未知错误";
        if (error && error.name === "AbortError") {
          fail("保存超时（15 秒无响应）。你的结果仍在，请检查网络后点「重试保存」；请把这段文字截图发给管理员。");
        } else {
          fail("保存失败：" + reason + "。你的结果仍在，可稍后点「重试保存」；请把这段文字截图发给管理员以便排查。");
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    retry.addEventListener("click", submit);
    submit();                                  // 结果生成后自动保存
  }

  function reset() {
    clientSubmissionId = crypto.randomUUID();
    saving = false;
    saved = false;
  }

  window.AssessmentCloud = {mount: mount, reset: reset};
})();
