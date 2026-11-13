create extension if not exists pgcrypto;

create table if not exists public.raw_submissions (
  id uuid primary key default gen_random_uuid(),
  client_submission_id uuid not null unique,
  submitted_at timestamptz not null default now(),
  assessment_date date not null,
  questionnaire_version text not null,
  sex text not null check (sex in ('m', 'f')),
  birth_date date not null,
  birth_prev_dahan boolean not null default false,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  consent_version text not null,
  consented_at timestamptz not null,
  constraint raw_submissions_answers_object check (answers is not null)
);

create index if not exists raw_submissions_submitted_at_idx
  on public.raw_submissions (submitted_at desc);
create index if not exists raw_submissions_questionnaire_version_idx
  on public.raw_submissions (questionnaire_version);

create table if not exists public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.raw_submissions(id) on delete restrict,
  constitution_version text not null,
  yunqi_version text not null,
  code_commit text not null,
  constitution_detail jsonb not null check (jsonb_typeof(constitution_detail) = 'object'),
  main_constitution text,
  main_level text not null default '',
  mixed_constitutions text[] not null default '{}',
  yunqi_detail jsonb not null check (jsonb_typeof(yunqi_detail) = 'object'),
  joint_relation text not null check (joint_relation in ('same', 'part', 'diff', 'none', 'pinghe')),
  calculated_at timestamptz not null default now(),
  unique (submission_id, constitution_version, yunqi_version)
);

create index if not exists assessment_results_versions_idx
  on public.assessment_results (constitution_version, yunqi_version);
create index if not exists assessment_results_submission_idx
  on public.assessment_results (submission_id);

alter table public.raw_submissions enable row level security;
alter table public.assessment_results enable row level security;

revoke all on table public.raw_submissions from anon, authenticated;
revoke all on table public.assessment_results from anon, authenticated;
grant select, insert on table public.raw_submissions to service_role;
grant select, insert on table public.assessment_results to service_role;

create or replace function public.submit_assessment(
  p_payload jsonb,
  p_result jsonb,
  p_code_commit text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission_id uuid;
  v_existing public.raw_submissions%rowtype;
  v_mixed text[];
begin
  if p_payload is null or p_result is null then
    raise exception 'payload and result are required';
  end if;

  insert into public.raw_submissions (
    client_submission_id,
    assessment_date,
    questionnaire_version,
    sex,
    birth_date,
    birth_prev_dahan,
    answers,
    consent_version,
    consented_at
  ) values (
    (p_payload->>'client_submission_id')::uuid,
    (p_payload->>'assessment_date')::date,
    p_payload->>'questionnaire_version',
    p_payload->>'sex',
    (p_payload->>'birth_date')::date,
    coalesce((p_payload->>'birth_prev_dahan')::boolean, false),
    p_payload->'answers',
    p_payload->>'consent_version',
    (p_payload->>'consented_at')::timestamptz
  )
  on conflict (client_submission_id) do nothing
  returning id into v_submission_id;

  if v_submission_id is null then
    select * into v_existing
      from public.raw_submissions
      where client_submission_id = (p_payload->>'client_submission_id')::uuid;

    if not found then
      raise exception 'failed to load existing submission';
    end if;

    if v_existing.assessment_date is distinct from (p_payload->>'assessment_date')::date
      or v_existing.questionnaire_version is distinct from p_payload->>'questionnaire_version'
      or v_existing.sex is distinct from p_payload->>'sex'
      or v_existing.birth_date is distinct from (p_payload->>'birth_date')::date
      or v_existing.birth_prev_dahan is distinct from coalesce((p_payload->>'birth_prev_dahan')::boolean, false)
      or v_existing.answers is distinct from p_payload->'answers' then
      raise exception 'client_submission_id already belongs to different raw data';
    end if;

    v_submission_id := v_existing.id;
  end if;

  select coalesce(array_agg(value), '{}'::text[]) into v_mixed
    from jsonb_array_elements_text(coalesce(p_result->'constitution'->'mixed', '[]'::jsonb));

  insert into public.assessment_results (
    submission_id,
    constitution_version,
    yunqi_version,
    code_commit,
    constitution_detail,
    main_constitution,
    main_level,
    mixed_constitutions,
    yunqi_detail,
    joint_relation
  ) values (
    v_submission_id,
    p_payload->>'constitution_version',
    p_payload->>'yunqi_version',
    coalesce(nullif(p_code_commit, ''), 'untracked'),
    p_result->'constitution',
    nullif(p_result->'constitution'->>'main', ''),
    coalesce(p_result->'constitution'->>'mainLevel', ''),
    v_mixed,
    p_result->'yunqi',
    p_result->>'joint_relation'
  )
  on conflict (submission_id, constitution_version, yunqi_version) do nothing;

  return v_submission_id;
end;
$$;

revoke all on function public.submit_assessment(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_assessment(jsonb, jsonb, text) to service_role;
