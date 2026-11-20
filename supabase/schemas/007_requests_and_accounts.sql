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

-- Reuse the existing authorization, attendance and payroll mutation path.

