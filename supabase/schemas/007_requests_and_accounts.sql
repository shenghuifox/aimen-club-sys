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


create or replace function club_private.act(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u club_private.users=club_private.actor(); a boolean; c club_private.clubs; s club_private.students; se club_private.sessions; l club_private.leaves; e club_private.enrollments; target club_private.users; ch club_private.changes;
 cid uuid=nullif(payload->>'club_id','')::uuid; sid uuid=nullif(payload->>'student_id','')::uuid; seid uuid=nullif(payload->>'session_id','')::uuid; rid uuid=nullif(payload->>'id','')::uuid;
 d date=(now() at time zone 'Asia/Taipei')::date; first_day date; last_day date; reviewed boolean; out_id uuid; rows jsonb; teachers jsonb; snap jsonb; total numeric; units numeric; mark text; v_roles text[];
begin
 a='admin'=any(u.roles);
 -- Serialize first-release mutations, including enrollment capacity, approvals,
 -- role count and settlement locks. No network calls occur in this transaction.
 perform pg_advisory_xact_lock(148975,1);
 if action in ('admit','save_club','publish_club','add_session','review_change','settle','paper_done','roles','add_term','archive_term','add_student') and not a then raise exception '僅行政管理者可操作'; end if;
 select * into c from club_private.clubs where id=cid;
 select * into s from club_private.students where id=sid;
 select * into se from club_private.sessions where id=seid;
 if action='leave' then
  if s.id is null or se.id is null or not club_private.can_student(s,u) then raise exception '沒有學生或課程的操作權限'; end if;
  if not a and s.user_id is distinct from u.id and not coalesce((s.homeroom_id=u.id and 'hrtr'=any(u.roles)),false) and not exists(select 1 from club_private.clubs where id=se.club_id and teacher_id=u.id and 'clubtr'=any(u.roles)) then raise exception '沒有該社團的請假權限'; end if;
  perform club_private.assert_open(se.club_id);
  if not exists(select 1 from club_private.enrollments where club_id=se.club_id and student_id=s.id and status='enrolled' and (se.starts_at at time zone 'Asia/Taipei')::date between start_date and coalesce(end_date,'infinity')) then raise exception '學生未參加該次課程'; end if;
  reviewed=a or coalesce((s.homeroom_id=u.id and 'hrtr'=any(u.roles)),false);
  insert into club_private.leaves(session_id,student_id,kind,reason,status,created_by,reviewed_by,reviewed_at) values(se.id,s.id,payload->>'kind',payload->>'reason',case when reviewed then 'approved' else 'pending' end,u.id,case when reviewed then u.id end,case when reviewed then now() end) returning id into out_id;
 elsif action='review_leave' then
  select * into l from club_private.leaves where id=rid; select * into s from club_private.students where id=l.student_id;
  if l.id is null or not coalesce((a or (s.homeroom_id=u.id and 'hrtr'=any(u.roles))),false) then raise exception '沒有覆核權限'; end if;
  if l.status<>'pending' or coalesce(payload->>'status','') not in ('approved','rejected') then raise exception '申請已處理或狀態不正確'; end if;
  perform club_private.assert_open((select club_id from club_private.sessions where id=l.session_id));
  update club_private.leaves set status=payload->>'status',reviewed_by=u.id,reviewed_at=now() where id=l.id;
 elsif action='enroll' then
  if c.id is null or s.id is null or not coalesce((a or (s.user_id=u.id and 'stu'=any(u.roles))),false) or s.term_id<>c.term_id then raise exception '沒有報名權限'; end if;
  perform club_private.assert_open(c.id);
  if not a and (c.status<>'published' or d not between c.registration_start and c.registration_end) then raise exception '目前不在報名期間'; end if;
  insert into club_private.enrollments(club_id,student_id,status,start_date) values(c.id,s.id,'pending',d) returning id into out_id;
 elsif action='admit' then
  select * into e from club_private.enrollments where id=rid;
  if e.id is null or e.status<>'pending' or coalesce(payload->>'status','') not in ('enrolled','rejected') then raise exception '報名不存在或已處理'; end if;
  first_day=coalesce(nullif(payload->>'start_date','')::date,d); perform club_private.assert_open(e.club_id,first_day);
  if exists(select 1 from club_private.settlements where club_id=e.club_id and end_date>=first_day) then raise exception '錄取會影響已鎖定期間'; end if;
  if payload->>'status'='enrolled' then perform club_private.admit_check(e.club_id,e.student_id,first_day,e.id); end if;
  update club_private.enrollments set status=payload->>'status',start_date=first_day where id=e.id;
 elsif action in ('sign_in','attendance') then
  if se.id is null or not(a or (se.teacher_id=u.id and u.roles&&array['clubtr','hrtr']::text[])) then raise exception '沒有授課權限'; end if;
  perform club_private.assert_open(se.club_id,(se.starts_at at time zone 'Asia/Taipei')::date);
  if se.status='cancelled' then raise exception '課程已停課'; end if;
  if date_trunc('week',se.starts_at at time zone 'Asia/Taipei')::date<>date_trunc('week',d::timestamp)::date
     or (se.starts_at at time zone 'Asia/Taipei')::date>d then raise exception '只能在本週補登已到日期的課程'; end if;
  if action='sign_in' then
   update club_private.sessions set signed_at=coalesce(signed_at,now()) where id=se.id;
  else
   if se.signed_at is null or se.starts_at>now() or coalesce(trim(payload->>'summary'),'')='' then raise exception '請先完成簽到並填寫摘要，且課程必須已開始'; end if;
   for s in select st.* from club_private.students st where exists(select 1 from club_private.enrollments en where en.student_id=st.id and en.club_id=se.club_id and en.status='enrolled' and (se.starts_at at time zone 'Asia/Taipei')::date between en.start_date and coalesce(en.end_date,'infinity')) loop
    mark=payload->'marks'->>s.id::text;
    if exists(select 1 from club_private.leaves where student_id=s.id and session_id=se.id and status='approved') then mark='leave'; elsif coalesce(mark,'') not in ('present','absent','late') then raise exception '請完成每位學生點名，請假需先覆核'; end if;
    insert into club_private.attendance(session_id,student_id,status) values(se.id,s.id,mark) on conflict(session_id,student_id) do update set status=excluded.status;
   end loop;
   update club_private.sessions set summary=payload->>'summary',attendance_confirmed_at=now(),status='completed' where id=se.id;
  end if;
 elsif action='save_club' then
  if not exists(select 1 from club_private.terms where id=(payload->>'term_id')::uuid and status='active') then raise exception '學期不存在或已封存'; end if;
  if not exists(select 1 from club_private.users where id=(payload->>'teacher_id')::uuid and active and roles&&array['admin','clubtr','hrtr']::text[]) then raise exception '授課教師無效'; end if;
  insert into club_private.clubs(term_id,name,plan_name,description,kind,teacher_id,location,capacity,rate,funding_source,registration_start,registration_end) values((payload->>'term_id')::uuid,payload->>'name',payload->>'plan_name',coalesce(payload->>'description',''),payload->>'kind',(payload->>'teacher_id')::uuid,payload->>'location',(payload->>'capacity')::integer,(payload->>'rate')::numeric,coalesce(payload->>'funding_source',''),(payload->>'registration_start')::date,(payload->>'registration_end')::date) returning id into out_id;
 elsif action='publish_club' then
  perform club_private.assert_open(cid); update club_private.clubs set status=case when status='published' then 'draft' else 'published' end where id=cid;
 elsif action='add_session' then
  perform club_private.assert_open(cid,((payload->>'starts_at')::timestamptz at time zone 'Asia/Taipei')::date);
  se.id=gen_random_uuid();se.club_id=cid;se.teacher_id=(payload->>'teacher_id')::uuid;se.starts_at=(payload->>'starts_at')::timestamptz;se.ends_at=(payload->>'ends_at')::timestamptz;se.units=(payload->>'units')::numeric;se.rate=(payload->>'rate')::numeric;
  perform club_private.check_session(se);
  insert into club_private.sessions(id,club_id,teacher_id,starts_at,ends_at,units,rate) values(se.id,cid,se.teacher_id,se.starts_at,se.ends_at,se.units,se.rate) returning id into out_id;
 elsif action='change' then
  if c.id is null or not(a or (c.teacher_id=u.id and 'clubtr'=any(u.roles))) then raise exception '沒有異動權限'; end if;
  perform club_private.assert_open(cid);
  if sid is not null and (s.id is null or s.term_id<>c.term_id or not club_private.can_student(s,u)) then raise exception '沒有學生異動權限'; end if;
  insert into club_private.changes(club_id,kind,reason,student_id,effective_date,session_id,starts_at,ends_at,teacher_id,units,rate,status,created_by) values(cid,payload->>'kind',payload->>'reason',sid,nullif(payload->>'effective_date','')::date,seid,nullif(payload->>'starts_at','')::timestamptz,nullif(payload->>'ends_at','')::timestamptz,nullif(payload->>'teacher_id','')::uuid,nullif(payload->>'units','')::numeric,nullif(payload->>'rate','')::numeric,'pending',u.id) returning id into out_id;
  if a then perform club_private.apply_change(out_id); end if;
 elsif action='review_change' then
  select * into ch from club_private.changes where id=rid;
  if ch.id is null or ch.status<>'pending' or coalesce(payload->>'status','') not in ('approved','rejected') then raise exception '異動不存在或已處理'; end if;
  perform club_private.assert_open(ch.club_id);
  if payload->>'status'='approved' then perform club_private.apply_change(ch.id); else update club_private.changes set status='rejected',reviewed_by=u.id where id=ch.id; end if;
 elsif action='settle' then
  first_day=(payload->>'start_date')::date;last_day=(payload->>'end_date')::date;
  if first_day is null or last_day is null or first_day>last_day then raise exception '核算期間不正確'; end if;
  perform club_private.assert_open(cid);
  if exists(select 1 from club_private.settlements where club_id=cid and start_date<=last_day and end_date>=first_day) then raise exception '與已鎖定期間重疊'; end if;
  if not exists(select 1 from club_private.sessions where club_id=cid and status<>'cancelled' and (starts_at at time zone 'Asia/Taipei')::date between first_day and last_day) then raise exception '期間沒有可核算課程'; end if;
  if exists(select 1 from club_private.sessions where club_id=cid and status<>'cancelled' and (starts_at at time zone 'Asia/Taipei')::date between first_day and last_day and (status<>'completed' or signed_at is null or attendance_confirmed_at is null or trim(summary)='')) then raise exception '期間內仍有未完成簽到、點名或摘要的課程'; end if;
  select jsonb_agg(to_jsonb(x) order by x.starts_at),sum(x.amount),sum(x.units) into rows,total,units from (
   select course.*,teacher.name as teacher_name,round(course.units*course.rate) as amount,(select count(*) from club_private.attendance where session_id=course.id and status in ('present','late')) as attendance_count from club_private.sessions course join club_private.users teacher on teacher.id=course.teacher_id where course.club_id=cid and course.status<>'cancelled' and (course.starts_at at time zone 'Asia/Taipei')::date between first_day and last_day
  ) x;
  select jsonb_agg(to_jsonb(x)) into teachers from (select course.teacher_id,teacher.name,course.rate,sum(course.units) as units,sum(round(course.units*course.rate)) as amount from club_private.sessions course join club_private.users teacher on teacher.id=course.teacher_id where course.club_id=cid and course.status<>'cancelled' and (course.starts_at at time zone 'Asia/Taipei')::date between first_day and last_day group by course.teacher_id,teacher.name,course.rate) x;
  snap=jsonb_build_object('school','隘門國民小學','club',to_jsonb(c),'start_date',first_day,'end_date',last_day,'rows',rows,'teachers',teachers,'total',total,'units',units,'template_version',1);
  insert into club_private.settlements(club_id,start_date,end_date,snapshot,created_by) values(cid,first_day,last_day,snap,u.id) returning id into out_id;
 elsif action='paper_done' then
  update club_private.settlements set paper_done=not paper_done where id=rid; if not found then raise exception '找不到核銷'; end if;
 elsif action='roles' then
  select * into target from club_private.users where id=rid;
  select array_agg(value) into v_roles from jsonb_array_elements_text(payload->'roles');
  if target.id is null or coalesce(cardinality(v_roles),0)=0 or not v_roles<@array['admin','stu','clubtr','hrtr']::text[] then raise exception '角色不正確'; end if;
  if 'admin'=any(target.roles) and not 'admin'=any(v_roles) and (select count(*) from club_private.users where active and 'admin'=any(users.roles))<=2 then raise exception '需保留至少兩位管理者，請先完成交接'; end if;
  update club_private.users set roles=v_roles where id=rid;
 elsif action='add_term' then
  insert into club_private.terms(name,start_date,end_date) values(payload->>'name',(payload->>'start_date')::date,(payload->>'end_date')::date) returning id into out_id;
 elsif action='archive_term' then
  update club_private.terms set status='archived' where id=rid; if not found then raise exception '學期不存在'; end if;
 elsif action='add_student' then
  if not exists(select 1 from club_private.terms where id=(payload->>'term_id')::uuid and status='active') then raise exception '學期不存在或已封存'; end if;
  if nullif(payload->>'homeroom_id','') is not null and not exists(select 1 from club_private.users where id=(payload->>'homeroom_id')::uuid and active and 'hrtr'=any(roles)) then raise exception '導師帳號無效'; end if;
  if nullif(payload->>'user_id','') is not null and not exists(select 1 from club_private.users where id=(payload->>'user_id')::uuid and active and 'stu'=any(roles)) then raise exception '學生帳號無效'; end if;
  insert into club_private.students(term_id,user_id,name,class_name,number,homeroom_id) values((payload->>'term_id')::uuid,nullif(payload->>'user_id','')::uuid,payload->>'name',payload->>'class_name',payload->>'number',nullif(payload->>'homeroom_id','')::uuid) returning id into out_id;
 else raise exception '不支援的操作';
 end if;
 insert into club_private.audit(action,created_by) values(action,u.id);
 return jsonb_build_object('ok',true,'id',out_id);
end $$;
-- Bootstrap is service-role only; never available to browser users.

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
