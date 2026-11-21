-- Keep original term IDs so all related records retain their history.
do $$
declare original club_private.terms;
begin
 perform pg_advisory_xact_lock(148975,1);
 if exists(select 1 from club_private.terms where name='115test') then
  raise exception '115test already exists; check term split before retrying';
 end if;
 select * into strict original from club_private.terms where name='115-1' and status='active' for update;
 if not exists(
  select 1 from club_private.users p join auth.users a on a.id=p.id where p.active and 'admin'=any(p.roles)
  and a.email not like '%@test.aimen.invalid' and a.email_confirmed_at is not null and a.deleted_at is null
  and (a.banned_until is null or a.banned_until<=now())
 ) then raise exception '至少需一個已啟用的正式行政帳號'; end if;
 update club_private.terms set name='115test',status='archived' where id=original.id;
 insert into club_private.terms(name,start_date,end_date) values('115-1',original.start_date,original.end_date);
 update club_private.users p set active=false from auth.users a
  where p.id=a.id and a.email like '%@test.aimen.invalid' and p.active;
end $$;
