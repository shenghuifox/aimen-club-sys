-- The same instructor ID follows a person from paper-only records to a personal account.
alter table club_private.users
 add column login_enabled boolean not null default true,
 add column auth_user_id uuid generated always as (case when login_enabled then id end) stored
  references auth.users(id),
 add constraint instructors_without_login_role check(login_enabled or roles=array['clubtr']::text[]);
alter table club_private.users drop constraint users_id_fkey;
create unique index users_auth_user_lookup on club_private.users(auth_user_id);

create or replace function club_private.actor() returns club_private.users
language plpgsql stable security definer set search_path='' as $$
declare actor club_private.users;
begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 select p.* into actor from club_private.users p join auth.users u on u.id=p.auth_user_id
 where p.id=auth.uid() and p.active and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now());
 if actor.id is null then raise exception '帳號尚未獲授權'; end if;
 if 'admin'=any(actor.roles) and club_private.verified_admin_email(actor.id) is null
  then raise exception '行政帳號須先完成 Email 驗證，請由已驗證的行政發送邀請'; end if;
 if 'guardian'=any(actor.roles) then raise exception '此身分已停用'; end if;
 if actor.roles=array['stu'] and not exists(
  select 1 from club_private.students s join club_private.terms t on t.id=s.term_id
  join club_private.student_access a on a.student_id=s.id and a.user_id=s.user_id
  where s.user_id=actor.id and t.status='active'
 ) then raise exception '學生帳號尚未啟用'; end if;
 if actor.must_change_password then raise exception '首次登入請先更改密碼'; end if;
 if actor.school_password_changed_at is not null and not exists(
  select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid
   and s.user_id=actor.id and s.created_at>actor.school_password_changed_at
 ) then raise exception '密碼已更新，請重新登入'; end if;
 return actor;
end $$;

create or replace function club_private.snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 actor club_private.users:=club_private.actor();
 result jsonb;
begin
 if actor.roles<>array['stu'] then
  result:=club_private.snapshot_legacy() - 'guardian_links';
  if 'admin'=any(actor.roles) then
   result:=result||jsonb_build_object('external_instructors',coalesce((select jsonb_agg(id) from club_private.users where not login_enabled),'[]'));
   result:=jsonb_set(result,'{student_links}',coalesce((select jsonb_agg(k.student_id) from club_private.student_access k join club_private.students s on s.id=k.student_id and s.user_id=k.user_id),'[]'));
  end if;
  return result;
 end if;
 return jsonb_build_object(
  'users',jsonb_build_array(jsonb_build_object('id',actor.id,'name',actor.name,'roles',actor.roles)),
  'terms',coalesce((select jsonb_agg(to_jsonb(t) order by t.start_date desc)
   from club_private.terms t join club_private.students s on s.term_id=t.id
   where t.status='active' and s.user_id=actor.id),'[]'),
  'students',coalesce((select jsonb_agg(to_jsonb(s)-array['student_number','homeroom_id'])
   from club_private.students s join club_private.terms t on t.id=s.term_id
   where t.status='active' and s.user_id=actor.id),'[]'),
  'clubs',coalesce((select jsonb_agg(to_jsonb(c)-array['rate','funding_source','activity_ref','plan_name'])
   from club_private.clubs c join club_private.terms t on t.id=c.term_id
   join club_private.students s on s.term_id=t.id
   where t.status='active' and s.user_id=actor.id and c.status='published'),'[]'),
  'enrollments',coalesce((select jsonb_agg(to_jsonb(e)-'fee_status') from club_private.enrollments e
   join club_private.students s on s.id=e.student_id join club_private.terms t on t.id=s.term_id
   where t.status='active' and s.user_id=actor.id),'[]'),
  'sessions',coalesce((select jsonb_agg(to_jsonb(x)-array['rate','summary','signed_at','attendance_confirmed_at'] order by x.starts_at)
   from club_private.sessions x join club_private.clubs c on c.id=x.club_id
   join club_private.students s on s.term_id=c.term_id join club_private.terms t on t.id=s.term_id
   where t.status='active' and s.user_id=actor.id and c.status='published' and exists(
    select 1 from club_private.enrollments e where e.student_id=s.id and e.club_id=c.id and e.status='enrolled'
     and e.start_date<=(x.starts_at at time zone 'Asia/Taipei')::date
     and (e.end_date is null or e.end_date>=(x.starts_at at time zone 'Asia/Taipei')::date))),'[]'),
  'leaves','[]'::jsonb,'attendance','[]'::jsonb,'settlements','[]'::jsonb,'changes','[]'::jsonb
 );
end $$;

create or replace function club_private.act(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor club_private.users:=club_private.actor();
begin
 if actor.roles=array['stu'] and (action is distinct from 'enroll' or not exists(
  select 1 from club_private.clubs c join club_private.terms t on t.id=c.term_id
  where c.id=(payload->>'club_id')::uuid and t.status='active'
 )) then raise exception '學生僅能報名目前學期的社團'; end if;
 if action='sign_in' and exists(
  select 1 from club_private.sessions s join club_private.users u on u.id=s.teacher_id
  where s.id=(payload->>'session_id')::uuid and not u.login_enabled
 ) then raise exception '請由行政依紙本簽到紀錄補登'; end if;
 return club_private.act_legacy(action,payload);
end $$;

alter table club_private.changes drop constraint changes_kind_check,
 add constraint changes_kind_check check(kind in ('add_student','remove_student','reschedule','weekly')
  or (kind in ('cancel','makeup','swap','extra') and status='approved'));

create function club_private.schedule_lesson(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 writer club_private.users:=club_private.admin_writer();
 cid uuid:=(payload->>'club_id')::uuid;
 source_id uuid:=nullif(payload->>'session_id','')::uuid;
 source club_private.sessions;
 lesson club_private.sessions;
 reason text:=btrim(coalesce(payload->>'reason',''));
 instructor text:=btrim(coalesce(payload->>'external_name',''));
 change_kind text;
begin
 if length(reason) not between 1 and 300 then raise exception '請填寫 1 至 300 字的異動原因'; end if;
 lesson.id:=gen_random_uuid();
 lesson.club_id:=cid;
 lesson.starts_at:=(payload->>'starts_at')::timestamptz;
 lesson.ends_at:=(payload->>'ends_at')::timestamptz;
 lesson.units:=(payload->>'units')::numeric;
 lesson.teacher_id:=nullif(payload->>'teacher_id','')::uuid;
 perform club_private.assert_open(cid,(lesson.starts_at at time zone 'Asia/Taipei')::date);
 if source_id is null then
  change_kind:='extra';
  select rate into lesson.rate from club_private.clubs where id=cid;
 else
  change_kind:='makeup';
  select * into source from club_private.sessions where id=source_id and club_id=cid
   and status='cancelled' and signed_at is null;
  if not found then raise exception '請選擇此社團已停課的原節次'; end if;
  perform club_private.assert_open(cid,(source.starts_at at time zone 'Asia/Taipei')::date);
  if exists(select 1 from club_private.changes where session_id=source.id and kind='makeup') then
   raise exception '此節次已排定補課';
  end if;
  lesson.rate:=source.rate;
 end if;
 if instructor<>'' then
  if length(instructor)>100 or lesson.teacher_id is not null then raise exception '請確認外聘教師姓名'; end if;
  lesson.teacher_id:=gen_random_uuid();
  insert into club_private.users(id,username,name,roles,login_enabled)
   values(lesson.teacher_id,'external-'||lesson.teacher_id,instructor,array['clubtr'],false);
 end if;
 perform club_private.check_session(lesson);
 insert into club_private.sessions(id,club_id,teacher_id,starts_at,ends_at,units,rate)
  values(lesson.id,cid,lesson.teacher_id,lesson.starts_at,lesson.ends_at,lesson.units,lesson.rate);
 insert into club_private.changes(club_id,kind,reason,session_id,starts_at,ends_at,teacher_id,units,rate,original_dates,status,created_by,reviewed_by)
  values(cid,change_kind,reason,coalesce(source_id,lesson.id),lesson.starts_at,lesson.ends_at,lesson.teacher_id,lesson.units,lesson.rate,
   case when source_id is null then '[]'::jsonb else jsonb_build_array(source.starts_at) end,'approved',writer.id,writer.id);
 insert into club_private.audit(action,created_by,detail)
  values(change_kind,writer.id,jsonb_build_object('session_id',lesson.id,'source_id',source_id,'teacher_id',lesson.teacher_id,'reason',reason));
 return jsonb_build_object('id',lesson.id);
end $$;

create function club_private.paper_sign_in(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 writer club_private.users:=club_private.admin_writer();
 lesson club_private.sessions;
 reason text:=btrim(coalesce(payload->>'reason',''));
begin
 select s.* into lesson from club_private.sessions s join club_private.users u on u.id=s.teacher_id
  where s.id=(payload->>'session_id')::uuid and not u.login_enabled;
 if not found then raise exception '這個節次未指派無帳號的外聘老師'; end if;
 if lesson.signed_at is not null then raise exception '此節次已完成簽到'; end if;
 if lesson.starts_at>now() or length(reason) not between 1 and 300 then raise exception '開課後才可補登，請填寫 1 至 300 字的紙本簽到說明'; end if;
 perform club_private.act_legacy('sign_in',payload);
 insert into club_private.audit(action,created_by,detail)
  values('paper_sign_in',writer.id,jsonb_build_object('session_id',lesson.id,'teacher_id',lesson.teacher_id,'reason',reason));
 return jsonb_build_object('message','已登記外聘老師的紙本簽到');
end $$;

create function club_private.activate_external_instructor(payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
 writer club_private.users:=club_private.admin_writer();
 target uuid:=(payload->>'id')::uuid;
 account text:=lower(btrim(coalesce(payload->>'username','')));
begin
 if account !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then raise exception '請核對登入帳號'; end if;
 if not exists(select 1 from auth.users a where a.id=target and lower(a.email)=account||'@accounts.aimen.invalid'
  and a.email_confirmed_at is not null and a.deleted_at is null
  and a.raw_app_meta_data->>'aimen_issued_by'=writer.id::text
  and a.raw_app_meta_data->>'aimen_external_instructor'=target::text
  and length(a.raw_app_meta_data->>'aimen_teacher_setup')=64)
 then raise exception '此帳號尚未由校用帳號服務建立'; end if;
 update club_private.users set username=account,login_enabled=true,school_login=true,must_change_password=true
  where id=target and active and not login_enabled;
 if not found then raise exception '此外聘老師已開通或已停用，請重新整理'; end if;
 insert into club_private.audit(action,created_by,detail)
  values('activate_external_instructor',writer.id,jsonb_build_object('teacher_id',target));
end $$;

create function public.club_schedule_lesson(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select club_private.schedule_lesson(payload) $$;
create function public.club_paper_sign_in(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select club_private.paper_sign_in(payload) $$;
create function public.club_activate_external_instructor(payload jsonb) returns void
language sql security invoker set search_path='' as $$ select club_private.activate_external_instructor(payload) $$;

revoke all on function club_private.schedule_lesson(jsonb),public.club_schedule_lesson(jsonb),
 club_private.paper_sign_in(jsonb),public.club_paper_sign_in(jsonb),
 club_private.activate_external_instructor(jsonb),public.club_activate_external_instructor(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function club_private.schedule_lesson(jsonb),public.club_schedule_lesson(jsonb),
 club_private.paper_sign_in(jsonb),public.club_paper_sign_in(jsonb),
 club_private.activate_external_instructor(jsonb),public.club_activate_external_instructor(jsonb)
 to authenticated;
