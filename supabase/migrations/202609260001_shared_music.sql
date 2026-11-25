create function public.nadi_valid_music_graph(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
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
  return true;
exception when others then return false;
end $$;

-- Full manifests are checked in PostgreSQL too; direct RPC callers cannot bypass Node validation.
create function public.nadi_valid_music_manifest(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare graph jsonb; i jsonb; o jsonb; e jsonb; v jsonb; k text; ids text[]:='{}'; note_ids text[]:='{}'; track_ids text[]:='{}'; rest_ids text[]:='{}'; last_order bigint; audio_total integer:=0; event_total integer:=0; ticks integer;
begin
 if not coalesce(public.nadi_exact(p,array['format','version','id','revision','name','bpm','bars','tracks','patterns','clips','ideas','guidance'],case when p->>'version'='6' then array['notation'] else '{}'::text[] end) and p->>'format'='nadi-creation' and p->'version' in ('5'::jsonb,'6'::jsonb) and public.nadi_label(p->'id') and public.nadi_label(p->'name') and public.nadi_number(p->'revision',0,2147483647,true),false) or octet_length(p::text)>4194304 then return false; end if;
 graph:=jsonb_build_object('format','nadi-checkpoint','version',1,'projectVersion',5,'bpm',p->'bpm','bars',p->'bars','tracks',p->'tracks','patterns',p->'patterns','clips',p->'clips');
 if not public.nadi_valid_music_graph(graph) then return false; end if;
 ticks:=(p->>'bars')::integer*1920;
 if not coalesce(public.nadi_exact(p->'guidance',array['open','step','experience']) and jsonb_typeof(p->'guidance'->'open')='boolean' and public.nadi_number(p->'guidance'->'step',0,10000,true) and p->'guidance'->>'experience' in ('new','player','producer') and jsonb_typeof(p->'ideas')='array' and jsonb_array_length(p->'ideas')<=100,false) then return false; end if;
 for i in select value from jsonb_array_elements(p->'ideas') loop
  if not coalesce(public.nadi_exact(i,array['id','name','createdAt','attachedTick','original']) and public.nadi_label(i->'id') and not(i->>'id'=any(ids)) and public.nadi_label(i->'name') and public.nadi_date(i->'createdAt',true) and (i->'attachedTick'='null'::jsonb or public.nadi_number(i->'attachedTick',0,ticks,true)),false) then return false; end if;
  ids:=array_append(ids,i->>'id'); o:=i->'original';
  if o->>'kind'='text' then
   if not coalesce(public.nadi_exact(o,array['kind','text']) and jsonb_typeof(o->'text')='string' and public.nadi_utf16_length(o->>'text') between 1 and 12000,false) then return false; end if;
  elsif o->>'kind'='audio' then
   if not coalesce(public.nadi_exact(o,array['kind','mimeType','byteLength','assetHash','durationMs']) and length(o->>'mimeType')<=120 and o->>'mimeType' ~* '^audio/(webm|ogg|mp4|wav)(;[[:space:]]*codecs=("[A-Za-z0-9., -]+"|[A-Za-z0-9.,-]+))?$' and public.nadi_number(o->'byteLength',1,1048576,true) and o->>'assetHash' ~ '^[0-9a-f]{64}$' and public.nadi_number(o->'durationMs',0,60000),false) then return false; end if;
   audio_total:=audio_total+(o->>'byteLength')::integer; if audio_total>2097152 then return false; end if;
  elsif o->>'kind'='midi' then
   if not coalesce(public.nadi_exact(o,array['kind','durationMs','events']) and public.nadi_number(o->'durationMs',0,60000) and jsonb_typeof(o->'events')='array',false) then return false; end if;
   event_total:=event_total+jsonb_array_length(o->'events'); if event_total>10000 then return false; end if;
   last_order:=-1;
   for e in select value from jsonb_array_elements(o->'events') loop
    if not coalesce(public.nadi_number(e->'atMs',0,(o->>'durationMs')::numeric) and public.nadi_number(e->'order',0,9007199254740991,true) and (e->>'order')::bigint>last_order and public.nadi_number(e->'channel',0,15,true) and e->>'source' in ('midi','screen'),false) then return false; end if;
    last_order:=(e->>'order')::bigint;
    if e->>'type' in ('note-on','note-off') then
     if not coalesce(public.nadi_exact(e,array['type','atMs','order','channel','source','pitch','velocity']) and public.nadi_number(e->'pitch',0,127,true) and public.nadi_number(e->'velocity',case when e->>'type'='note-on' then 1 else 0 end,127,true),false) then return false; end if;
    elsif e->>'type'='controller' then
     if not coalesce(public.nadi_exact(e,array['type','atMs','order','channel','source','controller','value']) and public.nadi_number(e->'controller',0,127,true) and public.nadi_number(e->'value',0,127,true),false) then return false; end if;
    elsif e->>'type'='pitch-bend' then
     if not coalesce(public.nadi_exact(e,array['type','atMs','order','channel','source','value']) and public.nadi_number(e->'value',0,16383,true),false) then return false; end if;
    else return false; end if;
   end loop;
  else return false; end if;
 end loop;
 if octet_length(p::text)+4*ceil(audio_total::numeric/3)>4194304 then return false; end if;
 if p->>'version'='6' then
  o:=p->'notation';
  if not coalesce(public.nadi_exact(o,array['measures','notes','tracks','rests']) and jsonb_typeof(o->'measures')='array' and jsonb_array_length(o->'measures')<=8192 and jsonb_typeof(o->'notes')='object' and jsonb_typeof(o->'tracks')='object' and jsonb_typeof(o->'rests')='array' and jsonb_array_length(o->'rests')<=20000,false) then return false; end if;
  select coalesce(array_agg(value->>'id'),'{}') into track_ids from jsonb_array_elements(p->'tracks');
  select coalesce(array_agg(n.value->>'id'),'{}') into note_ids from jsonb_array_elements(p->'patterns') pat cross join lateral jsonb_array_elements(pat->'notes') n;
  for v in select value from jsonb_array_elements(o->'measures') loop
   if not coalesce(public.nadi_exact(v,array['beats','beatType','keyFifths','newSystem','newPage']) and public.nadi_number(v->'beats',1,16,true) and v->'beatType' in ('2'::jsonb,'4'::jsonb,'8'::jsonb,'16'::jsonb) and public.nadi_number(v->'keyFifths',-7,7,true) and jsonb_typeof(v->'newSystem')='boolean' and jsonb_typeof(v->'newPage')='boolean',false) then return false; end if;
  end loop;
  for k,v in select key,value from jsonb_each(o->'notes') loop
   if not coalesce(k=any(note_ids) and public.nadi_exact(v,array['voice','staff','dynamic','articulation','slur','tuplet']) and public.nadi_number(v->'voice',1,8,true) and v->'staff' in ('0'::jsonb,'1'::jsonb,'2'::jsonb) and v->>'dynamic' in ('none','pp','p','mp','mf','f','ff') and v->>'articulation' in ('none','staccato','tenuto','accent') and v->>'slur' in ('none','start','stop') and v->'tuplet' in ('1'::jsonb,'3'::jsonb,'5'::jsonb),false) then return false; end if;
  end loop;
  for k,v in select key,value from jsonb_each(o->'tracks') loop
   if not coalesce(k=any(track_ids) and public.nadi_exact(v,array['clef','staffSplit','performerMode']) and v->>'clef' in ('auto','treble','bass','alto','tenor') and public.nadi_number(v->'staffSplit',0,127,true) and v->>'performerMode' in ('default','solo','ensemble','electronic'),false) then return false; end if;
  end loop;
  for v in select value from jsonb_array_elements(o->'rests') loop
   if not coalesce(public.nadi_exact(v,array['id','trackId','startTick','durationTicks','voice']) and public.nadi_label(v->'id') and not(v->>'id'=any(rest_ids)) and v->>'trackId'=any(track_ids) and public.nadi_number(v->'startTick',0,ticks-1,true) and public.nadi_number(v->'durationTicks',1,ticks,true) and (v->>'startTick')::integer+(v->>'durationTicks')::integer<=ticks and public.nadi_number(v->'voice',1,8,true),false) then return false; end if;
   rest_ids:=array_append(rest_ids,v->>'id');
  end loop;
 end if;
 return true;
exception when others then return false;
end $$;
revoke all on function public.nadi_valid_music_graph(jsonb),public.nadi_valid_music_manifest(jsonb) from public,anon;

-- Explicitly enrolled music workspace. Apply after tracking v1 using the owner migration workflow.
create table public.nadi_music_enrollments (learner_id uuid primary key references public.nadi_profiles(id), accepted_at timestamptz not null default now(), version integer not null default 2 check(version=2));
create table public.nadi_projects (learner_id uuid not null references public.nadi_profiles(id), project_id text not null check(length(project_id) between 1 and 120), name text not null, revision integer not null default 0, updated_at timestamptz not null default now(), primary key(learner_id,project_id));
create table public.nadi_revisions (id uuid primary key default gen_random_uuid(), learner_id uuid not null, project_id text not null, revision integer not null, manifest jsonb not null, saved_at timestamptz not null, received_at timestamptz not null default now(), foreign key(learner_id,project_id) references public.nadi_projects, unique(learner_id,project_id,revision));
alter table public.nadi_revisions add constraint nadi_complete_manifest_valid check(public.nadi_valid_music_manifest(manifest));
create table public.nadi_exchanges (learner_id uuid not null references public.nadi_profiles(id), request_id text not null, project_id text not null, prompt text not null, response text not null, status text not null check(status in ('pending','complete','failed')), source text not null, project_revision integer not null, created_at timestamptz not null, received_at timestamptz not null default now(), primary key(learner_id,request_id));
create table public.nadi_review_threads (id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.nadi_revisions(id), author_id uuid not null references public.nadi_profiles(id), anchor jsonb not null default '{}', message text not null check(length(message) between 1 and 4000), created_at timestamptz not null default now(), resolved_at timestamptz);
create table public.nadi_review_replies (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.nadi_review_threads(id), author_id uuid not null references public.nadi_profiles(id), message text not null check(length(message) between 1 and 4000), revision_id uuid references public.nadi_revisions(id), created_at timestamptz not null default now());
create table public.nadi_music_mutations (actor_id uuid not null references public.nadi_profiles(id), mutation_id text not null, kind text not null, payload jsonb not null, result jsonb not null, primary key(actor_id,mutation_id));
create index on public.nadi_revisions(learner_id,project_id,revision desc);
create index on public.nadi_exchanges(learner_id,project_id);
alter table public.nadi_music_enrollments enable row level security;
alter table public.nadi_projects enable row level security;
alter table public.nadi_revisions enable row level security;
alter table public.nadi_exchanges enable row level security;
alter table public.nadi_review_threads enable row level security;
alter table public.nadi_review_replies enable row level security;
alter table public.nadi_music_mutations enable row level security;
revoke all on public.nadi_music_enrollments,public.nadi_projects,public.nadi_revisions,public.nadi_exchanges,public.nadi_review_threads,public.nadi_review_replies,public.nadi_music_mutations from anon,authenticated;
-- Access is exclusively through functions with assignment checks, including detail reads.
create function public.nadi_shared_read(p_learner_id uuid,p_project_id text default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not public.nadi_can_read(p_learner_id) then raise exception 'Denied' using errcode='42501'; end if;
 return jsonb_build_object('projects',coalesce((select jsonb_agg(to_jsonb(p) order by updated_at desc) from public.nadi_projects p where learner_id=p_learner_id),'[]'),
 'revisions',case when p_project_id is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(r) order by revision desc) from public.nadi_revisions r where learner_id=p_learner_id and project_id=p_project_id),'[]') end,
 'exchanges',case when p_project_id is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(e) order by created_at) from public.nadi_exchanges e where learner_id=p_learner_id and project_id=p_project_id),'[]') end,
 'threads',case when p_project_id is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('replies',coalesce((select jsonb_agg(to_jsonb(a) order by created_at) from public.nadi_review_replies a where a.thread_id=t.id),'[]')) order by t.created_at) from public.nadi_review_threads t join public.nadi_revisions r on r.id=t.snapshot_id where r.learner_id=p_learner_id and r.project_id=p_project_id),'[]') end);
end $$;

create function public.nadi_music_command(p_kind text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); actor_role text; prior public.nadi_music_mutations; result jsonb; head public.nadi_projects; snap public.nadi_revisions; thread public.nadi_review_threads; item jsonb; new_id uuid; mutation text:=p_payload->>'mutationId';
begin
 select role into actor_role from public.nadi_profiles where id=actor;
 if actor is null or actor_role is null then raise exception 'Denied' using errcode='42501'; end if;
 if mutation is null or length(mutation) not between 1 and 160 or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid mutation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || mutation,0));
 select * into prior from public.nadi_music_mutations where actor_id=actor and mutation_id=mutation;
 if found then
  if prior.kind is distinct from p_kind or prior.payload is distinct from p_payload then raise exception 'Changed replay' using errcode='40001'; end if;
  return prior.result;
 end if;
 if p_kind='enroll' then
  if actor_role<>'student' or not exists(select 1 from public.nadi_assignments where learner_id=actor) or p_payload->>'version'<>'2' then raise exception 'Denied' using errcode='42501'; end if;
  insert into public.nadi_music_enrollments(learner_id) values(actor) on conflict do nothing;
  result:=jsonb_build_object('accepted',true);
 elsif p_kind in ('revision','exchange') then
  if actor_role<>'student' or not exists(select 1 from public.nadi_music_enrollments where learner_id=actor) then raise exception 'Enrollment required' using errcode='42501'; end if;
  if not public.nadi_label(p_payload->'projectId') then raise exception 'Invalid project' using errcode='22023'; end if;
  if p_kind='revision' then
   item:=p_payload->'manifest';
   if jsonb_typeof(item)<>'object' or item->>'format'<>'nadi-creation' or item->>'version' not in ('5','6') or item->>'id'<>p_payload->>'projectId' or not public.nadi_label(item->'name') or jsonb_typeof(item->'patterns')<>'array' or jsonb_typeof(item->'tracks')<>'array' or jsonb_typeof(item->'ideas')<>'array' or not public.nadi_number(p_payload->'expectedRevision',0,2147483646,true) then raise exception 'Invalid composition' using errcode='22023'; end if;
   for item in select value from jsonb_array_elements(p_payload->'manifest'->'ideas') loop
    if item->'original'->>'kind'='audio' and (item->'original' ? 'base64' or coalesce(item->'original'->>'assetHash','') !~ '^[0-9a-f]{64}$' or not exists(select 1 from storage.objects where bucket_id='nadi-captures' and name=actor::text || '/' || (item->'original'->>'assetHash'))) then raise exception 'Capture missing' using errcode='22023'; end if;
   end loop;
   insert into public.nadi_projects(learner_id,project_id,name) values(actor,p_payload->>'projectId',p_payload->'manifest'->>'name') on conflict do nothing;
   select * into head from public.nadi_projects where learner_id=actor and project_id=p_payload->>'projectId' for update;
   if head.revision<>(p_payload->>'expectedRevision')::integer then raise exception 'Revision conflict' using errcode='40001'; end if;
   insert into public.nadi_revisions(learner_id,project_id,revision,manifest,saved_at) values(actor,head.project_id,head.revision+1,p_payload->'manifest',(p_payload->>'savedAt')::timestamptz) returning id into new_id;
   update public.nadi_projects set revision=head.revision+1,name=p_payload->'manifest'->>'name',updated_at=now() where learner_id=actor and project_id=head.project_id;
   result:=jsonb_build_object('revision',head.revision+1,'snapshotId',new_id);
  else
   perform pg_advisory_xact_lock(hashtextextended(actor::text || ':exchange:' || (p_payload->>'requestId'),0));
   if not public.nadi_text(p_payload->'prompt',20000) or not public.nadi_text(p_payload->'response',40000,true) or p_payload->>'status' not in ('pending','complete','failed') or not public.nadi_label(p_payload->'requestId') or not public.nadi_label(p_payload->'source') or not public.nadi_number(p_payload->'revision',0,2147483647,true) then raise exception 'Invalid exchange' using errcode='22023'; end if;
   if exists(select 1 from public.nadi_exchanges where learner_id=actor and request_id=p_payload->>'requestId' and (prompt<>p_payload->>'prompt' or project_id<>p_payload->>'projectId' or status<>'pending')) then raise exception 'Exchange already completed' using errcode='40001'; end if;
   insert into public.nadi_exchanges(learner_id,request_id,project_id,prompt,response,status,source,project_revision,created_at) values(actor,p_payload->>'requestId',p_payload->>'projectId',p_payload->>'prompt',p_payload->>'response',p_payload->>'status',p_payload->>'source',(p_payload->>'revision')::integer,(p_payload->>'createdAt')::timestamptz)
   on conflict(learner_id,request_id) do update set response=excluded.response,status=excluded.status,source=excluded.source,received_at=now();
   result:=jsonb_build_object('saved',true);
   update public.nadi_projects set updated_at=clock_timestamp() where learner_id=actor and project_id=p_payload->>'projectId';
  end if;
 elsif p_kind='comment' then
  select * into snap from public.nadi_revisions where id=(p_payload->>'snapshotId')::uuid;
  if actor_role<>'mentor' or snap.id is null or not public.nadi_can_read(snap.learner_id) then raise exception 'Denied' using errcode='42501'; end if;
  if not public.nadi_text(p_payload->'message',4000) or jsonb_typeof(p_payload->'anchor')<>'object' or octet_length((p_payload->'anchor')::text)>4000 then raise exception 'Invalid comment' using errcode='22023'; end if;
  insert into public.nadi_review_threads(snapshot_id,author_id,anchor,message) values(snap.id,actor,p_payload->'anchor',p_payload->>'message') returning id into new_id;
  result:=jsonb_build_object('threadId',new_id);
  update public.nadi_projects set updated_at=clock_timestamp() where learner_id=snap.learner_id and project_id=snap.project_id;
 elsif p_kind in ('reply','resolve') then
  select * into thread from public.nadi_review_threads where id=(p_payload->>'threadId')::uuid for update;
  select * into snap from public.nadi_revisions where id=thread.snapshot_id;
  if snap.id is null or not public.nadi_can_read(snap.learner_id) then raise exception 'Denied' using errcode='42501'; end if;
  if p_kind='resolve' then
   if actor_role<>'mentor' then raise exception 'Only tutor resolves' using errcode='42501'; end if;
   update public.nadi_review_threads set resolved_at=now() where id=thread.id;
  else
   if not public.nadi_text(p_payload->'message',4000) then raise exception 'Invalid reply' using errcode='22023'; end if;
   if p_payload->>'revisionId' is not null and not exists(select 1 from public.nadi_revisions r where r.id=(p_payload->>'revisionId')::uuid and r.learner_id=snap.learner_id and r.project_id=snap.project_id) then raise exception 'Invalid linked revision' using errcode='22023'; end if;
   insert into public.nadi_review_replies(thread_id,author_id,message,revision_id) values(thread.id,actor,p_payload->>'message',(p_payload->>'revisionId')::uuid);
  end if;
  result:=jsonb_build_object('saved',true);
  update public.nadi_projects set updated_at=clock_timestamp() where learner_id=snap.learner_id and project_id=snap.project_id;
 else raise exception 'Unknown command' using errcode='22023'; end if;
 insert into public.nadi_music_mutations values(actor,mutation,p_kind,p_payload,result);
 return result;
end $$;
revoke all on function public.nadi_shared_read(uuid,text),public.nadi_music_command(text,jsonb) from public,anon;
grant execute on function public.nadi_shared_read(uuid,text),public.nadi_music_command(text,jsonb) to authenticated;

-- Preserve existing goal workflow while adding separately explicit music enrollment.
alter function public.nadi_workspace() rename to nadi_workspace_v1;
revoke all on function public.nadi_workspace_v1() from public,anon,authenticated;
create function public.nadi_workspace() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select public.nadi_workspace_v1() || jsonb_build_object('musicSharingAccepted',exists(select 1 from public.nadi_music_enrollments where learner_id=auth.uid())) $$;
revoke all on function public.nadi_workspace() from public,anon;
grant execute on function public.nadi_workspace() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit) values('nadi-captures','nadi-captures',false,20971520) on conflict(id) do nothing;
create policy nadi_capture_read on storage.objects for select to authenticated using(bucket_id='nadi-captures' and public.nadi_can_read((storage.foldername(name))[1]::uuid));
create policy nadi_capture_create on storage.objects for insert to authenticated with check(bucket_id='nadi-captures' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.nadi_music_enrollments where learner_id=auth.uid()));
-- No update/delete policy: referenced original captures are immutable.
grant select on public.nadi_music_enrollments to authenticated;
create policy own_music_enrollment on public.nadi_music_enrollments for select to authenticated using(learner_id=auth.uid());
