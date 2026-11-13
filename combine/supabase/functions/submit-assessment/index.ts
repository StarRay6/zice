import { createClient } from "npm:@supabase/supabase-js@2";
import "../_shared/assessment-core.js";

const core = (globalThis as any).AssessmentCore;
const MAX_BODY_BYTES = 64 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "https://starray6.github.io")
  .split(",").map((item) => item.trim()).filter(Boolean);

function headersFor(origin: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  if (origin && allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {status, headers: headersFor(origin)});
}

async function passesTurnstile(token: unknown) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return true;
  if (typeof token !== "string" || !token) return false;
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({secret, response: token})
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins.includes(origin)) {
    return jsonResponse(origin, 403, {ok: false, error: "来源不被允许"});
  }
  if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: headersFor(origin)});
  if (request.method !== "POST") return jsonResponse(origin, 405, {ok: false, error: "只支持 POST"});

  try {
    const contentLength = Number(request.headers.get("Content-Length") || "0");
    if (contentLength > MAX_BODY_BYTES) return jsonResponse(origin, 413, {ok: false, error: "请求内容过大"});
    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(origin, 415, {ok: false, error: "内容格式必须是 JSON"});
    }

    const text = await request.text();
    if (new Blob([text]).size > MAX_BODY_BYTES) return jsonResponse(origin, 413, {ok: false, error: "请求内容过大"});
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return jsonResponse(origin, 400, {ok: false, error: "JSON 格式无效"});
    }

    if (!payload || payload.consent !== true) {
      return jsonResponse(origin, 400, {ok: false, error: "未确认数据保存同意"});
    }
    if (typeof payload.consent_version !== "string" || !payload.consent_version.trim() || payload.consent_version.length > 100) {
      return jsonResponse(origin, 400, {ok: false, error: "同意文本版本无效"});
    }
    if (typeof payload.client_submission_id !== "string" || !UUID_RE.test(payload.client_submission_id)) {
      return jsonResponse(origin, 400, {ok: false, error: "提交标识无效"});
    }
    if (!await passesTurnstile(payload.turnstile_token)) {
      return jsonResponse(origin, 403, {ok: false, error: "人机校验未通过"});
    }

    const validation = core.validateSubmission(payload);
    if (!validation.valid) {
      return jsonResponse(origin, 400, {ok: false, error: "问卷数据未通过校验", details: validation.errors});
    }

    const result = core.calculateResult(validation.value);
    const writePayload = {
      ...validation.value,
      client_submission_id: payload.client_submission_id,
      constitution_version: core.CONSTITUTION_VERSION,
      yunqi_version: core.YUNQI_VERSION,
      consent_version: payload.consent_version.trim(),
      consented_at: new Date().toISOString()
    };

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase server environment is not configured");
      return jsonResponse(origin, 500, {ok: false, error: "服务端尚未完成配置"});
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {persistSession: false, autoRefreshToken: false}
    });
    const {data, error} = await supabase.rpc("submit_assessment", {
      p_payload: writePayload,
      p_result: result,
      p_code_commit: Deno.env.get("CODE_COMMIT") || "untracked"
    });
    if (error) {
      if (error.message.includes("different raw data")) {
        return jsonResponse(origin, 409, {ok: false, error: "提交标识已用于另一份问卷"});
      }
      console.error("submit_assessment RPC failed:", error.message);
      return jsonResponse(origin, 500, {ok: false, error: "数据保存失败，请稍后重试"});
    }

    return jsonResponse(origin, 200, {ok: true, submissionId: data});
  } catch (error) {
    console.error("submit-assessment failed:", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(origin, 500, {ok: false, error: "服务暂时不可用，请稍后重试"});
  }
});
