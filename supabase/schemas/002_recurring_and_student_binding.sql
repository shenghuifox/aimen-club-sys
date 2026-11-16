-- Upgrade existing installations. Safe to rerun; no table/data deletion.
begin;
create or replace function club_private.batch_sessions(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor club_private.users=club_private.actor(); cid uuid=(payload->>'club_id')::uuid;
 first_day date=(payload->>'start_date')::date; last_day date=(payload->>'end_date')::date;
 start_clock time=(payload->>'start_time')::time; end_clock time=(payload->>'end_time')::time;
 weekdays integer[]; excluded date[]; day date; starts timestamptz; ends timestamptz;
 teacher uuid=(payload->>'teacher_id')::uuid; v_units numeric=(payload->>'units')::numeric; v_rate numeric=(payload->>'rate')::numeric;
 added integer=0; skipped integer=0; candidates integer=0; term club_private.terms;
begin
 if not 'admin'=any(actor.roles) then raise exception '僅行政管理者可批次排課'; end if;
 perform pg_advisory_xact_lock(148975,1); perform club_private.assert_open(cid);
 select t.* into term from club_private.terms t join club_private.clubs c on c.term_id=t.id where c.id=cid;
 select array_agg(value::integer) into weekdays from jsonb_array_elements_text(payload->'weekdays');
 select array_agg(value::date) into excluded from jsonb_array_elements_text(coalesce(payload->'exclude_dates','[]'::jsonb));
 if first_day is null or last_day is null or last_day<first_day or last_day-first_day>366 then raise exception '日期範圍不正確，最多一年'; end if;
 if first_day<term.start_date or last_day>term.end_date then raise exception '批次日期範圍超出學期'; end if;
 if coalesce(cardinality(weekdays),0)=0 or not weekdays<@array[1,2,3,4,5,6,7] then raise exception '請選擇有效的上課星期'; end if;
 if start_clock is null or end_clock is null or end_clock<=start_clock or v_units is null or v_units<=0 or v_rate is null or v_rate<0 then raise exception '時間、節數或費率不正確'; end if;
 if not exists(select 1 from club_private.users where id=teacher and active and roles&&array['admin','clubtr','hrtr']::text[]) then raise exception '授課教師無效'; end if;
 day=first_day;
 while day<=last_day loop
  if extract(isodow from day)::integer=any(weekdays) and not(day=any(coalesce(excluded,array[]::date[]))) then
   candidates=candidates+1;if candidates>200 then raise exception '每批最多 200 次課程'; end if;
   starts=(day+start_clock) at time zone 'Asia/Taipei'; ends=(day+end_clock) at time zone 'Asia/Taipei';
   if exists(select 1 from club_private.sessions s where s.club_id=cid and s.status<>'cancelled' and s.starts_at=starts and s.ends_at=ends and s.teacher_id=teacher and s.units=v_units and s.rate=v_rate) then skipped=skipped+1;
   else
    begin
     perform club_private.act('add_session',jsonb_build_object('club_id',cid,'teacher_id',teacher,'starts_at',starts,'ends_at',ends,'units',v_units,'rate',v_rate));
    exception when others then raise exception '批次未新增任何課程：%：%',day,sqlerrm; end;
    added=added+1;
   end if;
  end if;
  day=day+1;
 end loop;
 if candidates=0 then raise exception '沒有符合的課程日期'; end if;
 return jsonb_build_object('ok',true,'added',added,'skipped',skipped);
end $$;
create or replace function club_private.update_student(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor club_private.users=club_private.actor(); target club_private.students;
 student_id uuid=(payload->>'id')::uuid; account uuid=nullif(payload->>'user_id','')::uuid; homeroom uuid=nullif(payload->>'homeroom_id','')::uuid;
begin
 if not 'admin'=any(actor.roles) then raise exception '僅行政管理者可修改學生綁定'; end if;
 perform pg_advisory_xact_lock(148975,1);select * into target from club_private.students where id=student_id;
 if target.id is null then raise exception '學生名冊不存在'; end if;
 if not exists(select 1 from club_private.terms where id=target.term_id and status='active') then raise exception '學期已封存'; end if;
 if account is not null and not exists(select 1 from club_private.users where id=account and active and 'stu'=any(roles)) then raise exception '請選擇有效學生帳號'; end if;
 if homeroom is not null and not exists(select 1 from club_private.users where id=homeroom and active and 'hrtr'=any(roles)) then raise exception '請選擇有效導師帳號'; end if;
 if account is not null and exists(select 1 from club_private.students where term_id=target.term_id and user_id=account and id<>target.id) then raise exception '此帳號已綁定本學期其他學生，請先確認身分'; end if;
 if coalesce(trim(payload->>'name'),'')='' or coalesce(trim(payload->>'class_name'),'')='' or coalesce(trim(payload->>'number'),'')='' then raise exception '姓名、班級與座號不可空白'; end if;
 if exists(select 1 from club_private.enrollments e join club_private.settlements b on b.club_id=e.club_id where e.student_id=target.id) and (target.name is distinct from trim(payload->>'name') or target.class_name is distinct from trim(payload->>'class_name') or target.number is distinct from trim(payload->>'number')) then raise exception '已有核銷紀錄，不能直接修改歷史姓名、班級或座號；仍可調整帳號與導師綁定'; end if;
 update club_private.students set name=trim(payload->>'name'),class_name=trim(payload->>'class_name'),number=trim(payload->>'number'),user_id=account,homeroom_id=homeroom where id=target.id;
 insert into club_private.audit(action,created_by) values('update_student',actor.id);return jsonb_build_object('ok',true);
end $$;
create or replace function public.club_batch_sessions(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select club_private.batch_sessions(payload) $$;
create or replace function public.club_update_student(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select club_private.update_student(payload) $$;
revoke all on function club_private.batch_sessions(jsonb),club_private.update_student(jsonb) from public,anon,authenticated;
grant execute on function club_private.batch_sessions(jsonb),club_private.update_student(jsonb) to authenticated;
revoke all on function public.club_batch_sessions(jsonb),public.club_update_student(jsonb) from public,anon,authenticated;
grant execute on function public.club_batch_sessions(jsonb),public.club_update_student(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
