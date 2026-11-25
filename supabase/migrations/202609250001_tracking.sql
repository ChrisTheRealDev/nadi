-- Tracking schema v1. Run through the owner migration workflow, not the frontend.
-- SECURITY DEFINER functions below have fixed search paths and explicit auth/assignment checks.
create table public.nadi_profiles (id uuid primary key references auth.users(id), display_name text not null check(length(display_name) between 1 and 120), role text not null check(role in ('student','mentor')));
create table public.nadi_assignments (learner_id uuid primary key references public.nadi_profiles(id), mentor_id uuid not null references public.nadi_profiles(id), check(learner_id <> mentor_id));
create table public.nadi_disclosures (learner_id uuid primary key references public.nadi_profiles(id), version integer not null check(version=1), accepted_at timestamptz not null default now());
create table public.nadi_goals (id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.nadi_profiles(id), mentor_id uuid not null references public.nadi_profiles(id), title text not null check(length(title) between 1 and 160), description text not null check(length(description)<=2000), due_date date, status text not null default 'not-started' check(status in ('not-started','in-progress','student-complete')), version integer not null default 0, created_at timestamptz not null default now());
create table public.nadi_work_sessions (id uuid primary key, goal_id uuid not null references public.nadi_goals(id), learner_id uuid not null references public.nadi_profiles(id), started_at timestamptz not null, last_saved_at timestamptz, received_at timestamptz not null default now(), evidence text not null default 'client-observed' check(evidence='client-observed'));
create table public.nadi_checkpoints (id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.nadi_profiles(id), goal_id uuid not null references public.nadi_goals(id), snapshot jsonb not null, reflection text not null check(length(reflection)<=2000), reply_to_feedback_id uuid, created_at timestamptz not null default now());
create table public.nadi_feedback (id uuid primary key default gen_random_uuid(), checkpoint_id uuid not null references public.nadi_checkpoints(id), mentor_id uuid not null references public.nadi_profiles(id), message text not null check(length(message) between 1 and 4000), created_at timestamptz not null default now());
alter table public.nadi_checkpoints add constraint nadi_reply_feedback_fk foreign key(reply_to_feedback_id) references public.nadi_feedback(id);
create table public.nadi_help_requests (id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.nadi_profiles(id), goal_id uuid not null references public.nadi_goals(id), message text not null check(length(message) between 1 and 2000), created_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid references public.nadi_profiles(id));
create table public.nadi_progress_events (id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.nadi_profiles(id), goal_id uuid not null references public.nadi_goals(id), kind text not null check(kind in ('goal-started','goal-status','work-started','checkpoint-shared','revision-shared','feedback-posted','help-requested','help-resolved')), reference_id uuid not null, occurred_at timestamptz not null, received_at timestamptz not null default now(), evidence text not null check(evidence in ('client-observed','student-reported','server-recorded')));
create table public.nadi_submissions (actor_id uuid not null references public.nadi_profiles(id), submission_id uuid not null, kind text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(actor_id,submission_id));
create index on public.nadi_goals(learner_id);
create index on public.nadi_progress_events(learner_id,received_at);
create index on public.nadi_checkpoints(learner_id,created_at);

create function public.nadi_can_read(p_learner uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select auth.uid() = p_learner or exists(select 1 from public.nadi_assignments a where a.learner_id=p_learner and a.mentor_id=auth.uid()) $$;
revoke all on function public.nadi_can_read(uuid) from public,anon;
grant execute on function public.nadi_can_read(uuid) to authenticated;

alter table public.nadi_profiles enable row level security;
alter table public.nadi_assignments enable row level security;
alter table public.nadi_disclosures enable row level security;
alter table public.nadi_goals enable row level security;
alter table public.nadi_work_sessions enable row level security;
alter table public.nadi_checkpoints enable row level security;
alter table public.nadi_feedback enable row level security;
alter table public.nadi_help_requests enable row level security;
alter table public.nadi_progress_events enable row level security;
alter table public.nadi_submissions enable row level security;

create policy own_or_assigned_profile on public.nadi_profiles for select to authenticated using (id=auth.uid() or public.nadi_can_read(id) or exists(select 1 from public.nadi_assignments a where a.learner_id=auth.uid() and a.mentor_id=id));
create policy own_assignment on public.nadi_assignments for select to authenticated using (learner_id=auth.uid() or mentor_id=auth.uid());
create policy own_disclosure on public.nadi_disclosures for select to authenticated using(learner_id=auth.uid());
create policy assigned_goals on public.nadi_goals for select to authenticated using(public.nadi_can_read(learner_id));
create policy assigned_sessions on public.nadi_work_sessions for select to authenticated using(public.nadi_can_read(learner_id));
create policy assigned_checkpoints on public.nadi_checkpoints for select to authenticated using(public.nadi_can_read(learner_id));
create policy assigned_feedback on public.nadi_feedback for select to authenticated using(exists(select 1 from public.nadi_checkpoints c where c.id=checkpoint_id and public.nadi_can_read(c.learner_id)));
create policy assigned_help on public.nadi_help_requests for select to authenticated using(public.nadi_can_read(learner_id));
create policy assigned_progress on public.nadi_progress_events for select to authenticated using(public.nadi_can_read(learner_id));
create policy own_submissions on public.nadi_submissions for select to authenticated using(actor_id=auth.uid());

-- Explicitly remove write grants; all writes go through the validated atomic command function.
revoke all on public.nadi_profiles,public.nadi_assignments,public.nadi_disclosures,public.nadi_goals,public.nadi_work_sessions,public.nadi_checkpoints,public.nadi_feedback,public.nadi_help_requests,public.nadi_progress_events,public.nadi_submissions from anon,authenticated;
grant select on public.nadi_profiles,public.nadi_assignments,public.nadi_disclosures,public.nadi_goals,public.nadi_work_sessions,public.nadi_checkpoints,public.nadi_feedback,public.nadi_help_requests,public.nadi_progress_events,public.nadi_submissions to authenticated;

create function public.nadi_exact(p jsonb, keys text[], optional_keys text[] default '{}') returns boolean language plpgsql immutable set search_path=pg_catalog as $$ begin if jsonb_typeof(p) is distinct from 'object' then return false; end if; return p ?& keys and not exists(select 1 from jsonb_object_keys(p) k where not k=any(keys || optional_keys)); end $$;
create function public.nadi_number(p jsonb, low numeric, high numeric, whole boolean default false) returns boolean language plpgsql immutable set search_path=pg_catalog as $$ begin if jsonb_typeof(p) is distinct from 'number' then return false; end if; return coalesce(p::numeric between low and high and (not whole or trunc(p::numeric)=p::numeric),false); exception when others then return false; end $$;
-- JavaScript string limits count UTF-16 code units, not PostgreSQL code points.
create function public.nadi_utf16_length(s text) returns integer language plpgsql immutable strict set search_path=pg_catalog as $$
declare units integer:=0; i integer;
begin
  for i in 1..length(s) loop units:=units+case when ascii(substr(s,i,1))>65535 then 2 else 1 end; end loop;
  return units;
end $$;
create function public.nadi_label(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare s text; i integer; code integer;
begin
  if jsonb_typeof(p) is distinct from 'string' then return false; end if;
  s:=p#>>'{}';
  if public.nadi_utf16_length(s) not between 1 and 120 then return false; end if;
  for i in 1..length(s) loop code:=ascii(substr(s,i,1)); if code<32 or code=127 then return false; end if; end loop;
  return true;
end $$;
create function public.nadi_text(p jsonb, max_units integer, allow_empty boolean default false) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare s text; i integer; code integer; has_content boolean:=false;
begin
  if jsonb_typeof(p) is distinct from 'string' then return false; end if;
  s:=p#>>'{}';
  if public.nadi_utf16_length(s)>max_units then return false; end if;
  for i in 1..length(s) loop
    code:=ascii(substr(s,i,1));
    if code between 0 and 8 or code in (11,12) or code between 14 and 31 then return false; end if;
    -- ECMAScript String.trim white-space set, rather than locale-dependent SQL trim.
    if not (code between 9 and 13 or code in (32,160,5760,8232,8233,8239,8287,12288,65279) or code between 8192 and 8202) then has_content:=true; end if;
  end loop;
  return allow_empty or has_content;
end $$;
create function public.nadi_date(p jsonb, as_timestamp boolean default false) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare s text; parsed_date date; parsed_time timestamptz; normalized text; fractions text;
begin
  if jsonb_typeof(p) is distinct from 'string' then return false; end if;
  s:=p#>>'{}';
  if not as_timestamp then
    if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(s,4)='0000' then return false; end if;
    parsed_date:=s::date;
    return isfinite(parsed_date) and to_char(parsed_date,'YYYY-MM-DD')=s;
  end if;
  if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$' or left(s,4)='0000' then return false; end if;
  parsed_time:=s::timestamptz;
  if not isfinite(parsed_time) then return false; end if;
  fractions:=case when strpos(s,'.')=0 then '' else substring(s from 21 for length(s)-21) end;
  normalized:=left(s,19)||'.'||rpad(fractions,3,'0')||'Z';
  return to_char(parsed_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=normalized;
exception when others then return false;
end $$;

alter table public.nadi_profiles add constraint nadi_profile_text_valid check(public.nadi_label(to_jsonb(display_name)));
alter table public.nadi_goals add constraint nadi_goal_text_valid check(public.nadi_text(to_jsonb(title),160) and public.nadi_text(to_jsonb(description),2000,true));
alter table public.nadi_checkpoints add constraint nadi_reflection_text_valid check(public.nadi_text(to_jsonb(reflection),2000,true));
alter table public.nadi_feedback add constraint nadi_feedback_text_valid check(public.nadi_text(to_jsonb(message),4000));
alter table public.nadi_help_requests add constraint nadi_help_text_valid check(public.nadi_text(to_jsonb(message),2000));

-- Strict DB validator prevents direct RPC callers smuggling originals/private fields.
create function public.nadi_valid_checkpoint(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare t jsonb; pat jsonb; c jsonb; n jsonb; e jsonb; ticks integer; prev integer; stored integer:=0; expanded integer:=0; melodic integer:=0; track_ids text[]:='{}'; pattern_ids text[]:='{}'; note_ids text[]:='{}'; clip_ids text[]:='{}'; sounds text[]:=array['piano','kick','snare','hat','electric-piano','synth-bass','strings','soft-pad','plucked-guitar','french-horn','trumpet','oboe','ancient-reed','vocal-air','bronze-resonance','violin','viola','cello','double-bass','flute','clarinet','bassoon','trombone','tuba','harp','timpani'];
begin
  if p is null or jsonb_path_exists(p,'$.** ? (@ == null)') then return false; end if;
  if not public.nadi_exact(p,array['format','version','projectVersion','bpm','bars','tracks','patterns','clips']) or p->>'format'<>'nadi-checkpoint' or p->'version'<>'1'::jsonb or p->'projectVersion'<>'5'::jsonb or not public.nadi_number(p->'bpm',30,300) or not public.nadi_number(p->'bars',1,256,true) or octet_length(p::text)>4194304 then return false; end if;
  ticks:=(p->>'bars')::integer*1920;
  if jsonb_typeof(p->'tracks')<>'array' or jsonb_typeof(p->'patterns')<>'array' or jsonb_typeof(p->'clips')<>'array' or jsonb_array_length(p->'tracks')>16 or jsonb_array_length(p->'patterns')>10000 or jsonb_array_length(p->'clips')>10000 then return false; end if;
  for t in select value from jsonb_array_elements(p->'tracks') loop
    if not public.nadi_exact(t,array['id','name','color','soundId','soundVersion','level','muted','hidden','pan','space','spaceBypass','expression']) or not public.nadi_label(t->'id') or t->>'id'=any(track_ids) or not public.nadi_label(t->'name') or t->>'color' !~ '^#[0-9a-fA-F]{6}$' or not t->>'soundId'=any(sounds) or t->'soundVersion'<>'1'::jsonb or not public.nadi_number(t->'level',0,100,true) or jsonb_typeof(t->'muted')<>'boolean' or jsonb_typeof(t->'hidden')<>'boolean' or not public.nadi_number(t->'pan',-1,1) or not public.nadi_number(t->'space',0,1) or jsonb_typeof(t->'spaceBypass')<>'boolean' or jsonb_typeof(t->'expression')<>'array' or jsonb_array_length(t->'expression')>2048 then return false; end if;
    track_ids:=array_append(track_ids,t->>'id');
    if t->>'soundId' not in ('kick','snare','hat') then melodic:=melodic+1; end if;
    if melodic>15 then return false; end if;
    prev:=-1;
    for e in select value from jsonb_array_elements(t->'expression') loop
      if not public.nadi_exact(e,array['tick','value']) or not public.nadi_number(e->'tick',0,ticks,true) or not public.nadi_number(e->'value',0,1) or (e->>'tick')::integer<=prev then return false; end if;
      prev:=(e->>'tick')::integer;
    end loop;
  end loop;
  for pat in select value from jsonb_array_elements(p->'patterns') loop
    if not public.nadi_exact(pat,array['id','trackId','name','lengthTicks','notes']) or not public.nadi_label(pat->'id') or pat->>'id'=any(pattern_ids) or not public.nadi_label(pat->'trackId') or not pat->>'trackId'=any(track_ids) or not public.nadi_label(pat->'name') or not public.nadi_number(pat->'lengthTicks',1,ticks,true) or jsonb_typeof(pat->'notes')<>'array' then return false; end if;
    pattern_ids:=array_append(pattern_ids,pat->>'id'); stored:=stored+jsonb_array_length(pat->'notes');
    if stored>10000 then return false; end if;
    for n in select value from jsonb_array_elements(pat->'notes') loop
      if not public.nadi_exact(n,array['id','pitch','startTick','durationTicks','velocity']) or not public.nadi_label(n->'id') or n->>'id'=any(note_ids) or not public.nadi_number(n->'pitch',0,127,true) or not public.nadi_number(n->'startTick',0,(pat->>'lengthTicks')::integer-1,true) or not public.nadi_number(n->'durationTicks',1,ticks,true) or not public.nadi_number(n->'velocity',1,127,true) or (n->>'startTick')::integer+(n->>'durationTicks')::integer>ticks then return false; end if;
      note_ids:=array_append(note_ids,n->>'id');
    end loop;
  end loop;
  for c in select value from jsonb_array_elements(p->'clips') loop
    if not public.nadi_exact(c,array['id','trackId','patternId','startTick']) or not public.nadi_label(c->'id') or c->>'id'=any(clip_ids) or not public.nadi_label(c->'trackId') or not public.nadi_label(c->'patternId') or not c->>'trackId'=any(track_ids) or not c->>'patternId'=any(pattern_ids) or not public.nadi_number(c->'startTick',0,ticks-1,true) then return false; end if;
    select value into pat from jsonb_array_elements(p->'patterns') where value->>'id'=c->>'patternId';
    if pat->>'trackId'<>c->>'trackId' or (c->>'startTick')::integer+(pat->>'lengthTicks')::integer>ticks then return false; end if;
    expanded:=expanded+jsonb_array_length(pat->'notes'); if expanded>10000 then return false; end if;
    for n in select value from jsonb_array_elements(pat->'notes') loop
      if (c->>'startTick')::integer+(n->>'startTick')::integer+(n->>'durationTicks')::integer>ticks then return false; end if;
    end loop;
    clip_ids:=array_append(clip_ids,c->>'id');
  end loop;
  if exists(select 1 from jsonb_array_elements(p->'patterns') x where not exists(select 1 from jsonb_array_elements(p->'clips') y where y->>'patternId'=x->>'id')) or exists(select 1 from jsonb_array_elements(p->'tracks') x where not exists(select 1 from jsonb_array_elements(p->'patterns') y where y->>'trackId'=x->>'id')) then return false; end if;
  return true;
exception when others then return false;
end $$;
alter table public.nadi_checkpoints add constraint nadi_checkpoint_valid check(public.nadi_valid_checkpoint(snapshot));

create function public.nadi_learner_progress(p_learner_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.nadi_can_read(p_learner_id) then raise exception 'Denied' using errcode='42501'; end if;
  return jsonb_build_object('learnerId',p_learner_id,
    'goals',coalesce((select jsonb_agg(to_jsonb(g) order by created_at) from public.nadi_goals g where learner_id=p_learner_id),'[]'),
    'workSessions',coalesce((select jsonb_agg(to_jsonb(s) order by received_at) from public.nadi_work_sessions s where learner_id=p_learner_id),'[]'),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by received_at) from public.nadi_progress_events e where learner_id=p_learner_id),'[]'),
    'checkpoints',coalesce((select jsonb_agg(to_jsonb(c) order by created_at) from public.nadi_checkpoints c where learner_id=p_learner_id),'[]'),
    'feedback',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from public.nadi_feedback f join public.nadi_checkpoints c on c.id=f.checkpoint_id where c.learner_id=p_learner_id),'[]'),
    'helpRequests',coalesce((select jsonb_agg(to_jsonb(h) order by created_at) from public.nadi_help_requests h where learner_id=p_learner_id),'[]'));
end $$;

create function public.nadi_workspace() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare profile public.nadi_profiles; students jsonb;
begin
  select * into profile from public.nadi_profiles where id=auth.uid();
  if profile.id is null then raise exception 'Account not provisioned' using errcode='42501'; end if;
  if profile.role='student' then students:=jsonb_build_array(jsonb_build_object('profile',to_jsonb(profile),'progress',public.nadi_learner_progress(profile.id)));
  else select coalesce(jsonb_agg(jsonb_build_object('profile',to_jsonb(p),'progress',public.nadi_learner_progress(p.id))),'[]') into students from public.nadi_assignments a join public.nadi_profiles p on p.id=a.learner_id where a.mentor_id=profile.id; end if;
  return jsonb_build_object('profile',to_jsonb(profile),'disclosureAccepted',exists(select 1 from public.nadi_disclosures where learner_id=profile.id and version=1),'learners',students);
end $$;

create function public.nadi_command(p_kind text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); actor_role text; sid uuid; previous public.nadi_submissions; goal public.nadi_goals; cp public.nadi_checkpoints; help public.nadi_help_requests; ws public.nadi_work_sessions; result jsonb; rid uuid:=gen_random_uuid(); learner uuid; event_kind text; event_evidence text:='server-recorded'; occurred timestamptz:=now();
begin
  select role into actor_role from public.nadi_profiles where id=actor;
  if actor is null or actor_role is null then raise exception 'Denied' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('disclosure','goal-create','goal-status','work-session','checkpoint','feedback','help-create','help-resolve') then raise exception 'Unknown command' using errcode='22023'; end if;
  if p_kind='disclosure' then
    if actor_role<>'student' or not public.nadi_exact(p_payload,array['version']) or p_payload->'version' is distinct from '1'::jsonb then raise exception 'Invalid disclosure' using errcode='22023'; end if;
    insert into public.nadi_disclosures(learner_id,version) values(actor,1) on conflict(learner_id) do nothing;
    return jsonb_build_object('accepted',true,'version',1);
  end if;
  sid:=(p_payload->>'submissionId')::uuid;
  if sid is null then raise exception 'Submission ID required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||sid::text,0));
  select * into previous from public.nadi_submissions where actor_id=actor and submission_id=sid;
  if found then
    if previous.kind is distinct from p_kind or previous.payload is distinct from p_payload then raise exception 'Idempotency conflict' using errcode='23505'; end if;
    return previous.result;
  end if;
  if p_kind='goal-create' then
    if not public.nadi_exact(p_payload,array['submissionId','learnerId','title','description'],array['dueDate']) or not public.nadi_text(p_payload->'title',160) or not public.nadi_text(p_payload->'description',2000,true) or (p_payload ? 'dueDate' and p_payload->'dueDate'<>'null'::jsonb and not public.nadi_date(p_payload->'dueDate')) then raise exception 'Invalid goal' using errcode='22023'; end if;
    learner:=(p_payload->>'learnerId')::uuid;
    if actor_role<>'mentor' or not exists(select 1 from public.nadi_assignments where learner_id=learner and mentor_id=actor) then raise exception 'Denied' using errcode='42501'; end if;
    insert into public.nadi_goals(id,learner_id,mentor_id,title,description,due_date) values(rid,learner,actor,p_payload->>'title',p_payload->>'description',(p_payload->>'dueDate')::date);
    result:=jsonb_build_object('id',rid,'version',0);
  elsif p_kind='feedback' then
    if not public.nadi_exact(p_payload,array['submissionId','checkpointId','message']) or not public.nadi_text(p_payload->'message',4000) then raise exception 'Invalid feedback' using errcode='22023'; end if;
    select * into cp from public.nadi_checkpoints where id=(p_payload->>'checkpointId')::uuid;
    if actor_role<>'mentor' or cp.id is null or not exists(select 1 from public.nadi_assignments where learner_id=cp.learner_id and mentor_id=actor) then raise exception 'Denied' using errcode='42501'; end if;
    insert into public.nadi_feedback(id,checkpoint_id,mentor_id,message) values(rid,cp.id,actor,p_payload->>'message');
    learner:=cp.learner_id; goal.id:=cp.goal_id; event_kind:='feedback-posted'; result:=jsonb_build_object('id',rid);
  elsif p_kind='help-resolve' then
    if not public.nadi_exact(p_payload,array['submissionId','requestId']) then raise exception 'Invalid resolution' using errcode='22023'; end if;
    select * into help from public.nadi_help_requests where id=(p_payload->>'requestId')::uuid for update;
    if actor_role<>'mentor' or help.id is null or not exists(select 1 from public.nadi_assignments where learner_id=help.learner_id and mentor_id=actor) then raise exception 'Denied' using errcode='42501'; end if;
    if help.resolved_at is null then update public.nadi_help_requests set resolved_at=now(),resolved_by=actor where id=help.id; event_kind:='help-resolved'; end if;
    learner:=help.learner_id; goal.id:=help.goal_id; rid:=help.id; result:=jsonb_build_object('id',rid,'resolved',true);
  else
    if actor_role<>'student' or not exists(select 1 from public.nadi_disclosures where learner_id=actor and version=1) then raise exception 'Disclosure required' using errcode='42501'; end if;
    select * into goal from public.nadi_goals where id=(p_payload->>'goalId')::uuid and learner_id=actor for update;
    if goal.id is null then raise exception 'Denied' using errcode='42501'; end if;
    learner:=actor;
    case p_kind
    when 'goal-status' then
      if not public.nadi_exact(p_payload,array['submissionId','goalId','expectedVersion','status']) or not public.nadi_number(p_payload->'expectedVersion',0,2147483647,true) or coalesce(p_payload->>'status','') not in ('not-started','in-progress','student-complete') then raise exception 'Invalid status' using errcode='22023'; end if;
      if goal.version<>(p_payload->>'expectedVersion')::integer then raise exception 'Version conflict' using errcode='40001'; end if;
      if goal.status<>p_payload->>'status' then
        update public.nadi_goals set status=p_payload->>'status',version=version+1 where id=goal.id returning version into goal.version;
        event_kind:=case when p_payload->>'status'='in-progress' then 'goal-started' else 'goal-status' end; event_evidence:='student-reported';
      end if;
      rid:=goal.id; result:=jsonb_build_object('id',rid,'version',goal.version,'status',p_payload->>'status');
    when 'work-session' then
      if not public.nadi_exact(p_payload,array['submissionId','sessionId','goalId','kind','occurredAt']) or coalesce(p_payload->>'kind','') not in ('started','saved') or not public.nadi_date(p_payload->'occurredAt',true) then raise exception 'Invalid work session' using errcode='22023'; end if;
      rid:=(p_payload->>'sessionId')::uuid; occurred:=(p_payload->>'occurredAt')::timestamptz;
      if occurred is null or not isfinite(occurred) then raise exception 'Invalid timestamp' using errcode='22023'; end if;
      select * into ws from public.nadi_work_sessions where id=rid for update;
      if ws.id is not null and (ws.goal_id<>goal.id or ws.learner_id<>actor) then raise exception 'Session conflict' using errcode='23505'; end if;
      if ws.id is null then
        if p_payload->>'kind'<>'started' then raise exception 'Start event required' using errcode='22023'; end if;
        insert into public.nadi_work_sessions(id,goal_id,learner_id,started_at) values(rid,goal.id,actor,occurred); event_kind:='work-started'; event_evidence:='client-observed';
      elsif p_payload->>'kind'='saved' then update public.nadi_work_sessions set last_saved_at=greatest(last_saved_at,occurred),received_at=now() where id=rid;
      end if;
      result:=jsonb_build_object('id',rid,'accepted',true);
    when 'checkpoint' then
      if not public.nadi_exact(p_payload,array['submissionId','goalId','reflection','checkpoint'],array['replyToFeedbackId']) or not public.nadi_text(p_payload->'reflection',2000,true) or not public.nadi_valid_checkpoint(p_payload->'checkpoint') then raise exception 'Invalid checkpoint' using errcode='22023'; end if;
      if p_payload->>'replyToFeedbackId' is not null and not exists(select 1 from public.nadi_feedback f join public.nadi_checkpoints c on c.id=f.checkpoint_id where f.id=(p_payload->>'replyToFeedbackId')::uuid and c.learner_id=actor and c.goal_id=goal.id) then raise exception 'Feedback unavailable' using errcode='42501'; end if;
      insert into public.nadi_checkpoints(id,learner_id,goal_id,snapshot,reflection,reply_to_feedback_id) values(rid,actor,goal.id,p_payload->'checkpoint',p_payload->>'reflection',(p_payload->>'replyToFeedbackId')::uuid);
      event_kind:=case when p_payload->>'replyToFeedbackId' is null then 'checkpoint-shared' else 'revision-shared' end; result:=jsonb_build_object('id',rid,'shared',true);
    when 'help-create' then
      if not public.nadi_exact(p_payload,array['submissionId','goalId','message']) or not public.nadi_text(p_payload->'message',2000) then raise exception 'Invalid request' using errcode='22023'; end if;
      insert into public.nadi_help_requests(id,learner_id,goal_id,message) values(rid,actor,goal.id,p_payload->>'message'); event_kind:='help-requested'; event_evidence:='student-reported'; result:=jsonb_build_object('id',rid);
    else raise exception 'Unknown command' using errcode='22023';
    end case;
  end if;
  if event_kind is not null then insert into public.nadi_progress_events(learner_id,goal_id,kind,reference_id,occurred_at,evidence) values(learner,goal.id,event_kind,rid,occurred,event_evidence); end if;
  insert into public.nadi_submissions(actor_id,submission_id,kind,payload,result) values(actor,sid,p_kind,p_payload,result);
  return result;
end $$;

revoke all on function public.nadi_exact(jsonb,text[],text[]), public.nadi_number(jsonb,numeric,numeric,boolean), public.nadi_utf16_length(text), public.nadi_text(jsonb,integer,boolean), public.nadi_date(jsonb,boolean), public.nadi_label(jsonb), public.nadi_valid_checkpoint(jsonb), public.nadi_learner_progress(uuid), public.nadi_workspace(), public.nadi_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.nadi_learner_progress(uuid),public.nadi_workspace(),public.nadi_command(text,jsonb) to authenticated;
