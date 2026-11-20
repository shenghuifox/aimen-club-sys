alter table club_private.pending_accounts drop constraint pending_accounts_role_check,
 add constraint pending_accounts_role_check check(role in ('stu','clubtr','hrtr','admin'));

-- Single-record administrative grants use the same verified-email claim as
-- other accounts. The bulk importer retains its narrower role allowlist.
create function club_private.prepare_admin_account(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor club_private.users := club_private.admin_writer();
 target uuid;
 profile club_private.users;
 address text:=lower(btrim(coalesce(payload->>'email','')));
 full_name text:=btrim(coalesce(payload->>'name',''));
begin
 if length(address)>254 or address !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
    or length(full_name) not between 1 and 100
    or btrim(coalesce(payload->>'class_name',''))<>'' or btrim(coalesce(payload->>'number',''))<>''
 then raise exception '請核對行政電子郵件與姓名，班級與座號請留空'; end if;

 if exists(select 1 from club_private.pending_accounts p where p.email=address and p.role<>'admin')
 then raise exception '此電子郵件已有其他待啟用角色，請先取消舊設定'; end if;

 select auth_user.id into target from auth.users auth_user
 where lower(auth_user.email)=address and auth_user.email_confirmed_at is not null
   and auth_user.deleted_at is null and (auth_user.banned_until is null or auth_user.banned_until<=now());
 if target is not null then
  select * into profile from club_private.users where id=target;
  if not found then
   insert into club_private.users(id,username,name,roles) values(target,address,full_name,array['admin']);
  elsif not profile.active or 'guardian'=any(profile.roles) then
   raise exception '帳號已停權或屬於家長，請使用校方管理帳號';
  elsif not ('admin'=any(profile.roles)) then
   update club_private.users set roles=array_append(roles,'admin') where id=target;
  end if;
  delete from club_private.pending_accounts where email=address;
 else
  if address like '%@%.invalid' then raise exception '請使用可收信的校方帳號'; end if;
  if exists(select 1 from auth.users a join club_private.users u on u.id=a.id where lower(a.email)=address)
  then raise exception '既有帳號須完成電子郵件驗證且未停權'; end if;
  insert into club_private.pending_accounts(email,name,role) values(address,full_name,'admin')
  on conflict(email) do update set name=excluded.name;
 end if;
 insert into club_private.audit(action,created_by,detail)
 values('prepare_admin_account',actor.id,jsonb_build_object('id',target));
 return jsonb_build_object('bound',case when target is not null then 1 else 0 end,
                           'pending',case when target is null then 1 else 0 end);
end $$;

create function public.club_prepare_admin_account(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select club_private.prepare_admin_account(payload) $$;
revoke all on function club_private.prepare_admin_account(jsonb),public.club_prepare_admin_account(jsonb) from public,anon,authenticated;
grant execute on function club_private.prepare_admin_account(jsonb),public.club_prepare_admin_account(jsonb) to authenticated;
