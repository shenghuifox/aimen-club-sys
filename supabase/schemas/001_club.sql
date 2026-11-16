-- Initial declarative schema. Apply once to a NEW project / schema.
-- All application tables are private, RLS default-deny. The only client API
-- is two explicitly granted RPC wrappers. Every operation validates auth.uid()
-- and authoritative database roles, never user-editable JWT user_metadata.
begin;
create schema club_private;
revoke all on schema club_private from public, anon;
grant usage on schema club_private to authenticated, service_role;
create table club_private.users (
 id uuid primary key references auth.users(id), username text not null unique,
 name text not null, roles text[] not null check(cardinality(roles)>0 and roles <@ array['admin','stu','clubtr','hrtr']::text[]), active boolean not null default true
);
create table club_private.terms (
 id uuid primary key default gen_random_uuid(), name text not null unique,
 start_date date not null, end_date date not null, status text not null default 'active' check(status in ('active','archived')), check(end_date>=start_date)
);
create table club_private.students (
 id uuid primary key default gen_random_uuid(), term_id uuid not null references club_private.terms,
 user_id uuid references club_private.users, name text not null, class_name text not null, number text not null,
 homeroom_id uuid references club_private.users, unique(term_id,user_id), unique(term_id,class_name,number)
);
create table club_private.clubs (
 id uuid primary key default gen_random_uuid(), term_id uuid not null references club_private.terms,
 name text not null, plan_name text not null, description text not null default '', kind text not null check(kind in ('社團','課後班')),
 teacher_id uuid not null references club_private.users, location text not null, capacity integer not null check(capacity>0), rate numeric(10,2) not null check(rate>=0),
 funding_source text not null default '', registration_start date not null, registration_end date not null,
 status text not null default 'draft' check(status in ('draft','published')), color text not null default '#7bb8ac', check(registration_end>=registration_start)
);
create table club_private.sessions (
 id uuid primary key default gen_random_uuid(), club_id uuid not null references club_private.clubs,
 teacher_id uuid not null references club_private.users, starts_at timestamptz not null, ends_at timestamptz not null,
 units numeric(5,2) not null check(units>0), rate numeric(10,2) not null check(rate>=0), summary text not null default '',
 status text not null default 'scheduled' check(status in ('scheduled','completed','cancelled')),
 signed_at timestamptz, attendance_confirmed_at timestamptz, check(ends_at>starts_at)
);
create table club_private.enrollments (
 id uuid primary key default gen_random_uuid(), club_id uuid not null references club_private.clubs,
 student_id uuid not null references club_private.students,
 status text not null check(status in ('pending','enrolled','rejected','withdrawn')), start_date date not null, end_date date, check(end_date is null or end_date>=start_date)
);
create unique index enrollment_open_unique on club_private.enrollments(club_id,student_id) where status in ('pending','enrolled') and end_date is null;
create table club_private.leaves (
 id uuid primary key default gen_random_uuid(), session_id uuid not null references club_private.sessions,
 student_id uuid not null references club_private.students, kind text not null check(kind in ('公假','事假','病假')), reason text not null check(length(trim(reason))>0),
 status text not null check(status in ('pending','approved','rejected')), created_by uuid not null references club_private.users,
 reviewed_by uuid references club_private.users, created_at timestamptz not null default now(), reviewed_at timestamptz
);
create unique index leave_open_unique on club_private.leaves(session_id,student_id) where status<>'rejected';
create table club_private.attendance (
 session_id uuid not null references club_private.sessions, student_id uuid not null references club_private.students,
 status text not null check(status in ('present','absent','late','leave')), primary key(session_id,student_id)
);
create table club_private.changes (
 id uuid primary key default gen_random_uuid(), club_id uuid not null references club_private.clubs,
 kind text not null check(kind in ('add_student','remove_student','reschedule','weekly')), reason text not null check(length(trim(reason))>0),
 student_id uuid references club_private.students, effective_date date, session_id uuid references club_private.sessions,
 starts_at timestamptz, ends_at timestamptz, teacher_id uuid references club_private.users, units numeric(5,2), rate numeric(10,2), original_dates jsonb not null default '[]',
 status text not null check(status in ('pending','approved','rejected')), created_by uuid not null references club_private.users,
 created_at timestamptz not null default now(), reviewed_by uuid references club_private.users
);
create table club_private.settlements (
 id uuid primary key default gen_random_uuid(), club_id uuid not null references club_private.clubs,
 start_date date not null, end_date date not null, snapshot jsonb not null,
 status text not null default 'locked' check(status='locked'), paper_done boolean not null default false,
 created_by uuid not null references club_private.users, created_at timestamptz not null default now(), check(end_date>=start_date)
);
create table club_private.audit (
 id uuid primary key default gen_random_uuid(), action text not null, created_by uuid not null references club_private.users, created_at timestamptz not null default now()
);
-- Index every foreign-key access path used by authorization / schedules.
create index students_term on club_private.students(term_id);
create index students_user on club_private.students(user_id);
create index students_homeroom on club_private.students(homeroom_id);
create index clubs_term on club_private.clubs(term_id);
create index clubs_teacher on club_private.clubs(teacher_id);
create index sessions_club_date on club_private.sessions(club_id,starts_at);
create index sessions_teacher_date on club_private.sessions(teacher_id,starts_at);
create index enrollments_student on club_private.enrollments(student_id);
create index leaves_student on club_private.leaves(student_id);
create index leaves_created on club_private.leaves(created_by);
create index leaves_reviewed on club_private.leaves(reviewed_by);
create index attendance_student on club_private.attendance(student_id);
create index changes_club on club_private.changes(club_id);
create index changes_student on club_private.changes(student_id);
create index changes_session on club_private.changes(session_id);
create index changes_teacher on club_private.changes(teacher_id);
create index changes_created on club_private.changes(created_by);
create index changes_reviewed on club_private.changes(reviewed_by);
create index settlements_club_period on club_private.settlements(club_id,start_date,end_date);
create index settlements_created on club_private.settlements(created_by);
create index audit_created on club_private.audit(created_by);
do $$ declare t text; begin
 foreach t in array array['users','terms','students','clubs','sessions','enrollments','leaves','attendance','changes','settlements','audit'] loop
  execute format('alter table club_private.%I enable row level security',t);
  execute format('revoke all on club_private.%I from public, anon, authenticated',t);
 end loop;
end $$;

create function club_private.actor() returns club_private.users language plpgsql stable security definer set search_path='' as $$
declare u club_private.users; begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 select * into u from club_private.users where id=auth.uid() and active;
 if u.id is null then raise exception '帳號尚未獲授權'; end if; return u;
end $$;
create function club_private.can_student(s club_private.students, u club_private.users) returns boolean language sql stable set search_path='' as $$
 select coalesce('admin'=any(u.roles) or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or ('clubtr'=any(u.roles) and exists(
 select 1 from club_private.enrollments e join club_private.clubs c on c.id=e.club_id where e.student_id=s.id and c.teacher_id=u.id and e.status='enrolled')),false)
$$;
create function club_private.assert_open(cid uuid, d date default null) returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from club_private.clubs c join club_private.terms t on t.id=c.term_id where c.id=cid and t.status='active') then raise exception '學期已封存或社團不存在'; end if;
 if d is not null and exists(select 1 from club_private.settlements b where b.club_id=cid and d between b.start_date and b.end_date) then raise exception '該期間已核銷鎖定'; end if;
end $$;
create function club_private.check_session(s club_private.sessions) returns void language plpgsql set search_path='' as $$
declare term club_private.terms; begin
 select t.* into term from club_private.terms t join club_private.clubs c on c.term_id=t.id where c.id=s.club_id;
 if s.starts_at is null or s.ends_at is null or s.ends_at<=s.starts_at or s.units is null or s.units<=0 or s.rate is null or s.rate<0 then raise exception '時間、節數或費率不正確'; end if;
 if (s.starts_at at time zone 'Asia/Taipei')::date<term.start_date or (s.ends_at at time zone 'Asia/Taipei')::date>term.end_date then raise exception '上課日期超出學期'; end if;
 if not exists(select 1 from club_private.users where id=s.teacher_id and active and roles&&array['clubtr','hrtr','admin']::text[]) then raise exception '授課教師無效'; end if;
 if exists(select 1 from club_private.sessions x where x.id<>s.id and x.status<>'cancelled' and (x.teacher_id=s.teacher_id or x.club_id=s.club_id) and x.starts_at<s.ends_at and x.ends_at>s.starts_at) then raise exception '教師或社團上課時間衝突'; end if;
 if exists(select 1 from club_private.enrollments e join club_private.enrollments other on other.student_id=e.student_id and other.club_id<>e.club_id join club_private.sessions x on x.club_id=other.club_id where e.club_id=s.club_id and e.status='enrolled' and other.status='enrolled' and (s.starts_at at time zone 'Asia/Taipei')::date between e.start_date and coalesce(e.end_date,'infinity') and (s.starts_at at time zone 'Asia/Taipei')::date between other.start_date and coalesce(other.end_date,'infinity') and x.status<>'cancelled' and x.starts_at<s.ends_at and x.ends_at>s.starts_at) then raise exception '學生課程時間衝突'; end if;
end $$;
create function club_private.admit_check(cid uuid, sid uuid, effective date, excluded uuid default null) returns void language plpgsql set search_path='' as $$
declare c club_private.clubs; begin
 select * into c from club_private.clubs where id=cid;
 if not exists(select 1 from club_private.students where id=sid and term_id=c.term_id) then raise exception '學生與社團學期不符'; end if;
 if (select count(*) from club_private.enrollments where club_id=cid and status='enrolled' and id is distinct from excluded and start_date<=effective and (end_date is null or end_date>=effective))>=c.capacity then raise exception '社團名額已滿'; end if;
 if exists(select 1 from club_private.sessions a join club_private.sessions b on b.starts_at<a.ends_at and b.ends_at>a.starts_at join club_private.enrollments e on e.club_id=b.club_id where a.club_id=cid and b.club_id<>cid and e.student_id=sid and e.status='enrolled' and a.status<>'cancelled' and b.status<>'cancelled' and (a.starts_at at time zone 'Asia/Taipei')::date>=effective and (a.starts_at at time zone 'Asia/Taipei')::date between e.start_date and coalesce(e.end_date,'infinity')) then raise exception '學生已有同時段課程'; end if;
end $$;
create function club_private.apply_change(change_id uuid) returns void language plpgsql set search_path='' as $$
declare c club_private.changes; e club_private.enrollments; original club_private.sessions; s club_private.sessions; n club_private.sessions; dates jsonb='[]'; begin
 select * into c from club_private.changes where id=change_id;
 perform club_private.assert_open(c.club_id,c.effective_date);
 if c.kind in ('add_student','remove_student') then
  if c.student_id is null or c.effective_date is null then raise exception '請指定學生與生效日期'; end if;
  if exists(select 1 from club_private.settlements where club_id=c.club_id and end_date>=c.effective_date) then raise exception '異動會影響已鎖定名冊'; end if;
  if c.kind='add_student' then
   if exists(select 1 from club_private.enrollments where club_id=c.club_id and student_id=c.student_id and status in ('enrolled','pending') and (end_date is null or end_date>=c.effective_date)) then raise exception '已有參加或報名紀錄'; end if;
   perform club_private.admit_check(c.club_id,c.student_id,c.effective_date);
   insert into club_private.enrollments(club_id,student_id,status,start_date) values(c.club_id,c.student_id,'enrolled',c.effective_date);
  else
   select * into e from club_private.enrollments where club_id=c.club_id and student_id=c.student_id and status='enrolled' and start_date<c.effective_date and (end_date is null or end_date>=c.effective_date) order by start_date desc limit 1;
   if e.id is null then raise exception '找不到有效參加紀錄或退出日不正確'; end if;
   update club_private.enrollments set end_date=c.effective_date-1 where id=e.id;
  end if;
 else
  select * into original from club_private.sessions where id=c.session_id and club_id=c.club_id;
  if original.id is null or c.starts_at is null or c.ends_at is null or c.units is null or c.units<=0 then raise exception '請指定原課程、新時間與節數'; end if;
  for s in select * from club_private.sessions where club_id=c.club_id and (id=c.session_id or (c.kind='weekly' and starts_at>=original.starts_at and status='scheduled')) order by starts_at loop
   perform club_private.assert_open(c.club_id,(s.starts_at at time zone 'Asia/Taipei')::date);
   if s.status<>'scheduled' or s.signed_at is not null then raise exception '已授課或已簽到課程不可直接異動'; end if;
   n=s;
   n.starts_at=case when c.kind='weekly' then s.starts_at+(c.starts_at-original.starts_at) else c.starts_at end;
   n.ends_at=n.starts_at+(c.ends_at-c.starts_at); n.units=c.units; n.teacher_id=coalesce(c.teacher_id,s.teacher_id); n.rate=coalesce(c.rate,s.rate);
   perform club_private.assert_open(c.club_id,(n.starts_at at time zone 'Asia/Taipei')::date); perform club_private.check_session(n);
   dates=dates||jsonb_build_array(s.starts_at);
   update club_private.sessions set starts_at=n.starts_at,ends_at=n.ends_at,teacher_id=n.teacher_id,rate=n.rate,units=n.units where id=s.id;
  end loop;
 end if;
 update club_private.changes set original_dates=dates,status='approved',reviewed_by=auth.uid() where id=c.id;
end $$;

create function club_private.snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u club_private.users=club_private.actor(); a boolean; result jsonb; begin
 a='admin'=any(u.roles);
 select jsonb_build_object(
 'users',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'username',x.username,'name',x.name,'roles',x.roles)),'[]') from club_private.users x where x.active and (a or x.id=u.id or x.roles&&array['admin','clubtr','hrtr']::text[])),
 'terms',(select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc),'[]') from club_private.terms x),
 'clubs',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from club_private.clubs x where a or x.status='published' or x.teacher_id=u.id),
 'students',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from club_private.students s where club_private.can_student(s,u)),
 'sessions',(select coalesce(jsonb_agg(to_jsonb(s) order by s.starts_at),'[]') from club_private.sessions s join club_private.clubs c on c.id=s.club_id where a or c.status='published' or s.teacher_id=u.id or c.teacher_id=u.id),
 'enrollments',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from club_private.enrollments e join club_private.students s on s.id=e.student_id where club_private.can_student(s,u) and (a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or exists(select 1 from club_private.clubs where id=e.club_id and teacher_id=u.id and 'clubtr'=any(u.roles)))),
 'leaves',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from club_private.leaves l join club_private.students s on s.id=l.student_id join club_private.sessions se on se.id=l.session_id where a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])),
 'attendance',(select coalesce(jsonb_agg(to_jsonb(at)),'[]') from club_private.attendance at join club_private.students s on s.id=at.student_id join club_private.sessions se on se.id=at.session_id where a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])),
 'changes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from club_private.changes x where a or x.created_by=u.id or (x.status='approved' and x.kind not in ('add_student','remove_student'))),
 'settlements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from club_private.settlements x where a),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from club_private.audit where a order by created_at desc limit 100) x)
 ) into result; return result;
end $$;

create function club_private.act(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u club_private.users=club_private.actor(); a boolean; c club_private.clubs; s club_private.students; se club_private.sessions; l club_private.leaves; e club_private.enrollments; target club_private.users; ch club_private.changes;
 cid uuid=nullif(payload->>'club_id','')::uuid; sid uuid=nullif(payload->>'student_id','')::uuid; seid uuid=nullif(payload->>'session_id','')::uuid; rid uuid=nullif(payload->>'id','')::uuid;
 d date=(now() at time zone 'Asia/Taipei')::date; first_day date; last_day date; reviewed boolean; out_id uuid; rows jsonb; teachers jsonb; snap jsonb; total numeric; units numeric; mark text; v_roles text[];
begin
 a='admin'=any(u.roles);
 -- Serialize first-release mutations, including enrollment capacity, approvals,
 -- role count and settlement locks. No network calls occur in this transaction.
 perform pg_advisory_xact_lock(148975,1);
 if action in ('admit','save_club','publish_club','add_session','review_change','settle','paper_done','roles','add_term','archive_term','add_student') and not a then raise exception '僅行政管理者可操作'; end if;
 select * into c from club_private.clubs where id=cid;
 select * into s from club_private.students where id=sid;
 select * into se from club_private.sessions where id=seid;
 if action='leave' then
  if s.id is null or se.id is null or not club_private.can_student(s,u) then raise exception '沒有學生或課程的操作權限'; end if;
  if not a and s.user_id is distinct from u.id and not coalesce((s.homeroom_id=u.id and 'hrtr'=any(u.roles)),false) and not exists(select 1 from club_private.clubs where id=se.club_id and teacher_id=u.id and 'clubtr'=any(u.roles)) then raise exception '沒有該社團的請假權限'; end if;
  perform club_private.assert_open(se.club_id);
  if not exists(select 1 from club_private.enrollments where club_id=se.club_id and student_id=s.id and status='enrolled' and (se.starts_at at time zone 'Asia/Taipei')::date between start_date and coalesce(end_date,'infinity')) then raise exception '學生未參加該次課程'; end if;
  reviewed=a or coalesce((s.homeroom_id=u.id and 'hrtr'=any(u.roles)),false);
  insert into club_private.leaves(session_id,student_id,kind,reason,status,created_by,reviewed_by,reviewed_at) values(se.id,s.id,payload->>'kind',payload->>'reason',case when reviewed then 'approved' else 'pending' end,u.id,case when reviewed then u.id end,case when reviewed then now() end) returning id into out_id;
 elsif action='review_leave' then
  select * into l from club_private.leaves where id=rid; select * into s from club_private.students where id=l.student_id;
  if l.id is null or not coalesce((a or (s.homeroom_id=u.id and 'hrtr'=any(u.roles))),false) then raise exception '沒有覆核權限'; end if;
  if l.status<>'pending' or coalesce(payload->>'status','') not in ('approved','rejected') then raise exception '申請已處理或狀態不正確'; end if;
  perform club_private.assert_open((select club_id from club_private.sessions where id=l.session_id));
  update club_private.leaves set status=payload->>'status',reviewed_by=u.id,reviewed_at=now() where id=l.id;
 elsif action='enroll' then
  if c.id is null or s.id is null or not(a or (s.user_id=u.id and 'stu'=any(u.roles))) or s.term_id<>c.term_id then raise exception '沒有報名權限'; end if;
  perform club_private.assert_open(c.id);
  if not a and (c.status<>'published' or d not between c.registration_start and c.registration_end) then raise exception '目前不在報名期間'; end if;
  insert into club_private.enrollments(club_id,student_id,status,start_date) values(c.id,s.id,'pending',d) returning id into out_id;
 elsif action='admit' then
  select * into e from club_private.enrollments where id=rid;
  if e.id is null or e.status<>'pending' or coalesce(payload->>'status','') not in ('enrolled','rejected') then raise exception '報名不存在或已處理'; end if;
  first_day=coalesce(nullif(payload->>'start_date','')::date,d); perform club_private.assert_open(e.club_id,first_day);
  if exists(select 1 from club_private.settlements where club_id=e.club_id and end_date>=first_day) then raise exception '錄取會影響已鎖定期間'; end if;
  if payload->>'status'='enrolled' then perform club_private.admit_check(e.club_id,e.student_id,first_day,e.id); end if;
  update club_private.enrollments set status=payload->>'status',start_date=first_day where id=e.id;
 elsif action in ('sign_in','attendance') then
  if se.id is null or not(a or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])) then raise exception '沒有授課權限'; end if;
  perform club_private.assert_open(se.club_id,(se.starts_at at time zone 'Asia/Taipei')::date);
  if se.status='cancelled' then raise exception '課程已停課'; end if;
  if action='sign_in' then
   if (se.starts_at at time zone 'Asia/Taipei')::date<>d then raise exception '僅能於上課當日線上簽到'; end if;
   update club_private.sessions set signed_at=coalesce(signed_at,now()) where id=se.id;
  else
   if se.signed_at is null or se.starts_at>now() or coalesce(trim(payload->>'summary'),'')='' then raise exception '請先完成簽到並填寫摘要，且課程必須已開始'; end if;
   for s in select st.* from club_private.students st where exists(select 1 from club_private.enrollments en where en.student_id=st.id and en.club_id=se.club_id and en.status='enrolled' and (se.starts_at at time zone 'Asia/Taipei')::date between en.start_date and coalesce(en.end_date,'infinity')) loop
    mark=payload->'marks'->>s.id::text;
    if exists(select 1 from club_private.leaves where student_id=s.id and session_id=se.id and status='approved') then mark='leave'; elsif coalesce(mark,'') not in ('present','absent','late') then raise exception '請完成每位學生點名，請假需先覆核'; end if;
    insert into club_private.attendance(session_id,student_id,status) values(se.id,s.id,mark) on conflict(session_id,student_id) do update set status=excluded.status;
   end loop;
   update club_private.sessions set summary=payload->>'summary',attendance_confirmed_at=now(),status='completed' where id=se.id;
  end if;
 elsif action='save_club' then
  if not exists(select 1 from club_private.terms where id=(payload->>'term_id')::uuid and status='active') then raise exception '學期不存在或已封存'; end if;
  if not exists(select 1 from club_private.users where id=(payload->>'teacher_id')::uuid and active and roles&&array['admin','clubtr','hrtr']::text[]) then raise exception '授課教師無效'; end if;
  insert into club_private.clubs(term_id,name,plan_name,description,kind,teacher_id,location,capacity,rate,funding_source,registration_start,registration_end) values((payload->>'term_id')::uuid,payload->>'name',payload->>'plan_name',coalesce(payload->>'description',''),payload->>'kind',(payload->>'teacher_id')::uuid,payload->>'location',(payload->>'capacity')::integer,(payload->>'rate')::numeric,coalesce(payload->>'funding_source',''),(payload->>'registration_start')::date,(payload->>'registration_end')::date) returning id into out_id;
 elsif action='publish_club' then
  perform club_private.assert_open(cid); update club_private.clubs set status=case when status='published' then 'draft' else 'published' end where id=cid;
 elsif action='add_session' then
  perform club_private.assert_open(cid,((payload->>'starts_at')::timestamptz at time zone 'Asia/Taipei')::date);
  se.id=gen_random_uuid();se.club_id=cid;se.teacher_id=(payload->>'teacher_id')::uuid;se.starts_at=(payload->>'starts_at')::timestamptz;se.ends_at=(payload->>'ends_at')::timestamptz;se.units=(payload->>'units')::numeric;se.rate=(payload->>'rate')::numeric;
  perform club_private.check_session(se);
  insert into club_private.sessions(id,club_id,teacher_id,starts_at,ends_at,units,rate) values(se.id,cid,se.teacher_id,se.starts_at,se.ends_at,se.units,se.rate) returning id into out_id;
 elsif action='change' then
  if c.id is null or not(a or (c.teacher_id=u.id and 'clubtr'=any(u.roles))) then raise exception '沒有異動權限'; end if;
  perform club_private.assert_open(cid);
  if sid is not null and (s.id is null or s.term_id<>c.term_id or not club_private.can_student(s,u)) then raise exception '沒有學生異動權限'; end if;
  insert into club_private.changes(club_id,kind,reason,student_id,effective_date,session_id,starts_at,ends_at,teacher_id,units,rate,status,created_by) values(cid,payload->>'kind',payload->>'reason',sid,nullif(payload->>'effective_date','')::date,seid,nullif(payload->>'starts_at','')::timestamptz,nullif(payload->>'ends_at','')::timestamptz,nullif(payload->>'teacher_id','')::uuid,nullif(payload->>'units','')::numeric,nullif(payload->>'rate','')::numeric,'pending',u.id) returning id into out_id;
  if a then perform club_private.apply_change(out_id); end if;
 elsif action='review_change' then
  select * into ch from club_private.changes where id=rid;
  if ch.id is null or ch.status<>'pending' or coalesce(payload->>'status','') not in ('approved','rejected') then raise exception '異動不存在或已處理'; end if;
  perform club_private.assert_open(ch.club_id);
  if payload->>'status'='approved' then perform club_private.apply_change(ch.id); else update club_private.changes set status='rejected',reviewed_by=u.id where id=ch.id; end if;
 elsif action='settle' then
  first_day=(payload->>'start_date')::date;last_day=(payload->>'end_date')::date;
  if first_day is null or last_day is null or first_day>last_day then raise exception '核算期間不正確'; end if;
  perform club_private.assert_open(cid);
  if exists(select 1 from club_private.settlements where club_id=cid and start_date<=last_day and end_date>=first_day) then raise exception '與已鎖定期間重疊'; end if;
  if not exists(select 1 from club_private.sessions where club_id=cid and status<>'cancelled' and (starts_at at time zone 'Asia/Taipei')::date between first_day and last_day) then raise exception '期間沒有可核算課程'; end if;
  if exists(select 1 from club_private.sessions where club_id=cid and status<>'cancelled' and (starts_at at time zone 'Asia/Taipei')::date between first_day and last_day and (status<>'completed' or signed_at is null or attendance_confirmed_at is null or trim(summary)='')) then raise exception '期間內仍有未完成簽到、點名或摘要的課程'; end if;
  select jsonb_agg(to_jsonb(x) order by x.starts_at),sum(x.amount),sum(x.units) into rows,total,units from (
   select course.*,teacher.name as teacher_name,round(course.units*course.rate) as amount,(select count(*) from club_private.attendance where session_id=course.id and status in ('present','late')) as attendance_count from club_private.sessions course join club_private.users teacher on teacher.id=course.teacher_id where course.club_id=cid and course.status<>'cancelled' and (course.starts_at at time zone 'Asia/Taipei')::date between first_day and last_day
  ) x;
  select jsonb_agg(to_jsonb(x)) into teachers from (select course.teacher_id,teacher.name,course.rate,sum(course.units) as units,sum(round(course.units*course.rate)) as amount from club_private.sessions course join club_private.users teacher on teacher.id=course.teacher_id where course.club_id=cid and course.status<>'cancelled' and (course.starts_at at time zone 'Asia/Taipei')::date between first_day and last_day group by course.teacher_id,teacher.name,course.rate) x;
  snap=jsonb_build_object('school','隘門國民小學','club',to_jsonb(c),'start_date',first_day,'end_date',last_day,'rows',rows,'teachers',teachers,'total',total,'units',units,'template_version',1);
  insert into club_private.settlements(club_id,start_date,end_date,snapshot,created_by) values(cid,first_day,last_day,snap,u.id) returning id into out_id;
 elsif action='paper_done' then
  update club_private.settlements set paper_done=not paper_done where id=rid; if not found then raise exception '找不到核銷'; end if;
 elsif action='roles' then
  select * into target from club_private.users where id=rid;
  select array_agg(value) into v_roles from jsonb_array_elements_text(payload->'roles');
  if target.id is null or coalesce(cardinality(v_roles),0)=0 or not v_roles<@array['admin','stu','clubtr','hrtr']::text[] then raise exception '角色不正確'; end if;
  if 'admin'=any(target.roles) and not 'admin'=any(v_roles) and (select count(*) from club_private.users where active and 'admin'=any(users.roles))<=2 then raise exception '需保留至少兩位管理者，請先完成交接'; end if;
  update club_private.users set roles=v_roles where id=rid;
 elsif action='add_term' then
  insert into club_private.terms(name,start_date,end_date) values(payload->>'name',(payload->>'start_date')::date,(payload->>'end_date')::date) returning id into out_id;
 elsif action='archive_term' then
  update club_private.terms set status='archived' where id=rid; if not found then raise exception '學期不存在'; end if;
 elsif action='add_student' then
  if not exists(select 1 from club_private.terms where id=(payload->>'term_id')::uuid and status='active') then raise exception '學期不存在或已封存'; end if;
  if nullif(payload->>'homeroom_id','') is not null and not exists(select 1 from club_private.users where id=(payload->>'homeroom_id')::uuid and active and 'hrtr'=any(roles)) then raise exception '導師帳號無效'; end if;
  if nullif(payload->>'user_id','') is not null and not exists(select 1 from club_private.users where id=(payload->>'user_id')::uuid and active and 'stu'=any(roles)) then raise exception '學生帳號無效'; end if;
  insert into club_private.students(term_id,user_id,name,class_name,number,homeroom_id) values((payload->>'term_id')::uuid,nullif(payload->>'user_id','')::uuid,payload->>'name',payload->>'class_name',payload->>'number',nullif(payload->>'homeroom_id','')::uuid) returning id into out_id;
 else raise exception '不支援的操作';
 end if;
 insert into club_private.audit(action,created_by) values(action,u.id);
 return jsonb_build_object('ok',true,'id',out_id);
end $$;
-- Bootstrap is service-role only; never available to browser users.
create function club_private.bootstrap_profile(p_id uuid,p_username text,p_name text,p_roles text[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users where id=p_id) then raise exception 'Auth user does not exist'; end if;
 insert into club_private.users(id,username,name,roles) values(p_id,p_username,p_name,p_roles);
end $$;
create function public.club_snapshot() returns jsonb language sql security invoker set search_path='' as $$ select club_private.snapshot() $$;
create function public.club_action(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select club_private.act(action,payload) $$;
create function public.club_bootstrap_profile(p_id uuid,p_username text,p_name text,p_roles text[]) returns void language sql security invoker set search_path='' as $$ select club_private.bootstrap_profile(p_id,p_username,p_name,p_roles) $$;
revoke all on all functions in schema club_private from public,anon,authenticated;
grant execute on function club_private.snapshot(),club_private.act(text,jsonb) to authenticated;
grant execute on function club_private.bootstrap_profile(uuid,text,text,text[]) to service_role;
revoke all on function public.club_snapshot(),public.club_action(text,jsonb),public.club_bootstrap_profile(uuid,text,text,text[]) from public,anon,authenticated;
grant execute on function public.club_snapshot(),public.club_action(text,jsonb) to authenticated;
grant execute on function public.club_bootstrap_profile(uuid,text,text,text[]) to service_role;
insert into club_private.terms(name,start_date,end_date) values('115-1','2026-08-01','2027-01-31');
commit;
