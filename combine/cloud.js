(function () {
  "use strict";

  const CONSENT_VERSION = "data-consent-v1.0";
  let clientSubmissionId = crypto.randomUUID();
  let saving = false;
  let saved = false;

  function configured() {
    const config = window.APP_PUBLIC_CONFIG || {};
    return /^https:\/\/.+\.supabase\.co\/?$/.test(config.supabaseUrl || "") && typeof config.supabaseAnonKey === "string" && config.supabaseAnonKey.length > 20;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function mount(container, rawPayload) {
    const card = element("section", "data-save");
    card.appendChild(element("p", "lead", "匿名保存本次记录"));
    card.appendChild(element("p", "data-save-copy", "如同意，将保存你的性别、出生日期、问卷答案及由服务端计算的判定结果，用于统计分析和改进判定标准。不收集姓名、手机号或联系方式。不同意也可正常使用全部结果功能。"));

    const label = element("label", "data-save-consent");
    const consent = document.createElement("input");
    consent.type = "checkbox";
    consent.id = "saveConsent";
    label.appendChild(consent);
    label.appendChild(element("span", null, "我已阅读上述说明，并同意匿名保存本次记录"));
    card.appendChild(label);

    const button = element("button", "primary", "保存本次记录");
    button.type = "button";
    const status = element("p", "data-save-status", "尚未保存");
    status.setAttribute("role", "status");
    card.appendChild(button);
    card.appendChild(status);

    if (!configured()) {
      button.disabled = true;
      consent.disabled = true;
      status.textContent = "数据保存尚未配置：请先在 config.public.js 填写公开的 Supabase 配置。";
    }

    button.addEventListener("click", async function () {
      if (saving || saved) return;
      if (!consent.checked) {
        status.textContent = "请先勾选同意；不勾选不会影响查看、导出或生成图片。";
        return;
      }
      saving = true;
      button.disabled = true;
      consent.disabled = true;
      status.textContent = "正在保存，请不要重复点击…";

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
        button.textContent = "已保存";
        status.textContent = "保存成功。记录编号：" + data.submissionId + "。请保存此编号，以便后续定位或申请删除记录。";
      } catch (error) {
        saving = false;
        button.disabled = false;
        consent.disabled = false;
        button.textContent = "重试保存";
        status.textContent = error && error.name === "AbortError"
          ? "保存超时。你的结果仍在，请检查网络后重试。"
          : "保存失败。你的结果仍在，可稍后重试；本次页面不会自动重复提交。";
      } finally {
        clearTimeout(timeout);
      }
    });

    container.appendChild(card);
  }

  function reset() {
    clientSubmissionId = crypto.randomUUID();
    saving = false;
    saved = false;
  }

  window.AssessmentCloud = {mount: mount, reset: reset};
})();
