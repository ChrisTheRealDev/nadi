-- v010 additive mentor connection. Apply inside BEGIN/COMMIT; retain all prior APIs.
create table public.nadi_questions(id uuid primary key default gen_random_uuid(),learner_id uuid not null references public.nadi_profiles(id),goal_id uuid references public.nadi_goals(id),project_id text,snapshot_id uuid references public.nadi_revisions(id),message text not null check(public.nadi_text(to_jsonb(message),4000)),created_at timestamptz not null default now(),foreign key(learner_id,project_id) references public.nadi_projects(learner_id,project_id));
create table public.nadi_question_replies(id uuid primary key default gen_random_uuid(),question_id uuid not null references public.nadi_questions(id),author_id uuid not null references public.nadi_profiles(id),message text not null check(public.nadi_text(to_jsonb(message),4000)),created_at timestamptz not null default now());
create table public.nadi_checkpoint_replies(id uuid primary key default gen_random_uuid(),checkpoint_id uuid not null references public.nadi_checkpoints(id),author_id uuid not null references public.nadi_profiles(id),message text not null check(public.nadi_text(to_jsonb(message),4000)),created_at timestamptz not null default now());
create table public.nadi_feedback_reads(actor_id uuid not null references public.nadi_profiles(id),item_id text not null check(length(item_id) between 1 and 100),read_at timestamptz not null default now(),primary key(actor_id,item_id));
create table public.nadi_goal_steps(id uuid primary key default gen_random_uuid(),goal_id uuid not null references public.nadi_goals(id),label text not null check(public.nadi_text(to_jsonb(label),300)),done boolean not null default false,position integer not null check(position>=0),version integer not null default 0 check(version>=0));
alter table public.nadi_goals add column project_id text;
alter table public.nadi_goals add constraint nadi_goal_project_fk foreign key(learner_id,project_id) references public.nadi_projects(learner_id,project_id);
create table public.nadi_goal_reviews(id uuid primary key default gen_random_uuid(),goal_id uuid not null references public.nadi_goals(id),snapshot_id uuid not null references public.nadi_revisions(id),reflection text not null check(public.nadi_text(to_jsonb(reflection),2000,true)),status text not null default 'awaiting-review' check(status in ('awaiting-review','changes-requested','reviewed')),version integer not null default 0 check(version>=0),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.nadi_connection_mutations(actor_id uuid not null references public.nadi_profiles(id),mutation_id text not null check(length(mutation_id) between 1 and 160),channel text not null,kind text not null,payload jsonb not null,result jsonb not null,primary key(actor_id,mutation_id));
create index on public.nadi_questions(learner_id,created_at);
create index on public.nadi_question_replies(question_id,created_at);
create index on public.nadi_checkpoint_replies(checkpoint_id,created_at);
create index on public.nadi_goal_steps(goal_id,position);
create index on public.nadi_goal_reviews(goal_id,created_at desc);
alter table public.nadi_questions enable row level security;
alter table public.nadi_question_replies enable row level security;
alter table public.nadi_checkpoint_replies enable row level security;
alter table public.nadi_feedback_reads enable row level security;
alter table public.nadi_goal_steps enable row level security;
alter table public.nadi_goal_reviews enable row level security;
alter table public.nadi_connection_mutations enable row level security;
revoke all on public.nadi_questions,public.nadi_question_replies,public.nadi_checkpoint_replies,public.nadi_feedback_reads,public.nadi_goal_steps,public.nadi_goal_reviews,public.nadi_connection_mutations from public,anon,authenticated;
-- Legacy question ids are preserved so repeat inserts cannot duplicate a conversation.
insert into public.nadi_questions(id,learner_id,goal_id,message,created_at) select id,learner_id,goal_id,message,created_at from public.nadi_help_requests;
create function public.nadi_mirror_help_question() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 insert into public.nadi_questions(id,learner_id,goal_id,message,created_at) values(new.id,new.learner_id,new.goal_id,new.message,new.created_at) on conflict(id) do nothing; return new;
end $$;
revoke all on function public.nadi_mirror_help_question() from public,anon,authenticated;
create trigger nadi_help_question_inbox after insert on public.nadi_help_requests for each row execute function public.nadi_mirror_help_question();
create function public.nadi_feedback_items(p_learner_id uuid default null) returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 with events as (
 select 'comment:'||t.id as id,'comment:'||t.id as thread_id,r.learner_id,t.author_id,'comment'::text as kind,t.message,t.created_at,r.project_id,r.id as snapshot_id,null::uuid as goal_id,null::uuid as checkpoint_id,t.anchor
 from public.nadi_review_threads t join public.nadi_revisions r on r.id=t.snapshot_id
 union all select 'reply:'||a.id,'comment:'||t.id,r.learner_id,a.author_id,'reply',a.message,a.created_at,r.project_id,coalesce(a.revision_id,r.id),null::uuid,null::uuid,t.anchor from public.nadi_review_replies a join public.nadi_review_threads t on t.id=a.thread_id join public.nadi_revisions r on r.id=t.snapshot_id
 union all select 'feedback:'||f.id,'checkpoint:'||c.id,c.learner_id,f.mentor_id,'checkpoint-feedback',f.message,f.created_at,null::text,null::uuid,c.goal_id,c.id,'{}'::jsonb from public.nadi_feedback f join public.nadi_checkpoints c on c.id=f.checkpoint_id
 union all select 'checkpoint-revision:'||c.id,'checkpoint:'||o.id,c.learner_id,c.learner_id,'reply',c.reflection,c.created_at,null::text,null::uuid,c.goal_id,c.id,'{}'::jsonb from public.nadi_checkpoints c join public.nadi_feedback f on f.id=c.reply_to_feedback_id join public.nadi_checkpoints o on o.id=f.checkpoint_id
 union all select 'checkpoint-reply:'||a.id,'checkpoint:'||c.id,c.learner_id,a.author_id,'reply',a.message,a.created_at,null::text,null::uuid,c.goal_id,c.id,'{}'::jsonb from public.nadi_checkpoint_replies a join public.nadi_checkpoints c on c.id=a.checkpoint_id
 union all select 'question:'||q.id,'question:'||q.id,q.learner_id,q.learner_id,'question',q.message,q.created_at,q.project_id,q.snapshot_id,q.goal_id,null::uuid,'{}'::jsonb from public.nadi_questions q
 union all select 'question-reply:'||a.id,'question:'||q.id,q.learner_id,a.author_id,'question-reply',a.message,a.created_at,q.project_id,q.snapshot_id,q.goal_id,null::uuid,'{}'::jsonb from public.nadi_question_replies a join public.nadi_questions q on q.id=a.question_id
 )
 select jsonb_build_object('id',e.id,'threadId',e.thread_id,'learnerId',e.learner_id,'authorId',e.author_id,'authorName',p.display_name,'kind',e.kind,'message',e.message,'preview',left(e.message,180),'createdAt',e.created_at,'readAt',case when e.author_id=auth.uid() then e.created_at else seen.read_at end,'projectId',e.project_id,'snapshotId',e.snapshot_id,'goalId',e.goal_id,'checkpointId',e.checkpoint_id,'anchor',e.anchor)
 from events e join public.nadi_profiles p on p.id=e.author_id left join public.nadi_feedback_reads seen on seen.actor_id=auth.uid() and seen.item_id=e.id
 where public.nadi_can_read(e.learner_id) and (p_learner_id is null or e.learner_id=p_learner_id)
$$;
revoke all on function public.nadi_feedback_items(uuid) from public,anon,authenticated;
create function public.nadi_feedback_read(p_learner_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$ begin
 if auth.uid() is null or not exists(select 1 from public.nadi_profiles where id=auth.uid()) or (p_learner_id is not null and not public.nadi_can_read(p_learner_id)) then raise exception 'Denied' using errcode='42501'; end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(value order by value->>'createdAt',value->>'id') from public.nadi_feedback_items(p_learner_id) value),'[]'::jsonb));
end $$;
create function public.nadi_planner_read(p_learner_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$ begin
 if auth.uid() is null or not exists(select 1 from public.nadi_profiles where id=auth.uid()) or p_learner_id is null or not coalesce(public.nadi_can_read(p_learner_id),false) then raise exception 'Denied' using errcode='42501'; end if;
 return jsonb_build_object('goals',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('steps',coalesce((select jsonb_agg(to_jsonb(s) order by s.position,s.id) from public.nadi_goal_steps s where s.goal_id=g.id),'[]'::jsonb),'reviews',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('revision',r.revision) order by v.created_at desc,v.id) from public.nadi_goal_reviews v join public.nadi_revisions r on r.id=v.snapshot_id where v.goal_id=g.id),'[]'::jsonb),'review',(select to_jsonb(v)||jsonb_build_object('revision',r.revision) from public.nadi_goal_reviews v join public.nadi_revisions r on r.id=v.snapshot_id where v.goal_id=g.id order by v.created_at desc,v.id limit 1)) order by g.due_date nulls last,g.created_at desc) from public.nadi_goals g where g.learner_id=p_learner_id),'[]'::jsonb),'projects',coalesce((select jsonb_agg(jsonb_build_object('projectId',p.project_id,'name',p.name,'revision',p.revision,'updatedAt',p.updated_at,'snapshotId',(select r.id from public.nadi_revisions r where r.learner_id=p.learner_id and r.project_id=p.project_id and r.revision=p.revision)) order by p.updated_at desc) from public.nadi_projects p where p.learner_id=p_learner_id),'[]'::jsonb));
end $$;
create function public.nadi_connection_command(p_channel text,p_kind text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); actor_role text; prior public.nadi_connection_mutations; result jsonb; mutation text; g public.nadi_goals; st public.nadi_goal_steps; rev public.nadi_goal_reviews; snap public.nadi_revisions; q public.nadi_questions; cp public.nadi_checkpoints; new_id uuid; target_goal uuid; expected integer; item jsonb; item_ids text[]; existing_ids text[]; step_ids uuid[]; all_steps uuid[]; pos integer; new_version integer;
begin
 select role into actor_role from public.nadi_profiles where id=actor;
 if actor is null or actor_role is null then raise exception 'Denied' using errcode='42501'; end if;
 if actor_role='student' and not (p_channel='feedback' and p_kind='read') and not exists(select 1 from public.nadi_disclosures where learner_id=actor and version=1) then raise exception 'Disclosure required' using errcode='42501'; end if;
 if not coalesce(jsonb_typeof(p_payload)='object' and public.nadi_text(p_payload->'mutationId',160),false) then raise exception 'Invalid mutation' using errcode='22023'; end if;
 mutation:=p_payload->>'mutationId'; perform pg_advisory_xact_lock(hashtextextended(actor::text||':connection:'||mutation,0));
 select * into prior from public.nadi_connection_mutations where actor_id=actor and mutation_id=mutation;
 if found then
  if prior.channel is distinct from p_channel or prior.kind is distinct from p_kind or prior.payload is distinct from p_payload then raise exception 'Changed replay' using errcode='40001'; end if; return prior.result;
 end if;
 if p_channel='feedback' then
  if p_kind='read' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','itemIds']) and jsonb_typeof(p_payload->'itemIds')='array' and jsonb_array_length(p_payload->'itemIds') between 1 and 200,false) then raise exception 'Invalid read receipt' using errcode='22023'; end if;
   for item in select value from jsonb_array_elements(p_payload->'itemIds') loop if not public.nadi_text(item,100) then raise exception 'Invalid item' using errcode='22023'; end if; end loop;
   select array_agg(value) into item_ids from jsonb_array_elements_text(p_payload->'itemIds');
   if cardinality(item_ids)<>(select count(distinct v) from unnest(item_ids) v) then raise exception 'Duplicate receipt' using errcode='22023'; end if;
   select array_agg(value->>'id') into existing_ids from public.nadi_feedback_items(null) value where value->>'id'=any(item_ids);
   if not coalesce(item_ids <@ existing_ids,false) then raise exception 'Denied' using errcode='42501'; end if;
   insert into public.nadi_feedback_reads(actor_id,item_id) select actor,v from unnest(item_ids) v on conflict do nothing;
   result:=jsonb_build_object('read',cardinality(item_ids));
  elsif p_kind='question' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','message'],array['goalId','projectId']) and public.nadi_text(p_payload->'message',4000),false) then raise exception 'Invalid question' using errcode='22023'; end if;
   if actor_role<>'student' or not exists(select 1 from public.nadi_assignments where learner_id=actor) then raise exception 'Denied' using errcode='42501'; end if;
   if p_payload->>'goalId' is not null and not exists(select 1 from public.nadi_goals where id=(p_payload->>'goalId')::uuid and learner_id=actor) then raise exception 'Denied' using errcode='42501'; end if;
   if p_payload->>'projectId' is not null and (not public.nadi_label(p_payload->'projectId') or not exists(select 1 from public.nadi_projects where learner_id=actor and project_id=p_payload->>'projectId')) then raise exception 'Denied' using errcode='42501'; end if;
   insert into public.nadi_questions(learner_id,goal_id,project_id,snapshot_id,message) values(actor,(p_payload->>'goalId')::uuid,p_payload->>'projectId',(select id from public.nadi_revisions where learner_id=actor and project_id=p_payload->>'projectId' order by revision desc limit 1),p_payload->>'message') returning id into new_id; result:=jsonb_build_object('id',new_id);
  elsif p_kind='question-reply' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','questionId','message']) and public.nadi_text(p_payload->'message',4000),false) then raise exception 'Invalid reply' using errcode='22023'; end if;
   select * into q from public.nadi_questions where id=(p_payload->>'questionId')::uuid;
   if q.id is null or not public.nadi_can_read(q.learner_id) then raise exception 'Denied' using errcode='42501'; end if;
   insert into public.nadi_question_replies(question_id,author_id,message) values(q.id,actor,p_payload->>'message') returning id into new_id; result:=jsonb_build_object('id',new_id);
  elsif p_kind='checkpoint-reply' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','checkpointId','message']) and public.nadi_text(p_payload->'message',4000),false) then raise exception 'Invalid reply' using errcode='22023'; end if;
   select * into cp from public.nadi_checkpoints where id=(p_payload->>'checkpointId')::uuid;
   if cp.id is null or not public.nadi_can_read(cp.learner_id) then raise exception 'Denied' using errcode='42501'; end if;
   insert into public.nadi_checkpoint_replies(checkpoint_id,author_id,message) values(cp.id,actor,p_payload->>'message') returning id into new_id; result:=jsonb_build_object('id',new_id);
  else raise exception 'Unknown command' using errcode='22023'; end if;
 elsif p_channel='planner' then
  if not coalesce(public.nadi_number(p_payload->'expectedVersion',0,2147483646,true),false) then raise exception 'Version required' using errcode='22023'; end if; expected:=(p_payload->>'expectedVersion')::integer;
  if p_kind in ('step-edit','step-toggle') then select goal_id into target_goal from public.nadi_goal_steps where id=(p_payload->>'stepId')::uuid;
  elsif p_kind='review-status' then select goal_id into target_goal from public.nadi_goal_reviews where id=(p_payload->>'reviewId')::uuid;
  else target_goal:=(p_payload->>'goalId')::uuid; end if;
  -- Uniform parent-first lock order avoids reorder/toggle deadlocks.
  select * into g from public.nadi_goals where id=target_goal for update;
  if g.id is null or not public.nadi_can_read(g.learner_id) then raise exception 'Denied' using errcode='42501'; end if;
  if p_kind in ('goal-edit','review-status') then
   if actor_role<>'mentor' or not exists(select 1 from public.nadi_assignments where learner_id=g.learner_id and mentor_id=actor) then raise exception 'Only assigned tutor' using errcode='42501'; end if;
  elsif actor_role<>'student' or g.learner_id<>actor then raise exception 'Only learner' using errcode='42501'; end if;
  if p_kind not in ('step-edit','step-toggle','review-status') and g.version<>expected then raise exception 'Goal changed' using errcode='40001'; end if;
  if p_kind='goal-edit' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','goalId','expectedVersion','title','description','dueDate']) and public.nadi_text(p_payload->'title',160) and public.nadi_text(p_payload->'description',2000,true) and (p_payload->'dueDate'='null'::jsonb or public.nadi_date(p_payload->'dueDate')),false) then raise exception 'Invalid assignment' using errcode='22023'; end if;
   update public.nadi_goals set title=p_payload->>'title',description=p_payload->>'description',due_date=(p_payload->>'dueDate')::date,version=version+1 where id=g.id returning version into new_version; result:=jsonb_build_object('id',g.id,'version',new_version);
  elsif p_kind='step-add' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','goalId','expectedVersion','label']) and public.nadi_text(p_payload->'label',300),false) or (select count(*) from public.nadi_goal_steps where goal_id=g.id)>=100 then raise exception 'Invalid step' using errcode='22023'; end if;
   select coalesce(max(position),-1)+1 into pos from public.nadi_goal_steps where goal_id=g.id;
   insert into public.nadi_goal_steps(goal_id,label,position) values(g.id,p_payload->>'label',pos) returning id into new_id;
   update public.nadi_goals set version=version+1 where id=g.id returning version into new_version; result:=jsonb_build_object('id',new_id,'version',new_version);
  elsif p_kind in ('step-edit','step-toggle') then
   select * into st from public.nadi_goal_steps where id=(p_payload->>'stepId')::uuid for update;
   if st.version<>expected then raise exception 'Step changed' using errcode='40001'; end if;
   if p_kind='step-edit' then
    if not coalesce(public.nadi_exact(p_payload,array['mutationId','stepId','expectedVersion','label']) and public.nadi_text(p_payload->'label',300),false) then raise exception 'Invalid step' using errcode='22023'; end if;
    update public.nadi_goal_steps set label=p_payload->>'label',version=version+1 where id=st.id returning version into new_version;
   else
    if not coalesce(public.nadi_exact(p_payload,array['mutationId','stepId','expectedVersion','done']) and jsonb_typeof(p_payload->'done')='boolean',false) then raise exception 'Invalid step' using errcode='22023'; end if;
    update public.nadi_goal_steps set done=(p_payload->>'done')::boolean,version=version+1 where id=st.id returning version into new_version;
   end if; result:=jsonb_build_object('id',st.id,'version',new_version);
  elsif p_kind='step-reorder' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','goalId','expectedVersion','stepIds']) and jsonb_typeof(p_payload->'stepIds')='array' and jsonb_array_length(p_payload->'stepIds')<=100,false) then raise exception 'Invalid order' using errcode='22023'; end if;
   select coalesce(array_agg(value::uuid),'{}') into step_ids from jsonb_array_elements_text(p_payload->'stepIds'); select coalesce(array_agg(id),'{}') into all_steps from public.nadi_goal_steps where goal_id=g.id;
   if not(step_ids @> all_steps and step_ids <@ all_steps) or cardinality(step_ids)<>cardinality(all_steps) then raise exception 'Order must contain every step once' using errcode='22023'; end if;
   update public.nadi_goal_steps s set position=ord.n-1 from unnest(step_ids) with ordinality ord(id,n) where s.id=ord.id;
   update public.nadi_goals set version=version+1 where id=g.id returning version into new_version; result:=jsonb_build_object('id',g.id,'version',new_version);
  elsif p_kind='project-link' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','goalId','expectedVersion','projectId']) and (p_payload->'projectId'='null'::jsonb or public.nadi_label(p_payload->'projectId')),false) then raise exception 'Invalid project' using errcode='22023'; end if;
   if p_payload->>'projectId' is not null and not exists(select 1 from public.nadi_projects where learner_id=g.learner_id and project_id=p_payload->>'projectId') then raise exception 'Denied' using errcode='42501'; end if;
   update public.nadi_goals set project_id=p_payload->>'projectId',version=version+1 where id=g.id returning version into new_version; result:=jsonb_build_object('id',g.id,'version',new_version);
  elsif p_kind='review-submit' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','goalId','expectedVersion','snapshotId','reflection']) and public.nadi_text(p_payload->'reflection',2000,true),false) then raise exception 'Invalid review' using errcode='22023'; end if;
   select * into snap from public.nadi_revisions where id=(p_payload->>'snapshotId')::uuid;
   if snap.id is null or snap.learner_id<>g.learner_id or snap.project_id is distinct from g.project_id then raise exception 'Choose confirmed linked composition' using errcode='22023'; end if;
   insert into public.nadi_goal_reviews(goal_id,snapshot_id,reflection) values(g.id,snap.id,p_payload->>'reflection') returning id into new_id;
   update public.nadi_goals set version=version+1 where id=g.id returning version into new_version; result:=jsonb_build_object('id',new_id,'version',new_version,'snapshotId',snap.id,'revision',snap.revision);
  elsif p_kind='review-status' then
   if not coalesce(public.nadi_exact(p_payload,array['mutationId','reviewId','expectedVersion','status']) and p_payload->>'status' in ('changes-requested','reviewed'),false) then raise exception 'Invalid review state' using errcode='22023'; end if;
   select * into rev from public.nadi_goal_reviews where id=(p_payload->>'reviewId')::uuid for update;
   if rev.version<>expected then raise exception 'Review changed' using errcode='40001'; end if;
   update public.nadi_goal_reviews set status=p_payload->>'status',version=version+1,updated_at=now() where id=rev.id returning version into new_version; result:=jsonb_build_object('id',rev.id,'version',new_version);
  else raise exception 'Unknown command' using errcode='22023'; end if;
 else raise exception 'Unknown channel' using errcode='22023'; end if;
 insert into public.nadi_connection_mutations(actor_id,mutation_id,channel,kind,payload,result) values(actor,mutation,p_channel,p_kind,p_payload,result); return result;
end $$;
revoke all on function public.nadi_feedback_read(uuid),public.nadi_planner_read(uuid),public.nadi_connection_command(text,text,jsonb) from public,anon;
grant execute on function public.nadi_feedback_read(uuid),public.nadi_planner_read(uuid),public.nadi_connection_command(text,text,jsonb) to authenticated;
