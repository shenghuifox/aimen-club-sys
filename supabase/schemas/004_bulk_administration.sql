-- Keep application data behind the existing club_private authorization boundary.
create table club_private.pending_accounts (
 email text primary key,
 name text not null,
 role text not null check (role in ('stu','clubtr','hrtr')),
 student_id uuid unique references club_private.students(id),
 check ((role='stu') = (student_id is not null))
);
alter table club_private.pending_accounts enable row level security;
revoke all on club_private.pending_accounts from public, anon, authenticated;

create function club_private.admin_writer() returns club_private.users
language plpgsql set search_path='' as $$
declare actor club_private.users;
begin
 perform pg_advisory_xact_lock(148975,1);
 actor := club_private.actor();
 if not ('admin'=any(actor.roles)) then raise exception '僅行政管理者可操作'; end if;
 return actor;
end $$;
-- Do not expose staff login identifiers, student-facing financial fields, or
-- edit histories from other people's course-change requests.
create or replace function club_private.actor() returns club_private.users
language plpgsql stable security definer set search_path='' as $$
declare actor club_private.users;
begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 select p.* into actor from club_private.users p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.active and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now());
 if actor.id is null then raise exception '帳號尚未獲授權'; end if;
 return actor;
end $$;

create or replace function club_private.snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u club_private.users=club_private.actor(); a boolean; student_only boolean; result jsonb; begin
 a='admin'=any(u.roles);
 student_only=not (u.roles&&array['admin','clubtr','hrtr']::text[]);
 select jsonb_build_object(
 'users',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'username',case when a or x.id=u.id then x.username end,'name',x.name,'roles',x.roles)),'[]') from club_private.users x where x.active and (a or x.id=u.id or x.roles&&array['admin','clubtr','hrtr']::text[])),
 'terms',(select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc),'[]') from club_private.terms x),
 'clubs',(select coalesce(jsonb_agg(case when student_only then to_jsonb(x)-array['rate','funding_source'] else to_jsonb(x) end),'[]') from club_private.clubs x where a or x.status='published' or x.teacher_id=u.id),
 'students',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from club_private.students s where club_private.can_student(s,u)),
 'sessions',(select coalesce(jsonb_agg(case when student_only then to_jsonb(s)-array['rate','summary','signed_at','attendance_confirmed_at'] else to_jsonb(s) end order by s.starts_at),'[]') from club_private.sessions s join club_private.clubs c on c.id=s.club_id where a or c.status='published' or s.teacher_id=u.id or c.teacher_id=u.id),
 'enrollments',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from club_private.enrollments e join club_private.students s on s.id=e.student_id where club_private.can_student(s,u) and (a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or exists(select 1 from club_private.clubs where id=e.club_id and teacher_id=u.id and 'clubtr'=any(u.roles)))),
 'leaves',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from club_private.leaves l join club_private.students s on s.id=l.student_id join club_private.sessions se on se.id=l.session_id where a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])),
 'attendance',(select coalesce(jsonb_agg(to_jsonb(at)),'[]') from club_private.attendance at join club_private.students s on s.id=at.student_id join club_private.sessions se on se.id=at.session_id where a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])),
 'changes',(select coalesce(jsonb_agg(case when a or x.created_by=u.id then to_jsonb(x)
    else to_jsonb(x)-array['edit_history','rate','reviewed_by'] end order by x.created_at desc),'[]')
    from club_private.changes x join club_private.clubs c on c.id=x.club_id
    where a or x.created_by=u.id or (x.status='approved' and x.kind not in ('add_student','remove_student')
      and (c.status='published' or c.teacher_id=u.id))),
 'pending_accounts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.email),'[]') from club_private.pending_accounts p where a),
 'settlements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from club_private.settlements x where a),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from club_private.audit where a order by created_at desc limit 100) x)
 ) into result; return result;
end $$;

create function club_private.bind_imported_account(account_id uuid, entry club_private.pending_accounts)
returns void language plpgsql set search_path='' as $$
declare profile club_private.users;
begin
 select * into profile from club_private.users where id=account_id;
 if found then
  if not profile.active or not (entry.role=any(profile.roles)) then
   raise exception '既有帳號未啟用，或與匯入角色不一致';
  end if;
 else
  insert into club_private.users(id,username,name,roles)
  values(account_id,entry.email,entry.name,array[entry.role]);
 end if;
 if entry.student_id is not null then
  update club_private.students s set user_id=account_id
  from club_private.terms t
  where s.id=entry.student_id and t.id=s.term_id and t.status='active'
    and (s.user_id is null or s.user_id=account_id);
  if not found then raise exception '學生已綁定其他帳號，或學期已封存'; end if;
 end if;
end $$;

create function club_private.import_accounts(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor club_private.users := club_private.admin_writer();
 selected_term uuid := (payload->>'term_id')::uuid;
 line jsonb;
 entry club_private.pending_accounts;
 target uuid;
 seen_emails text[] := '{}';
 seen_students uuid[] := '{}';
 line_no integer := 0;
 bound_count integer := 0;
 pending_count integer := 0;
begin
 if jsonb_typeof(payload->'rows') is distinct from 'array' then raise exception '請提供帳號清單'; end if;
 if jsonb_array_length(payload->'rows') not between 1 and 200 then raise exception '每批可匯入 1 至 200 筆'; end if;
 for line in select value from jsonb_array_elements(payload->'rows') loop
  line_no := line_no+1;
  begin
   entry.email := lower(btrim(coalesce(line->>'email','')));
   entry.name := btrim(coalesce(line->>'name',''));
   entry.role := coalesce(line->>'role','');
   entry.student_id := null;
   if length(entry.email)>254 or entry.email !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
      or length(entry.name) not between 1 and 100 or entry.role not in ('stu','clubtr','hrtr') then
    raise exception '請核對帳號、姓名與角色';
   end if;
   if entry.email=any(seen_emails) then raise exception '清單內帳號重複'; end if;
   seen_emails := array_append(seen_emails,entry.email);
   if entry.role='stu' then
    select s.id into entry.student_id
    from club_private.students s join club_private.terms t on t.id=s.term_id
    where s.term_id=selected_term and t.status='active'
     and s.class_name=btrim(line->>'class_name') and s.number=btrim(line->>'number') and s.name=entry.name;
    if entry.student_id is null then raise exception '找不到符合該學期、班級、座號及姓名的學生'; end if;
    if entry.student_id=any(seen_students) then raise exception '清單內同一名學生重複'; end if;
    seen_students := array_append(seen_students,entry.student_id);
    if exists(select 1 from club_private.pending_accounts p where p.student_id=entry.student_id and p.email<>entry.email)
       then raise exception '該學生已有其他待啟用帳號'; end if;
   elsif coalesce(btrim(line->>'class_name'),'')<>'' or coalesce(btrim(line->>'number'),'')<>'' then
    raise exception '教師帳號的班級及座號請留空';
   end if;
   if exists(select 1 from club_private.pending_accounts p where p.email=entry.email
     and (p.role<>entry.role or p.student_id is distinct from entry.student_id)) then
    raise exception '此帳號已有不同的待啟用設定，請先取消舊設定';
   end if;
   select u.id into strict target from auth.users u
   where lower(u.email)=entry.email and u.email_confirmed_at is not null
     and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
   perform club_private.bind_imported_account(target,entry);
   delete from club_private.pending_accounts p where p.email=entry.email;
   bound_count := bound_count+1;
  exception when no_data_found then
   if entry.email like '%@%.invalid' then
    raise exception '第 % 筆：找不到已建立的測試帳號',line_no;
   end if;
   if entry.student_id is not null and exists(
     select 1 from club_private.students where id=entry.student_id and user_id is not null
   ) then raise exception '第 % 筆：學生已綁定帳號',line_no; end if;
   insert into club_private.pending_accounts(email,name,role,student_id)
   values(entry.email,entry.name,entry.role,entry.student_id)
   on conflict(email) do update set name=excluded.name;
   pending_count := pending_count+1;
  when unique_violation or too_many_rows then
   raise exception '第 % 筆：帳號或學生綁定重複',line_no;
  when raise_exception then
   raise exception '第 % 筆：%',line_no,sqlerrm;
  end;
 end loop;
 insert into club_private.audit(action,created_by) values('import_accounts',actor.id);
 return jsonb_build_object('bound',bound_count,'pending',pending_count);
end $$;

create function club_private.cancel_account(payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor club_private.users := club_private.admin_writer();
begin
 delete from club_private.pending_accounts where email=payload->>'email';
 if not found then raise exception '此待啟用帳號已不存在，請重新整理'; end if;
 insert into club_private.audit(action,created_by) values('cancel_account',actor.id);
end $$;

create function club_private.claim_account()
returns void language plpgsql security definer set search_path='' as $$
declare
 account_id uuid := auth.uid();
 entry club_private.pending_accounts;
begin
 if account_id is null then raise exception '請先登入'; end if;
 if exists(select 1 from club_private.users where id=account_id) then return; end if;
 perform pg_advisory_xact_lock(148975,1);
 select p.* into entry
 from auth.users u join club_private.pending_accounts p on p.email=lower(u.email)
 where u.id=account_id and u.email_confirmed_at is not null
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
   and not exists(select 1 from club_private.users where id=account_id);
 if not found then return; end if;
 perform club_private.bind_imported_account(account_id,entry);
 delete from club_private.pending_accounts where email=entry.email;
 insert into club_private.audit(action,created_by) values('claim_account',account_id);
end $$;

create function club_private.batch_roster(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor club_private.users := club_private.admin_writer();
 cid uuid := (payload->>'club_id')::uuid;
 effective date := (payload->>'effective_date')::date;
 operation text := coalesce(payload->>'operation','');
 reason text := btrim(coalesce(payload->>'reason',''));
 target uuid;
 row_count integer := 0;
 label text;
begin
 if operation not in ('enrolled','rejected','add_student','remove_student') then raise exception '名冊操作不正確'; end if;
 if jsonb_typeof(payload->'ids') is distinct from 'array' then raise exception '請選擇要處理的學生'; end if;
 if jsonb_array_length(payload->'ids') not between 1 and 200 then raise exception '每批可處理 1 至 200 筆'; end if;
 if (select count(distinct id::uuid) from jsonb_array_elements_text(payload->'ids') a(id))<>jsonb_array_length(payload->'ids')
    then raise exception '請移除空白或重複的學生'; end if;
 perform club_private.assert_open(cid);
 if operation<>'rejected' then
  if not exists(
   select 1 from club_private.clubs c join club_private.terms t on t.id=c.term_id
   where c.id=cid and effective between t.start_date and t.end_date
  ) then raise exception '生效日期須在社團所屬學期內'; end if;
  if exists(select 1 from club_private.sessions s where s.club_id=cid and s.status<>'cancelled'
    and (s.signed_at is not null or s.status='completed')
    and (s.starts_at at time zone 'Asia/Taipei')::date>=effective)
    then raise exception '生效日會影響已簽到或授課的課程，請選擇較晚日期'; end if;
 end if;
 if operation in ('add_student','remove_student') and length(reason) not between 1 and 300 then
  raise exception '請填寫 1 至 300 字的異動原因';
 end if;
 for target in select id::uuid from jsonb_array_elements_text(payload->'ids') a(id) loop
  label := null;
  begin
   if operation in ('enrolled','rejected') then
    select s.name into label from club_private.enrollments e join club_private.students s on s.id=e.student_id
     where e.id=target and e.club_id=cid and e.status='pending';
    if not found then raise exception '有報名已處理或不屬於選定社團，請重新整理'; end if;
    if operation='rejected' then
     update club_private.enrollments set status='rejected' where id=target;
     insert into club_private.audit(action,created_by) values('admit',actor.id);
    else
     perform club_private.act('admit',jsonb_build_object('id',target,'status',operation,'start_date',effective));
    end if;
   else
    select s.name into label from club_private.students s join club_private.clubs c on c.term_id=s.term_id
     where s.id=target and c.id=cid;
    if not found then raise exception '學生不在選定社團的學期名冊'; end if;
    perform club_private.act('change',jsonb_build_object(
     'club_id',cid,'student_id',target,'kind',operation,'effective_date',effective,'reason',reason));
   end if;
   row_count := row_count+1;
  exception when raise_exception then
   raise exception '第 % 筆%：%',row_count+1,coalesce('（'||label||'）',''),sqlerrm;
  end;
 end loop;
 return jsonb_build_object('count',row_count);
end $$;

-- Count each possible future enrollment boundary. A newly approved enrollment
-- stays active until explicitly ended, including alongside future reservations.
create or replace function club_private.admit_check(cid uuid, sid uuid, effective date, excluded uuid default null)
returns void language plpgsql set search_path='' as $$
declare c club_private.clubs;
begin
 select * into c from club_private.clubs where id=cid;
 if not exists(select 1 from club_private.students where id=sid and term_id=c.term_id)
 then raise exception '學生與社團學期不符'; end if;
 if exists (
  select 1 from (
   select effective as day
   union select start_date from club_private.enrollments
     where club_id=cid and status='enrolled' and start_date>effective
  ) days
  where (select count(*) from club_private.enrollments e where e.club_id=cid and e.status='enrolled'
     and e.id is distinct from excluded and days.day between e.start_date and coalesce(e.end_date,'infinity'))>=c.capacity
 ) then raise exception '社團名額已滿（含未來已登記名額）'; end if;
 if exists(
  select 1 from club_private.sessions a
  join club_private.sessions b on b.starts_at<a.ends_at and b.ends_at>a.starts_at
  join club_private.enrollments e on e.club_id=b.club_id
  where a.club_id=cid and b.club_id<>cid and e.student_id=sid and e.status='enrolled'
    and a.status<>'cancelled' and b.status<>'cancelled'
    and (a.starts_at at time zone 'Asia/Taipei')::date>=effective
    and (b.starts_at at time zone 'Asia/Taipei')::date between e.start_date and coalesce(e.end_date,'infinity')
 ) then raise exception '學生已有同時段課程'; end if;
end $$;

create or replace function club_private.apply_change(change_id uuid) returns void language plpgsql set search_path='' as $$
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
   select * into e from club_private.enrollments where club_id=c.club_id and student_id=c.student_id and status='enrolled' and start_date<=c.effective_date and (end_date is null or end_date>=c.effective_date) order by start_date desc limit 1;
   if e.id is null then raise exception '找不到有效參加紀錄或退出日不正確'; end if;
   if e.start_date=c.effective_date then
    if exists(select 1 from club_private.sessions se where se.club_id=c.club_id and se.status<>'cancelled'
      and (se.starts_at at time zone 'Asia/Taipei')::date between e.start_date and coalesce(e.end_date,'infinity')
      and (se.signed_at is not null or se.status='completed'
        or exists(select 1 from club_private.attendance a where a.session_id=se.id and a.student_id=c.student_id))
    ) then raise exception '已有簽到或點名，無法取消自加入日起的紀錄'; end if;
    update club_private.enrollments set status='withdrawn' where id=e.id;
   else
    update club_private.enrollments set end_date=c.effective_date-1 where id=e.id;
   end if;
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

create function public.club_import_accounts(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select club_private.import_accounts(payload) $$;
create function public.club_cancel_account(payload jsonb) returns void
language sql security invoker set search_path='' as $$ select club_private.cancel_account(payload) $$;
create function public.club_claim_account() returns void
language sql security invoker set search_path='' as $$ select club_private.claim_account() $$;
create function public.club_batch_roster(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select club_private.batch_roster(payload) $$;

revoke all on function club_private.admin_writer(),club_private.bind_imported_account(uuid,club_private.pending_accounts),
 club_private.import_accounts(jsonb),club_private.cancel_account(jsonb),club_private.claim_account(),
 club_private.batch_roster(jsonb),public.club_import_accounts(jsonb),public.club_cancel_account(jsonb),
 public.club_claim_account(),public.club_batch_roster(jsonb) from public,anon,authenticated;
grant execute on function club_private.import_accounts(jsonb),club_private.cancel_account(jsonb),
 club_private.claim_account(),club_private.batch_roster(jsonb),public.club_import_accounts(jsonb),
 public.club_cancel_account(jsonb),public.club_claim_account(),public.club_batch_roster(jsonb) to authenticated;

-- Supabase's existing DDL event trigger keeps its owner privileges.
do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  execute 'revoke execute on function public.rls_auto_enable() from public,anon,authenticated';
 end if;
end $$;
