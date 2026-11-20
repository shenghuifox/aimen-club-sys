alter table club_private.enrollments drop constraint enrollments_status_check,
 add constraint enrollments_status_check check(status in ('pending','enrolled','rejected','withdrawn','waitlisted')),
 add column fee_status text check(fee_status in ('pending','paid','overdue'));
drop index club_private.enrollment_open_unique;
create unique index enrollment_open_unique on club_private.enrollments(club_id,student_id)
 where status in ('pending','enrolled','waitlisted') and end_date is null;

alter table club_private.changes drop constraint changes_kind_check,
 add constraint changes_kind_check check(kind in ('add_student','remove_student','reschedule','weekly') or (kind in ('cancel','makeup','swap') and status='approved'));

create table club_private.voided_settlements (
 like club_private.settlements including defaults including constraints,
 primary key(id),
 voided_at timestamptz not null default now(),
 voided_by uuid not null references club_private.users(id),
 void_reason text not null
);
alter table club_private.voided_settlements enable row level security;
revoke all on club_private.voided_settlements from public, anon, authenticated;

create or replace function club_private.batch_roster(payload jsonb)
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
 if operation not in ('enrolled','rejected','waitlisted','add_student','remove_student') then raise exception '名冊操作不正確'; end if;
 if jsonb_typeof(payload->'ids') is distinct from 'array' then raise exception '請選擇要處理的學生'; end if;
 if jsonb_array_length(payload->'ids') not between 1 and 200 then raise exception '每批可處理 1 至 200 筆'; end if;
 if (select count(distinct id::uuid) from jsonb_array_elements_text(payload->'ids') a(id))<>jsonb_array_length(payload->'ids')
    then raise exception '請移除空白或重複的學生'; end if;
 perform club_private.assert_open(cid);
 if operation not in ('rejected','waitlisted') then
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
   if operation in ('enrolled','rejected','waitlisted') then
    select s.name into label from club_private.enrollments e join club_private.students s on s.id=e.student_id
     where e.id=target and e.club_id=cid and e.status in ('pending','waitlisted') and e.status<>operation;
    if not found then raise exception '有報名已處理或不屬於選定社團，請重新整理'; end if;
    if operation<>'enrolled' then
     update club_private.enrollments set status=operation where id=target;
     insert into club_private.audit(action,created_by) values('admit',actor.id);
    else
     update club_private.enrollments set status='pending' where id=target and status='waitlisted';
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
  exception when raise_exception or unique_violation then
   raise exception '第 % 筆%：%',row_count+1,coalesce('（'||label||'）',''),sqlerrm;
  end;
 end loop;
 return jsonb_build_object('count',row_count);
end $$;

create or replace function club_private.snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u club_private.users=club_private.actor(); a boolean; student_only boolean; result jsonb; begin
 a='admin'=any(u.roles);
 student_only=not (u.roles&&array['admin','clubtr','hrtr']::text[]);
 with assigned_enrollments as (
  select e.id,e.student_id from club_private.enrollments e
  where e.status='enrolled' and u.roles&&array['clubtr','hrtr']::text[]
   and exists(select 1 from club_private.sessions s where s.club_id=e.club_id and s.teacher_id=u.id
     and s.status<>'cancelled' and (s.starts_at at time zone 'Asia/Taipei')::date between e.start_date and coalesce(e.end_date,'infinity'))
 )
 select jsonb_build_object(
 'users',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'username',case when a or x.id=u.id then x.username end,'name',x.name,'roles',x.roles)),'[]') from club_private.users x where x.active and (a or x.id=u.id or x.roles&&array['admin','clubtr','hrtr']::text[])),
 'terms',(select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc),'[]') from club_private.terms x),
 'clubs',(select coalesce(jsonb_agg(case when student_only then to_jsonb(x)-array['rate','funding_source'] else to_jsonb(x) end),'[]') from club_private.clubs x where a or x.status='published' or x.teacher_id=u.id),
 'students',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from club_private.students s
   where club_private.can_student(s,u) or exists(select 1 from assigned_enrollments where student_id=s.id)),
 'sessions',(select coalesce(jsonb_agg(case when student_only then to_jsonb(s)-array['rate','summary','signed_at','attendance_confirmed_at'] else to_jsonb(s) end order by s.starts_at),'[]') from club_private.sessions s join club_private.clubs c on c.id=s.club_id where a or c.status='published' or s.teacher_id=u.id or c.teacher_id=u.id),
 'enrollments',(select coalesce(jsonb_agg(case when a or s.user_id=u.id or s.homeroom_id=u.id
      then to_jsonb(e) else to_jsonb(e)-'fee_status' end),'[]')
   from club_private.enrollments e join club_private.students s on s.id=e.student_id
   where (club_private.can_student(s,u) and (a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles))
       or exists(select 1 from club_private.clubs where id=e.club_id and teacher_id=u.id and 'clubtr'=any(u.roles))))
      or exists(select 1 from assigned_enrollments where id=e.id)),
 'leaves',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from club_private.leaves l join club_private.students s on s.id=l.student_id join club_private.sessions se on se.id=l.session_id where a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])),
 'attendance',(select coalesce(jsonb_agg(to_jsonb(at)),'[]') from club_private.attendance at join club_private.students s on s.id=at.student_id join club_private.sessions se on se.id=at.session_id where a or s.user_id=u.id or (s.homeroom_id=u.id and 'hrtr'=any(u.roles)) or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])),
 'changes',(select coalesce(jsonb_agg(case when a or x.created_by=u.id then to_jsonb(x)
    else to_jsonb(x)-array['edit_history','rate','reviewed_by'] end order by x.created_at desc),'[]')
    from club_private.changes x join club_private.clubs c on c.id=x.club_id
    where a or x.created_by=u.id or (x.status='approved' and x.kind not in ('add_student','remove_student')
      and (c.status='published' or c.teacher_id=u.id))),
 'pending_accounts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.email),'[]') from club_private.pending_accounts p where a),
 'settlements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from club_private.settlements x where a),
 'voided_settlements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.voided_at desc),'[]') from club_private.voided_settlements x where a),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from club_private.audit where a order by created_at desc limit 100) x)
 ) into result; return result;
end $$;

create function club_private.operations(action text,payload jsonb)
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
       or exists(select 1 from club_private.leaves where session_id in (source.id,other.id) and status<>'rejected')
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

-- Keep the application function in the private schema and expose only an invoker wrapper.
create function public.club_operations(action text,payload jsonb) returns void
language sql security invoker set search_path='' as $$ select club_private.operations(action,payload) $$;
revoke all on function club_private.operations(text,jsonb),public.club_operations(text,jsonb) from public,anon,authenticated;
grant execute on function club_private.operations(text,jsonb),public.club_operations(text,jsonb) to authenticated;

create or replace function public.club_batch_roster(payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if payload->'preview' is distinct from 'true'::jsonb then
  return club_private.batch_roster(payload);
 end if;
 begin
  result:=club_private.batch_roster(payload);
  raise sqlstate 'CL005';
 exception when sqlstate 'CL005' then
  return result;
 end;
end $$;
