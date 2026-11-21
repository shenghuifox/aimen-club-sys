create table club_private.student_access(
 student_id uuid primary key references club_private.students(id) on delete cascade,
 user_id uuid not null references club_private.users(id),
 card_hash text not null unique check(card_hash ~ '^[0-9a-f]{64}$'),
 openid_hash text not null check(openid_hash ~ '^[0-9a-f]{64}$')
);
alter table club_private.student_access enable row level security;
revoke all on club_private.student_access from public,anon,authenticated;

create or replace function club_private.actor() returns club_private.users
language plpgsql stable security definer set search_path='' as $$
declare actor club_private.users;
begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 select p.* into actor from club_private.users p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.active and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now());
 if actor.id is null then raise exception '帳號尚未獲授權'; end if;
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


create function club_private.provision_student(payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
 writer club_private.users:=club_private.admin_writer();
 pupil club_private.students;
 course_term uuid:=(payload->>'term_id')::uuid;
 account_id uuid:=nullif(payload->>'id','')::uuid;
 class_label text:=btrim(coalesce(payload->>'class_name',''));
 seat text:=ltrim(btrim(coalesce(payload->>'number','')),'0');
 full_name text:=btrim(coalesce(payload->>'name',''));
 card text:=nullif(payload->>'card_hash','');
 openid text:=nullif(payload->>'openid_hash','');
begin
 if length(class_label) not between 1 and 60 or seat !~ '^[1-9][0-9]?$' or length(full_name) not between 1 and 100
  or (card is null) is distinct from (openid is null)
  or coalesce(card !~ '^[0-9a-f]{64}$' or openid !~ '^[0-9a-f]{64}$',false)
  then raise exception '請核對班級、座號、姓名與登入連結'; end if;
 if not exists(select 1 from club_private.terms t where t.id=course_term and t.status='active')
  then raise exception '請切換至使用中的學期'; end if;
 begin
  select s.* into strict pupil from club_private.students s where s.term_id=course_term and s.class_name=class_label
   and ltrim(s.number,'0')=seat for update;
 exception
  when no_data_found then null;
  when too_many_rows then raise exception '名冊有重複座號，請先更正';
 end;
 if pupil.id is null then
  insert into club_private.students(term_id,name,class_name,number)
  values(course_term,full_name,class_label,btrim(payload->>'number')) returning * into pupil;
 elsif pupil.name<>full_name then raise exception '同班座號已有不同學生，請核對名冊'; end if;
 if pupil.user_id is null then
  if account_id is null then raise exception '此學生須先建立校用帳號'; end if;
  perform club_private.register_school_account(payload||jsonb_build_object('student_id',pupil.id,'name',full_name,'role','stu'));
 elsif account_id is not null then raise exception '此學生剛完成綁定，請重新確認名冊'; end if;
 if card is not null then
  if not exists(select 1 from club_private.students s join club_private.users u on u.id=s.user_id
   where s.id=pupil.id and u.active and u.school_login and u.roles=array['stu'])
  then raise exception '此學生需綁定使用中的學生校用帳號'; end if;
  if exists(select 1 from club_private.student_access where student_id=pupil.id)
    and coalesce(payload->>'replace','false')<>'true' then raise exception '登入連結已發行，請用補發功能'; end if;
  insert into club_private.student_access(student_id,user_id,card_hash,openid_hash)
  select s.id,s.user_id,card,openid from club_private.students s where s.id=pupil.id
  on conflict(student_id) do update set user_id=excluded.user_id,card_hash=excluded.card_hash,openid_hash=excluded.openid_hash;
 end if;
 insert into club_private.audit(action,created_by,detail)
 values('provision_student',writer.id,jsonb_build_object('student_id',pupil.id,'link_issued',card is not null));
end $$;

create function club_private.resolve_student(payload jsonb) returns text
language sql stable security definer set search_path='' as $$
 select a.email::text
 from club_private.student_access k
 join club_private.students s on s.id=k.student_id and s.user_id=k.user_id
 join club_private.terms t on t.id=s.term_id
 join club_private.users u on u.id=s.user_id
 join auth.users a on a.id=u.id
 where k.card_hash=payload->>'card_hash' and k.openid_hash=payload->>'openid_hash'
 and s.class_name=payload->>'class_name' and ltrim(s.number,'0')=payload->>'number'
 and right(s.name,1)=payload->>'last_character'
 and t.status='active' and u.active and u.school_login and u.roles=array['stu']
 and a.deleted_at is null and (a.banned_until is null or a.banned_until<=now())
$$;

create function public.club_provision_student(payload jsonb) returns void
language sql security invoker set search_path='' as $$ select club_private.provision_student(payload) $$;
create function public.club_resolve_student(payload jsonb) returns text
language sql security invoker set search_path='' as $$ select club_private.resolve_student(payload) $$;
revoke all on function club_private.provision_student(jsonb),public.club_provision_student(jsonb),
 club_private.resolve_student(jsonb),public.club_resolve_student(jsonb) from public,anon,authenticated,service_role;
grant execute on function club_private.provision_student(jsonb),public.club_provision_student(jsonb) to authenticated;
grant execute on function club_private.resolve_student(jsonb),public.club_resolve_student(jsonb) to service_role;

create function club_private.portal_roles() returns trigger
language plpgsql set search_path='' as $$
begin
 if 'guardian'=any(new.roles) then raise exception '家長帳號已停止使用'; end if;
 if tg_op='UPDATE' and old.roles=array['stu'] and new.roles<>old.roles
    and exists(select 1 from club_private.students s join club_private.student_access k on k.student_id=s.id where s.user_id=old.id)
 then raise exception '學生請使用獨立的教職員帳號'; end if;
 return new;
end $$;
revoke all on function club_private.portal_roles() from public,anon,authenticated;
create trigger portal_login_roles before insert or update of roles on club_private.users
 for each row execute function club_private.portal_roles();

alter function club_private.snapshot() rename to snapshot_legacy;
alter function club_private.act(text,jsonb) rename to act_legacy;
alter function club_private.followup(text,jsonb) rename to followup_legacy;
alter function club_private.manage(text,jsonb) rename to manage_legacy;
revoke all on function club_private.snapshot_legacy(),club_private.act_legacy(text,jsonb),
 club_private.followup_legacy(text,jsonb),club_private.manage_legacy(text,jsonb) from public,anon,authenticated;

create function club_private.snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 actor club_private.users:=club_private.actor();
 result jsonb;
begin
 if actor.roles<>array['stu'] then
  result:=club_private.snapshot_legacy() - 'guardian_links';
  if 'admin'=any(actor.roles) then
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

create function club_private.act(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor club_private.users:=club_private.actor();
begin
 if actor.roles=array['stu'] and (action is distinct from 'enroll' or not exists(
  select 1 from club_private.clubs c join club_private.terms t on t.id=c.term_id
  where c.id=(payload->>'club_id')::uuid and t.status='active'
 )) then raise exception '學生僅能報名目前學期的社團'; end if;
 return club_private.act_legacy(action,payload);
end $$;

create function club_private.followup(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor club_private.users:=club_private.actor();
begin
 if actor.roles=array['stu'] then raise exception '此功能限教職員使用'; end if;
 return club_private.followup_legacy(action,payload);
end $$;

create function club_private.manage(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor club_private.users:=club_private.actor();
begin
 if actor.roles=array['stu'] or action in ('link_guardian','unlink_guardian','guardian_leave') then
  raise exception '此操作不適用於目前的入口';
 end if;
 return club_private.manage_legacy(action,payload);
end $$;

create or replace function public.club_snapshot() returns jsonb language sql security invoker set search_path='' as $$ select club_private.snapshot() $$;
create or replace function public.club_action(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select club_private.act(action,payload) $$;
create or replace function public.club_followup(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select club_private.followup(action,payload) $$;
create or replace function public.club_manage(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select club_private.manage(action,payload) $$;
revoke all on function club_private.snapshot(),club_private.act(text,jsonb),club_private.followup(text,jsonb),club_private.manage(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function club_private.snapshot(),club_private.act(text,jsonb),club_private.followup(text,jsonb),club_private.manage(text,jsonb) to authenticated;

create function club_calendar_private.active_classes() returns setof text
language sql stable security definer set search_path='' as $$
 select distinct s.class_name from club_private.students s join club_private.terms t on t.id=s.term_id
 join club_private.student_access a on a.student_id=s.id
 where t.status='active' order by s.class_name
$$;
create function public.club_student_classes() returns setof text
language sql stable security invoker set search_path='' as $$ select * from club_calendar_private.active_classes() $$;
revoke all on function club_calendar_private.active_classes(),public.club_student_classes() from public,anon,authenticated,service_role;
grant execute on function club_calendar_private.active_classes(),public.club_student_classes() to anon,authenticated;
