alter table club_private.leaves drop constraint leaves_status_check,
 add constraint leaves_status_check check(status in ('pending','approved','rejected','withdrawn'));
drop index club_private.leave_open_unique;
create unique index leave_open_unique on club_private.leaves(session_id,student_id) where status in ('pending','approved');

alter table club_private.changes drop constraint changes_status_check,
 add constraint changes_status_check check(status in ('pending','approved','rejected','withdrawn'));
alter table club_private.users add column notes text not null default '' check(length(notes)<=500);
alter table club_private.students add column student_number text not null default '' check(length(student_number)<=60);

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
 'users',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'username',case when a or x.id=u.id then x.username end,'name',x.name,'roles',x.roles,'active',x.active)||case when a then jsonb_build_object('email',au.email,'notes',x.notes) else '{}'::jsonb end),'[]') from club_private.users x left join auth.users au on au.id=x.id where a or (x.active and (x.id=u.id or ((not family_only and x.roles&&array['admin','clubtr','hrtr']::text[]) or exists(select 1 from club_private.sessions se where se.teacher_id=x.id and se.club_id in (select club_id from family_clubs)))))),
 'terms',(select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc),'[]') from club_private.terms x),
 'clubs',(select coalesce(jsonb_agg(case when student_only then to_jsonb(x)-array['rate','funding_source','activity_ref'] else to_jsonb(x) end),'[]') from club_private.clubs x where a or x.teacher_id=u.id or (family_only and x.id in (select club_id from family_clubs)) or (not family_only and x.status='published')),
 'students',(select coalesce(jsonb_agg(case when family_only then to_jsonb(s)-array['user_id','homeroom_id','student_number'] when a then to_jsonb(s) else to_jsonb(s)-'student_number' end),'[]') from club_private.students s
   where s.id in (select student_id from family_students) or club_private.can_student(s,u) or exists(select 1 from assigned_enrollments where student_id=s.id)),
 'sessions',(select coalesce(jsonb_agg(case when student_only then to_jsonb(s)-array['rate','summary','signed_at','attendance_confirmed_at'] else to_jsonb(s) end order by s.starts_at),'[]') from club_private.sessions s join club_private.clubs c on c.id=s.club_id where a or s.teacher_id=u.id or c.teacher_id=u.id or (family_only and c.id in (select club_id from family_clubs)) or (not family_only and c.status='published')),
 'enrollments',(select coalesce(jsonb_agg(case when a or s.user_id=u.id or s.id in (select student_id from family_students) or (s.homeroom_id=u.id and 'hrtr'=any(u.roles))
      then to_jsonb(e) else to_jsonb(e)-'fee_status' end),'[]')
   from club_private.enrollments e join club_private.students s on s.id=e.student_id
   where s.id in (select student_id from family_students) or (club_private.can_student(s,u) and (a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles))
       or exists(select 1 from club_private.clubs where id=e.club_id and teacher_id=u.id and 'clubtr'=any(u.roles))))
      or exists(select 1 from assigned_enrollments where id=e.id)),
 'leaves',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from club_private.leaves l join club_private.students s on s.id=l.student_id join club_private.sessions se on se.id=l.session_id where a or (l.created_by=u.id and not family_only) or s.id in (select student_id from family_students) or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])),
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


-- Extend attendance rules without copying the core action implementation.
alter function club_private.act(text,jsonb) rename to act_before_weekly_attendance;
revoke all on function club_private.act_before_weekly_attendance(text,jsonb) from public,anon,authenticated;

create function club_private.act(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u club_private.users;
 lesson club_private.sessions;
 lesson_day date;
 today date := (now() at time zone 'Asia/Taipei')::date;
begin
 if action not in ('sign_in','attendance') then
  return club_private.act_before_weekly_attendance(action,payload);
 end if;
 perform pg_advisory_xact_lock(148975,1);
 u:=club_private.actor();
 select * into lesson from club_private.sessions where id=(payload->>'session_id')::uuid;
 if not found or not ('admin'=any(u.roles) or (lesson.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[]))
 then raise exception '沒有授課權限'; end if;
 lesson_day:=(lesson.starts_at at time zone 'Asia/Taipei')::date;
 if lesson_day>today or date_trunc('week',lesson_day::timestamp)<>date_trunc('week',today::timestamp)
 then raise exception '只能在本週補登已到日期的課程'; end if;
 if action='attendance' or lesson_day=today then
  return club_private.act_before_weekly_attendance(action,payload);
 end if;
 perform club_private.assert_open(lesson.club_id,lesson_day);
 if lesson.status='cancelled' then raise exception '課程已停課'; end if;
 update club_private.sessions set signed_at=coalesce(signed_at,now()) where id=lesson.id;
 insert into club_private.audit(action,created_by) values(action,u.id);
 return jsonb_build_object('ok',true,'id',null);
end $$;
revoke all on function club_private.act(text,jsonb) from public,anon,authenticated;
grant execute on function club_private.act(text,jsonb) to authenticated;

create or replace function public.club_action(action text,payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select club_private.act(action,payload) $$;

create function club_private.followup(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor club_private.users;
 target club_private.users;
 request_id uuid := (payload->>'id')::uuid;
 leave_row club_private.leaves;
 change_row club_private.changes;
 student club_private.students;
 lesson club_private.sessions;
 login_name text := btrim(coalesce(payload->>'username',''));
 display_name text := btrim(coalesce(payload->>'name',''));
 notes_text text := btrim(coalesce(payload->>'notes',''));
 student_no text := btrim(coalesce(payload->>'student_number',''));
 account_roles text[];
 result jsonb := '{}'::jsonb;
begin
 perform pg_advisory_xact_lock(148975,1);
 actor:=club_private.actor();
 if action='withdraw_leave' then
  select * into leave_row from club_private.leaves where id=request_id and status in ('pending','approved');
  if not found then raise exception '這張假單已處理或找不到'; end if;
  select * into student from club_private.students where id=leave_row.student_id;
  select * into lesson from club_private.sessions where id=leave_row.session_id;
  if not coalesce(('admin'=any(actor.roles) or (leave_row.created_by=actor.id and not ('guardian'=any(actor.roles))) or
    (student.user_id=actor.id and 'stu'=any(actor.roles)) or (student.homeroom_id=actor.id and 'hrtr'=any(actor.roles)) or
    (lesson.teacher_id=actor.id and 'clubtr'=any(actor.roles)) or exists(
     select 1 from club_private.guardian_links where guardian_id=actor.id and student_id=student.id
    )),false) then raise exception '沒有撤回這張假單的權限'; end if;
  perform club_private.assert_open(lesson.club_id,case when leave_row.status='approved' then (lesson.starts_at at time zone 'Asia/Taipei')::date end);
  if leave_row.status='approved' and exists(select 1 from club_private.attendance
      where session_id=lesson.id and student_id=student.id and status='leave') then
   if date_trunc('week',lesson.starts_at at time zone 'Asia/Taipei')<>date_trunc('week',now() at time zone 'Asia/Taipei') then
    raise exception '此假單已帶入往週點名，請由學校處理更正';
   end if;
   delete from club_private.attendance where session_id=lesson.id and student_id=student.id and status='leave';
   update club_private.sessions set status='scheduled',attendance_confirmed_at=null where id=lesson.id and status='completed';
  end if;
  update club_private.leaves set status='withdrawn' where id=request_id;
 elsif action='withdraw_change' then
  select * into change_row from club_private.changes where id=request_id and status='pending';
  if not found then raise exception '只能撤回待確認的異動；已生效異動請另提更正'; end if;
  if not ('admin'=any(actor.roles) or ('clubtr'=any(actor.roles) and change_row.created_by=actor.id and exists(
   select 1 from club_private.clubs where id=change_row.club_id and teacher_id=actor.id
  ))) then raise exception '沒有撤回這筆異動的權限'; end if;
  perform club_private.assert_open(change_row.club_id);
  update club_private.changes set status='withdrawn' where id=request_id;
 elsif action in ('edit_account','auth_account') then
  if not ('admin'=any(actor.roles)) then raise exception '僅行政管理者可操作'; end if;
  if request_id is null and action='auth_account' then return jsonb_build_object('authorized',true); end if;
  select * into target from club_private.users where id=request_id;
  if not found then raise exception '找不到帳號'; end if;
  if action='auth_account' then
   if 'admin'=any(target.roles) then raise exception '管理者登入憑證請由帳號持有人透過登入服務修改'; end if;
   insert into club_private.audit(action,created_by,detail) values('auth_account',actor.id,jsonb_build_object('id',target.id));
   return jsonb_build_object('id',target.id);
  end if;
  if length(login_name) not between 1 and 254 or length(display_name) not between 1 and 100 or length(notes_text)>500
    or length(student_no)>60 then raise exception '請核對帳號、姓名、學號與備註長度'; end if;
  select array_agg(distinct value order by value) into account_roles from jsonb_array_elements_text(payload->'roles');
  if coalesce(cardinality(account_roles),0)=0 then raise exception '請至少選擇一種角色'; end if;
  if ('guardian'=any(target.roles)) is distinct from ('guardian'=any(account_roles)) then
   raise exception '家長角色請透過學生名冊綁定或解除';
  end if;
  if 'admin'=any(target.roles) and not ('admin'=any(account_roles))
     and target.active and (select count(*) from club_private.users where active and 'admin'=any(roles))<=2
     then raise exception '請保留至少兩位有效管理者'; end if;
  if exists(select 1 from club_private.users where id<>target.id and lower(username)=lower(login_name)) then
   raise exception '此帳號名稱已被使用';
  end if;
  update club_private.users set username=login_name,name=display_name,roles=account_roles,notes=notes_text where id=target.id;
  update club_private.students set student_number=student_no where user_id=target.id and term_id=(payload->>'term_id')::uuid;
 else
  raise exception '不支援的操作';
 end if;
 insert into club_private.audit(action,created_by,detail) values(action,actor.id,jsonb_build_object('id',request_id));
 return result;
end $$;

create function public.club_followup(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select club_private.followup(action,payload) $$;
revoke all on function club_private.followup(text,jsonb),public.club_followup(text,jsonb) from public,anon,authenticated;
grant execute on function club_private.followup(text,jsonb),public.club_followup(text,jsonb) to authenticated;

create or replace function club_private.operations(action text,payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor club_private.users := club_private.admin_writer();
 reason text := btrim(coalesce(payload->>'reason',''));
 source club_private.sessions;
 other club_private.sessions;
 proposed club_private.sessions;
 swapped club_private.sessions;
 bill club_private.settlements;
 enrollment club_private.enrollments;
begin
 if action='fee_status' then
  select * into enrollment from club_private.enrollments where id=(payload->>'id')::uuid and status='enrolled';
  if not found then raise exception '只能登記已錄取的繳費狀態'; end if;
  perform club_private.assert_open(enrollment.club_id);
  update club_private.enrollments set fee_status=nullif(payload->>'status','') where id=enrollment.id;
 else
  if length(reason) not between 1 and 300 then raise exception '請填寫 1 至 300 字的原因'; end if;
  if action='void_settlement' then
   select * into bill from club_private.settlements where id=(payload->>'id')::uuid;
   if not found or bill.paper_done then raise exception '找不到核銷或紙本已完成，請先由會計確認更正方式'; end if;
   perform club_private.assert_open(bill.club_id);
   insert into club_private.voided_settlements
    select bill.*,now(),actor.id,reason;
   delete from club_private.settlements where id=bill.id;
  elsif action in ('cancel','makeup','swap') then
   select * into source from club_private.sessions where id=(payload->>'session_id')::uuid;
   if not found or source.signed_at is not null
      or source.status<>(case when action='makeup' then 'cancelled' else 'scheduled' end) then
    raise exception '請選擇未簽到且符合異動條件的節次';
   end if;
   perform club_private.assert_open(source.club_id,(source.starts_at at time zone 'Asia/Taipei')::date);
   proposed:=source;
   if action='cancel' then
    update club_private.sessions set status='cancelled' where id=source.id;
   elsif action='makeup' then
    if exists(select 1 from club_private.changes where session_id=source.id and kind='makeup') then
     raise exception '此節次已排定補課';
    end if;
    proposed.id:=gen_random_uuid();
    proposed.starts_at:=(payload->>'starts_at')::timestamptz;
    proposed.ends_at:=(payload->>'ends_at')::timestamptz;
    proposed.status:='scheduled';
    perform club_private.assert_open(proposed.club_id,(proposed.starts_at at time zone 'Asia/Taipei')::date);
    perform club_private.check_session(proposed);
    insert into club_private.sessions select proposed.*;
   else
    select * into other from club_private.sessions where id=(payload->>'other_id')::uuid;
    if not found or other.id=source.id or other.status<>'scheduled' or other.signed_at is not null
       or (select term_id from club_private.clubs where id=other.club_id)
          is distinct from (select term_id from club_private.clubs where id=source.club_id)
       or exists(select 1 from club_private.leaves where session_id in (source.id,other.id) and status in ('pending','approved'))
    then raise exception '請選擇同學期、未簽到且無有效假單的兩個節次'; end if;
    swapped:=other;
    proposed.starts_at:=other.starts_at;
    proposed.ends_at:=other.starts_at+(source.ends_at-source.starts_at);
    swapped.starts_at:=source.starts_at;
    swapped.ends_at:=source.starts_at+(other.ends_at-other.starts_at);
    perform club_private.assert_open(other.club_id,(other.starts_at at time zone 'Asia/Taipei')::date);
    perform club_private.assert_open(other.club_id,(swapped.starts_at at time zone 'Asia/Taipei')::date);
    perform club_private.assert_open(source.club_id,(proposed.starts_at at time zone 'Asia/Taipei')::date);
    update club_private.sessions set status='cancelled' where id=other.id;
    perform club_private.check_session(proposed);
    update club_private.sessions set starts_at=proposed.starts_at,ends_at=proposed.ends_at where id=source.id;
    perform club_private.check_session(swapped);
    update club_private.sessions set starts_at=swapped.starts_at,ends_at=swapped.ends_at,status='scheduled' where id=other.id;
    insert into club_private.changes(club_id,kind,reason,session_id,starts_at,ends_at,original_dates,status,created_by,reviewed_by)
     values(other.club_id,action,reason,other.id,swapped.starts_at,swapped.ends_at,jsonb_build_array(other.starts_at),'approved',actor.id,actor.id);
   end if;
   insert into club_private.changes(club_id,kind,reason,session_id,starts_at,ends_at,original_dates,status,created_by,reviewed_by)
    values(source.club_id,action,reason,source.id,proposed.starts_at,proposed.ends_at,jsonb_build_array(source.starts_at),'approved',actor.id,actor.id);
  else raise exception '不支援的操作';
  end if;
 end if;
 insert into club_private.audit(action,created_by) values(action,actor.id);
end $$;
