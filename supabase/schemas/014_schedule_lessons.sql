alter table club_private.changes drop constraint changes_kind_check,
 add constraint changes_kind_check check(kind in ('add_student','remove_student','reschedule','weekly')
  or (kind in ('cancel','makeup','swap','extra') and status='approved'));

create function club_private.schedule_lesson(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 writer club_private.users:=club_private.admin_writer();
 cid uuid:=(payload->>'club_id')::uuid;
 source_id uuid:=nullif(payload->>'session_id','')::uuid;
 source club_private.sessions;
 lesson club_private.sessions;
 reason text:=btrim(coalesce(payload->>'reason',''));
 change_kind text;
begin
 if length(reason) not between 1 and 300 then raise exception '請填寫 1 至 300 字的異動原因'; end if;
 lesson.id:=gen_random_uuid();
 lesson.club_id:=cid;
 lesson.starts_at:=(payload->>'starts_at')::timestamptz;
 lesson.ends_at:=(payload->>'ends_at')::timestamptz;
 lesson.units:=(payload->>'units')::numeric;
 lesson.teacher_id:=nullif(payload->>'teacher_id','')::uuid;
 perform club_private.assert_open(cid,(lesson.starts_at at time zone 'Asia/Taipei')::date);
 if source_id is null then
  change_kind:='extra';
  select rate into lesson.rate from club_private.clubs where id=cid;
 else
  change_kind:='makeup';
  select * into source from club_private.sessions where id=source_id and club_id=cid
   and status='cancelled' and signed_at is null;
  if not found then raise exception '請選擇此社團已停課的原節次'; end if;
  perform club_private.assert_open(cid,(source.starts_at at time zone 'Asia/Taipei')::date);
  if exists(select 1 from club_private.changes where session_id=source.id and kind='makeup') then
   raise exception '此節次已排定補課';
  end if;
  lesson.rate:=source.rate;
 end if;
 perform club_private.check_session(lesson);
 insert into club_private.sessions(id,club_id,teacher_id,starts_at,ends_at,units,rate)
  values(lesson.id,cid,lesson.teacher_id,lesson.starts_at,lesson.ends_at,lesson.units,lesson.rate);
 insert into club_private.changes(club_id,kind,reason,session_id,starts_at,ends_at,teacher_id,units,rate,original_dates,status,created_by,reviewed_by)
  values(cid,change_kind,reason,coalesce(source_id,lesson.id),lesson.starts_at,lesson.ends_at,lesson.teacher_id,lesson.units,lesson.rate,
   case when source_id is null then '[]'::jsonb else jsonb_build_array(source.starts_at) end,'approved',writer.id,writer.id);
 insert into club_private.audit(action,created_by,detail)
  values(change_kind,writer.id,jsonb_build_object('session_id',lesson.id,'source_id',source_id,'teacher_id',lesson.teacher_id,'reason',reason));
 return jsonb_build_object('id',lesson.id);
end $$;


create function public.club_schedule_lesson(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select club_private.schedule_lesson(payload) $$;
revoke all on function club_private.schedule_lesson(jsonb),public.club_schedule_lesson(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function club_private.schedule_lesson(jsonb),public.club_schedule_lesson(jsonb) to authenticated;
