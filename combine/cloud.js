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
    card.appendChild(element("p", "lead", "数据保存"));
    card.appendChild(element("p", "data-save-copy",
      "你已在开始前同意保存。本次的性别、出生日期、问卷答案与判定结果将匿名保存，用于统计分析和改进判定标准。请保存下方记录编号，以便日后申请删除。"));

    const status = element("p", "data-save-status", "");
    status.setAttribute("role", "status");
    const retry = element("button", "primary", "重试保存");
    retry.type = "button";
    retry.style.display = "none";
    card.appendChild(status);
    card.appendChild(retry);
    container.appendChild(card);

    async function submit() {
      if (saving || saved) return;
      if (window.__consentGranted !== true) {
        status.textContent = "未获得保存同意，本次记录不会上传。";
        return;
      }
      if (!configured()) {
        status.textContent = "数据保存尚未配置：请先在 config.public.js 填写公开的 Supabase 配置。";
        return;
      }
      saving = true;
      retry.style.display = "none";
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
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || ("HTTP " + response.status));

        saved = true;
        status.textContent = "保存成功。记录编号：" + data.submissionId + "。请保存此编号，以便后续定位或申请删除记录。";
      } catch (error) {
        saving = false;
        retry.style.display = "";
        status.textContent = error && error.name === "AbortError"
          ? "保存超时。你的结果仍在，请检查网络后点「重试保存」。"
          : "保存失败。你的结果仍在，可稍后点「重试保存」；本次页面不会自动重复提交。";
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
