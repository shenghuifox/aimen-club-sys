alter table club_private.users
 add column school_login boolean not null default false,
 add column must_change_password boolean not null default false,
 add column school_password_changed_at timestamptz;

create or replace function club_private.actor() returns club_private.users
language plpgsql stable security definer set search_path='' as $$
declare actor club_private.users;
begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 select p.* into actor from club_private.users p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.active and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now());
 if actor.id is null then raise exception '帳號尚未獲授權'; end if;
 if actor.must_change_password then raise exception '首次登入請先更改密碼'; end if;
 if actor.school_password_changed_at is not null and not exists(
  select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid
   and s.user_id=actor.id and s.created_at>=actor.school_password_changed_at
 ) then raise exception '密碼已更新，請重新登入'; end if;
 return actor;
end $$;

create function club_private.register_school_account(payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
 actor club_private.users:=club_private.admin_writer();
 target uuid:=(payload->>'id')::uuid;
 pupil uuid:=nullif(payload->>'student_id','')::uuid;
 account text:=lower(btrim(coalesce(payload->>'username','')));
 full_name text:=btrim(coalesce(payload->>'name',''));
 chosen_role text:=coalesce(payload->>'role','');
begin
 if account !~ '^[a-z0-9][a-z0-9_-]{1,39}$' or length(full_name) not between 1 and 100
    or chosen_role not in ('stu','guardian','clubtr','hrtr','admin')
 then raise exception '請核對帳號、姓名與角色'; end if;
 if not exists(select 1 from auth.users a
  where a.id=target and lower(a.email)=account||'@accounts.aimen.invalid'
    and a.email_confirmed_at is not null and a.deleted_at is null
    and a.raw_app_meta_data->>'aimen_issued_by'=actor.id::text)
 then raise exception '此登入帳號不是由帳號服務建立'; end if;
 if exists(select 1 from club_private.users where lower(username)=account)
 then raise exception '此帳號名稱已被使用'; end if;
 if chosen_role in ('stu','guardian') and not exists(
  select 1 from club_private.students s join club_private.terms t on t.id=s.term_id
  where s.id=pupil and t.status='active' and (chosen_role='guardian' or s.user_id is null)
 ) then raise exception '請選擇有效學生；學生帳號不能重複綁定'; end if;
 insert into club_private.users(id,username,name,roles,school_login,must_change_password)
 values(target,account,full_name,array[chosen_role],true,chosen_role in ('clubtr','hrtr','admin'));
 if chosen_role='stu' then
  update club_private.students set user_id=target where id=pupil and user_id is null;
  if not found then raise exception '學生帳號不能重複綁定'; end if;
 elsif chosen_role='guardian' then
  insert into club_private.guardian_links(guardian_id,student_id) values(target,pupil);
 end if;
 insert into club_private.audit(action,created_by,detail)
 values('register_school_account',actor.id,jsonb_build_object('id',target,'role',chosen_role));
end $$;

create function club_private.school_password_required() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from club_private.users u join auth.users a on a.id=u.id
 where u.id=auth.uid() and u.active and u.school_login and u.must_change_password
   and a.deleted_at is null and (a.banned_until is null or a.banned_until<=now()))
$$;

create function club_private.complete_school_password(account_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(148975,1);
 update club_private.users set must_change_password=false,school_password_changed_at=clock_timestamp()
  where id=account_id and active and school_login and must_change_password;
 if not found then raise exception '帳號無法完成首次密碼設定'; end if;
 insert into club_private.audit(action,created_by,detail)
 values('complete_school_password',account_id,'{}'::jsonb);
end $$;

create function public.club_complete_school_password(account_id uuid) returns void
language sql security invoker set search_path='' as $ select club_private.complete_school_password(account_id) $;

create function club_private.keep_school_username() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.school_login and new.username is distinct from old.username
 then raise exception '校用帳號為登入識別碼，請維護姓名欄位'; end if;
 if old.school_login and not(old.roles&&array['admin','clubtr','hrtr'])
    and new.roles&&array['admin','clubtr','hrtr'] then new.must_change_password:=true; end if;
 return new;
end $$;
create trigger school_username_immutable before update of username,roles on club_private.users
 for each row execute function club_private.keep_school_username();

create function public.club_register_school_account(payload jsonb) returns void
language sql security invoker set search_path='' as $$ select club_private.register_school_account(payload) $$;
create function public.club_school_password_required() returns boolean
language sql security invoker set search_path='' as $$ select club_private.school_password_required() $$;

revoke all on function club_private.register_school_account(jsonb),public.club_register_school_account(jsonb),
 club_private.school_password_required(),public.club_school_password_required(),
 club_private.complete_school_password(uuid),public.club_complete_school_password(uuid),
 club_private.keep_school_username() from public,anon,authenticated,service_role;
grant execute on function club_private.register_school_account(jsonb),public.club_register_school_account(jsonb),
 club_private.school_password_required(),public.club_school_password_required() to authenticated;
grant execute on function club_private.complete_school_password(uuid),public.club_complete_school_password(uuid) to service_role;
