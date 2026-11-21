create function club_private.verified_admin_email(account_id uuid) returns text
language sql stable security invoker set search_path='' as $$
 select a.email::text from auth.users a where a.id=account_id and a.email_confirmed_at is not null
 and a.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and a.email !~* '\.invalid$'
 and a.deleted_at is null and (a.banned_until is null or a.banned_until<=now())
$$;
revoke all on function club_private.verified_admin_email(uuid) from public,anon,authenticated,service_role;

create or replace function club_private.actor() returns club_private.users
language plpgsql stable security definer set search_path='' as $$
declare actor club_private.users;
begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 select p.* into actor from club_private.users p join auth.users u on u.id=p.id
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

create function club_private.admin_email_required() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if 'admin'=any(new.roles) and new.active and club_private.verified_admin_email(new.id) is null
 then raise exception '請以已驗證的 Email 帳號授予行政權限'; end if;
 return new;
end $$;
revoke all on function club_private.admin_email_required() from public,anon,authenticated,service_role;
create trigger verify_administrator_email before insert or update of roles,active on club_private.users
 for each row execute function club_private.admin_email_required();

create function club_private.admin_reset_email(account_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare
 writer club_private.users:=club_private.admin_writer();
 email text;
begin
 select club_private.verified_admin_email(p.id) into email from club_private.users p
 where p.id=account_id and p.active and 'admin'=any(p.roles);
 if email is null then raise exception '目標行政帳號尚未完成 Email 驗證'; end if;
 insert into club_private.audit(action,created_by,detail)
 values('request_admin_reset',writer.id,jsonb_build_object('id',account_id));
 return email;
end $$;

create function club_private.teacher_activation_email(p_username text,p_digest text) returns text
language sql stable security definer set search_path='' as $$
 select a.email::text from club_private.users p join auth.users a on a.id=p.id
 where p.username=p_username and p.active and p.school_login and p.must_change_password
 and p.roles&&array['hrtr','clubtr'] and not ('admin'=any(p.roles))
 and a.raw_app_meta_data->>'aimen_teacher_setup'=p_digest and a.deleted_at is null
 and (a.banned_until is null or a.banned_until<=now())
$$;

create function club_private.require_teacher_password(account_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update club_private.users set must_change_password=true where id=account_id and active
 and school_login and roles&&array['hrtr','clubtr'] and not ('admin'=any(roles));
 if not found then raise exception '此帳號不支援發行教師初始密碼'; end if;
end $$;

create function public.club_admin_reset_email(account_id uuid) returns text
language sql security invoker set search_path='' as $$ select club_private.admin_reset_email(account_id) $$;
create function public.club_teacher_activation_email(p_username text,p_digest text) returns text
language sql security invoker set search_path='' as $$ select club_private.teacher_activation_email(p_username,p_digest) $$;
create function public.club_require_teacher_password(account_id uuid) returns void
language sql security invoker set search_path='' as $$ select club_private.require_teacher_password(account_id) $$;
revoke all on function club_private.admin_reset_email(uuid),public.club_admin_reset_email(uuid),
 club_private.teacher_activation_email(text,text),public.club_teacher_activation_email(text,text),
 club_private.require_teacher_password(uuid),public.club_require_teacher_password(uuid)
 from public,anon,authenticated,service_role;
grant execute on function club_private.admin_reset_email(uuid),public.club_admin_reset_email(uuid) to authenticated;
grant execute on function club_private.teacher_activation_email(text,text),public.club_teacher_activation_email(text,text),
 club_private.require_teacher_password(uuid),public.club_require_teacher_password(uuid) to service_role;
