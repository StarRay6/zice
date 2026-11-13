-- 002_analysis.sql：分析视图（仅 service_role 可见）
-- v_submissions_full：一行 = 一份原始记录 × 一个算法版本的结果，
-- 便于按版本对比判定差异、导出统计。

create or replace view public.v_submissions_full as
select
  r.id as submission_id,
  r.client_submission_id,
  r.submitted_at,
  r.assessment_date,
  r.questionnaire_version,
  r.sex,
  r.birth_date,
  r.birth_prev_dahan,
  r.answers,
  a.constitution_version,
  a.yunqi_version,
  a.code_commit,
  a.main_constitution,
  a.main_level,
  a.mixed_constitutions,
  a.constitution_detail,
  a.yunqi_detail,
  a.joint_relation,
  a.calculated_at
from public.raw_submissions r
join public.assessment_results a on a.submission_id = r.id;

revoke all on public.v_submissions_full from public, anon, authenticated;
grant select on public.v_submissions_full to service_role;
