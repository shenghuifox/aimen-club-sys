-- Run AFTER 001_club.sql and AFTER creating these four Auth users in Dashboard.
-- No passwords are stored in this file. The transaction fails if any is missing.
begin;
do $$
declare item record; account_id uuid;
begin
 for item in select * from (values
  ('admin','行政測試',array['admin']::text[]),
  ('stu','學生測試',array['stu']::text[]),
  ('clubtr','社團老師測試',array['clubtr']::text[]),
  ('hrtr','班級導師測試',array['hrtr']::text[])
 ) as accounts(username,display_name,roles) loop
  select id into account_id from auth.users where lower(email)=item.username||'@test.aimen.invalid';
  if account_id is null then raise exception '尚未建立 Auth 帳號：%@test.aimen.invalid',item.username; end if;
  if exists(select 1 from club_private.users where username=item.username and id<>account_id) then raise exception '帳號標籤已被其他使用者使用：%',item.username; end if;
  insert into club_private.users(id,username,name,roles) values(account_id,item.username,item.display_name,item.roles)
  on conflict(id) do nothing;
 end loop;
end $$;
commit;
select username,name,roles from club_private.users where username in ('admin','stu','clubtr','hrtr') order by username;
