alter table club_private.users drop constraint users_roles_check,
 add constraint users_roles_check check(roles=array['guardian']::text[] or
  (cardinality(roles)>0 and roles <@ array['admin','stu','clubtr','hrtr']::text[]));
alter table club_private.clubs add column activity_ref text not null default '';
alter table club_private.audit add column detail jsonb not null default '{}';

create table club_private.guardian_links (
 guardian_id uuid not null references club_private.users(id),
 student_id uuid not null references club_private.students(id),
 primary key(guardian_id,student_id)
);
create index guardian_links_student_id on club_private.guardian_links(student_id);
alter table club_private.guardian_links enable row level security;
revoke all on club_private.guardian_links from public,anon,authenticated;

create or replace function club_private.snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u club_private.users=club_private.actor(); a boolean; student_only boolean; family_only boolean; result jsonb; begin
 a='admin'=any(u.roles);
 student_only=not (u.roles&&array['admin','clubtr','hrtr']::text[]);
 family_only=u.roles=array['guardian']::text[];
 with family_students as (
  select student_id from club_private.guardian_links where guardian_id=u.id and 'guardian'=any(u.roles)
 ), family_clubs as (
  select distinct club_id from club_private.enrollments where student_id in (select student_id from family_students)
 ), assigned_enrollments as (
  select e.id,e.student_id from club_private.enrollments e
  where e.status='enrolled' and u.roles&&array['clubtr','hrtr']::text[]
   and exists(select 1 from club_private.sessions s where s.club_id=e.club_id and s.teacher_id=u.id
     and s.status<>'cancelled' and (s.starts_at at time zone 'Asia/Taipei')::date between e.start_date and coalesce(e.end_date,'infinity'))
 )
 select jsonb_build_object(
 'users',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'username',case when a or x.id=u.id then x.username end,'name',x.name,'roles',x.roles,'active',x.active)),'[]') from club_private.users x where a or (x.active and (x.id=u.id or (not family_only and x.roles&&array['admin','clubtr','hrtr']::text[])))),
 'terms',(select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc),'[]') from club_private.terms x),
 'clubs',(select coalesce(jsonb_agg(case when student_only then to_jsonb(x)-array['rate','funding_source','activity_ref'] else to_jsonb(x) end),'[]') from club_private.clubs x where a or x.teacher_id=u.id or (family_only and x.id in (select club_id from family_clubs)) or (not family_only and x.status='published')),
 'students',(select coalesce(jsonb_agg(case when family_only then to_jsonb(s)-array['user_id','homeroom_id'] else to_jsonb(s) end),'[]') from club_private.students s
   where s.id in (select student_id from family_students) or club_private.can_student(s,u) or exists(select 1 from assigned_enrollments where student_id=s.id)),
 'sessions',(select coalesce(jsonb_agg(case when student_only then to_jsonb(s)-array['rate','summary','signed_at','attendance_confirmed_at'] else to_jsonb(s) end order by s.starts_at),'[]') from club_private.sessions s join club_private.clubs c on c.id=s.club_id where a or s.teacher_id=u.id or c.teacher_id=u.id or (family_only and c.id in (select club_id from family_clubs)) or (not family_only and c.status='published')),
 'enrollments',(select coalesce(jsonb_agg(case when a or s.user_id=u.id or s.id in (select student_id from family_students) or (s.homeroom_id=u.id and 'hrtr'=any(u.roles))
      then to_jsonb(e) else to_jsonb(e)-'fee_status' end),'[]')
   from club_private.enrollments e join club_private.students s on s.id=e.student_id
   where s.id in (select student_id from family_students) or (club_private.can_student(s,u) and (a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles))
       or exists(select 1 from club_private.clubs where id=e.club_id and teacher_id=u.id and 'clubtr'=any(u.roles))))
      or exists(select 1 from assigned_enrollments where id=e.id)),
 'leaves',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from club_private.leaves l join club_private.students s on s.id=l.student_id join club_private.sessions se on se.id=l.session_id where a or s.id in (select student_id from family_students) or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])),
 'attendance',(select coalesce(jsonb_agg(to_jsonb(at)),'[]') from club_private.attendance at join club_private.students s on s.id=at.student_id join club_private.sessions se on se.id=at.session_id where a or s.id in (select student_id from family_students) or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])),
 'changes',(select coalesce(jsonb_agg(case when a or x.created_by=u.id then to_jsonb(x)
    else to_jsonb(x)-array['edit_history','rate','reviewed_by'] end order by x.created_at desc),'[]')
    from club_private.changes x join club_private.clubs c on c.id=x.club_id
    where a or x.created_by=u.id or (x.status='approved' and x.kind not in ('add_student','remove_student')
      and (c.teacher_id=u.id or (family_only and c.id in (select club_id from family_clubs)) or (not family_only and c.status='published')))),
 'guardian_links',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from club_private.guardian_links g where a or g.guardian_id=u.id),
 'pending_accounts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.email),'[]') from club_private.pending_accounts p where a),
 'settlements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from club_private.settlements x where a),
 'voided_settlements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.voided_at desc),'[]') from club_private.voided_settlements x where a),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from club_private.audit where a order by created_at desc limit 100) x)
 ) into result; return result;
end $$;

create function club_private.manage(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor club_private.users;
 target club_private.users;
 student club_private.students;
 session club_private.sessions;
 source club_private.terms;
 destination club_private.terms;
 course club_private.clubs;
 target_id uuid := nullif(payload->>'id','')::uuid;
 v_student_id uuid := nullif(payload->>'student_id','')::uuid;
 v_email text := lower(btrim(coalesce(payload->>'email','')));
 reason text := btrim(coalesce(payload->>'reason',''));
 offset_days integer;
 note jsonb := '{}'::jsonb;
begin
 if action='guardian_leave' then
  perform pg_advisory_xact_lock(148975,1);
  actor:=club_private.actor();
  if actor.roles<>array['guardian']::text[] or not exists(
   select 1 from club_private.guardian_links g where g.guardian_id=actor.id and g.student_id=v_student_id
  ) then raise exception '只能為已綁定的孩子請假'; end if;
  select * into session from club_private.sessions where id=(payload->>'session_id')::uuid and status='scheduled';
  if not found or session.starts_at<now() or length(reason) not between 1 and 300 or not exists(
   select 1 from club_private.enrollments e where e.club_id=session.club_id and e.student_id=v_student_id
    and e.status='enrolled' and (session.starts_at at time zone 'Asia/Taipei')::date between e.start_date and coalesce(e.end_date,'infinity')
  ) then raise exception '請核對孩子、課程節次及請假原因'; end if;
  perform club_private.assert_open(session.club_id,(session.starts_at at time zone 'Asia/Taipei')::date);
  insert into club_private.leaves(session_id,student_id,kind,reason,status,created_by)
   values(session.id,v_student_id,payload->>'kind',reason,'pending',actor.id);
 else
  actor:=club_private.admin_writer();
  if action='account_status' then
   select * into target from club_private.users where id=target_id;
   if not found or target.id=actor.id or length(reason) not between 1 and 300
      or jsonb_typeof(payload->'active') is distinct from 'boolean' then raise exception '請選其他帳號並填寫原因'; end if;
   if target.active and 'admin'=any(target.roles) and not (payload->>'active')::boolean
      and (select count(*) from club_private.users where active and 'admin'=any(roles))<=2
   then raise exception '請保留至少兩位有效管理者'; end if;
   update club_private.users set active=(payload->>'active')::boolean where id=target.id;
   note:=jsonb_build_object('id',target.id,'active',(payload->>'active')::boolean,'reason',reason);
  elsif action='copy_term' then
   select * into source from club_private.terms where id=target_id;
   if not found or coalesce(length(btrim(payload->>'name')),0) not between 1 and 60 then
    raise exception '請選擇來源學期並填寫新學期名稱';
   end if;
   insert into club_private.terms(name,start_date,end_date)
    values(btrim(payload->>'name'),(payload->>'start_date')::date,(payload->>'end_date')::date)
    returning * into destination;
   offset_days:=destination.start_date-source.start_date;
   insert into club_private.students(term_id,user_id,name,class_name,number,homeroom_id)
    select destination.id,s.user_id,s.name,s.class_name,s.number,s.homeroom_id from club_private.students s where s.term_id=source.id;
   insert into club_private.guardian_links(guardian_id,student_id)
    select g.guardian_id,n.id from club_private.guardian_links g join club_private.students s on s.id=g.student_id
    join club_private.students n on (n.class_name,n.number)=(s.class_name,s.number)
    where s.term_id=source.id and n.term_id=destination.id;
   insert into club_private.clubs(term_id,name,plan_name,description,kind,teacher_id,location,capacity,rate,
     funding_source,registration_start,registration_end,status,color)
    select destination.id,c.name,c.plan_name,c.description,c.kind,c.teacher_id,c.location,c.capacity,c.rate,c.funding_source,
      least(c.registration_start+offset_days,destination.end_date),least(c.registration_end+offset_days,destination.end_date),'draft',c.color
    from club_private.clubs c where c.term_id=source.id;
   note:=jsonb_build_object('id',destination.id,'source_id',source.id);
  elsif action in ('link_guardian','unlink_guardian') then
   select * into student from club_private.students s where s.id=v_student_id;
   if not found then raise exception '找不到學生'; end if;
   if action='unlink_guardian' then
    delete from club_private.guardian_links g where g.guardian_id=target_id and g.student_id=student.id;
   else
    if not exists(select 1 from club_private.terms where id=student.term_id and status='active') then raise exception '學期已封存'; end if;
    select u.id into target_id from auth.users u
     where lower(u.email)=v_email and email_confirmed_at is not null and deleted_at is null
       and (banned_until is null or banned_until<=now());
    if not found then raise exception '請使用已驗證登入用電子郵件'; end if;
    if exists(select 1 from club_private.users u where u.id=target_id and (not u.active or u.roles<>array['guardian']::text[]))
     then raise exception '該帳號已停用或使用其他身分'; end if;
    if length(btrim(coalesce(payload->>'name',''))) not between 1 and 100 then raise exception '請填寫家長姓名'; end if;
    insert into club_private.users(id,username,name,roles) values(target_id,v_email,btrim(payload->>'name'),array['guardian']::text[])
     on conflict (id) do nothing;
    insert into club_private.guardian_links values(target_id,student.id) on conflict do nothing;
   end if;
   note:=jsonb_build_object('id',target_id,'student_id',student.id);
  elsif action='create_club' then
   if length(coalesce(payload->>'activity_ref',''))>120 then raise exception '請核對活動或計畫案號'; end if;
   note:=club_private.act('save_club',payload);
   update club_private.clubs set activity_ref=btrim(coalesce(payload->>'activity_ref','')) where id=(note->>'id')::uuid;
   return note;
  elsif action='edit_club' then
   perform club_private.assert_open(target_id);
   select * into course from club_private.clubs where id=target_id;
   if not exists(select 1 from club_private.users where id=(payload->>'teacher_id')::uuid and active
      and roles&&array['admin','clubtr','hrtr']::text[]) then raise exception '授課教師無效'; end if;
   if (payload->>'capacity')::integer<(
     select count(*) from club_private.enrollments where club_id=course.id and status='enrolled'
       and coalesce(end_date,'infinity')>=(now() at time zone 'Asia/Taipei')::date
   ) then raise exception '名額不可小於目前與未來的錄取人數'; end if;
   if coalesce(length(btrim(payload->>'name')),0) not between 1 and 100
      or length(coalesce(payload->>'activity_ref',''))>120 then raise exception '請核對社團名稱與計畫案號'; end if;
   update club_private.clubs set name=btrim(payload->>'name'),plan_name=payload->>'plan_name',
     description=coalesce(payload->>'description',''),kind=payload->>'kind',location=payload->>'location',
     teacher_id=(payload->>'teacher_id')::uuid,capacity=(payload->>'capacity')::integer,rate=(payload->>'rate')::numeric,
     funding_source=payload->>'funding_source',activity_ref=btrim(coalesce(payload->>'activity_ref','')),
     registration_start=(payload->>'registration_start')::date,registration_end=(payload->>'registration_end')::date where id=course.id;
   note:=jsonb_build_object('id',course.id);
  else raise exception '不支援的操作';
  end if;
 end if;
 insert into club_private.audit(action,created_by,detail) values(action,actor.id,note);
 return note;
end $$;

create function public.club_manage(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select club_private.manage(action,payload) $$;
revoke all on function club_private.manage(text,jsonb),public.club_manage(text,jsonb) from public,anon,authenticated;
grant execute on function club_private.manage(text,jsonb),public.club_manage(text,jsonb) to authenticated;
