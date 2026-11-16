-- Upgrade 0.2.x. Additive, safe to rerun. Existing change records are retained.
begin;
alter table club_private.changes add column if not exists revision integer not null default 1;
alter table club_private.changes add column if not exists edit_history jsonb not null default '[]'::jsonb;
alter table club_private.changes add column if not exists supersedes_id uuid references club_private.changes(id);
create index if not exists changes_supersedes on club_private.changes(supersedes_id);
create unique index if not exists changes_one_live_revision on club_private.changes(supersedes_id) where supersedes_id is not null and status in ('pending','approved');
create or replace function club_private.edit_change(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor club_private.users=club_private.actor(); c club_private.changes; club club_private.clubs;
 admin boolean='admin'=any(actor.roles); new_id uuid; before_row jsonb; history jsonb; changed record;
begin
 perform pg_advisory_xact_lock(148975,1);
 select * into c from club_private.changes where id=(payload->>'id')::uuid;
 if c.id is null then raise exception '找不到異動紀錄'; end if;
 select * into club from club_private.clubs where id=c.club_id;
 if not admin and not coalesce(c.created_by=actor.id and club.teacher_id=actor.id and 'clubtr'=any(actor.roles),false) then raise exception '沒有編修此異動的權限'; end if;
 if coalesce((payload->>'expected_revision')::integer,0)<>c.revision then raise exception '紀錄已被更新，請重新整理後再編修'; end if;
 if exists(select 1 from club_private.changes where supersedes_id=c.id and status in ('pending','approved')) then raise exception '此筆已有修訂紀錄，請編修最新版本'; end if;
 perform club_private.assert_open(c.club_id);
 if coalesce(trim(payload->>'reason'),'')='' then raise exception '請填寫異動原因'; end if;
 before_row=to_jsonb(c)-'edit_history';
 history=c.edit_history||jsonb_build_array(jsonb_build_object('edited_at',now(),'edited_by',actor.id,'before',before_row));
 -- Approved membership changes already affected historical rosters. Keep those
 -- identities/dates immutable; allow an audited correction to their explanation.
 if c.status='approved' and c.kind in ('add_student','remove_student') then
  if (payload ? 'student_id' and nullif(payload->>'student_id','')::uuid is distinct from c.student_id) or (payload ? 'effective_date' and nullif(payload->>'effective_date','')::date is distinct from c.effective_date) then raise exception '已生效學生增退僅可編修說明；學生或日期調整請新增異動'; end if;
  if exists(select 1 from club_private.settlements where club_id=c.club_id and end_date>=c.effective_date) then raise exception '該學生異動已涉及核銷鎖定期間'; end if;
  update club_private.changes set reason=trim(payload->>'reason'),revision=revision+1,edit_history=history where id=c.id;
  new_id=c.id;
 else
  -- Freeze club and kind on edit to prevent changing the meaning of an existing
  -- approval. Source session may change only for an unapproved application.
  if payload ? 'kind' and payload->>'kind'<>c.kind then raise exception '編修不可更換異動類型'; end if;
  if payload ? 'club_id' and (payload->>'club_id')::uuid<>c.club_id then raise exception '編修不可更換社團'; end if;
  if c.status='approved' and payload ? 'session_id' and nullif(payload->>'session_id','')::uuid is distinct from c.session_id then raise exception '已確認的代調課不可更換原課程'; end if;
  if c.kind in ('reschedule','weekly') then
   if nullif(payload->>'session_id','') is null or not exists(select 1 from club_private.sessions where id=(payload->>'session_id')::uuid and club_id=c.club_id and status='scheduled' and signed_at is null) then raise exception '請選擇同社團尚未簽到的待上課節次'; end if;
   for changed in select * from club_private.sessions where club_id=c.club_id and (id=(payload->>'session_id')::uuid or (c.kind='weekly' and status='scheduled' and starts_at>=(select starts_at from club_private.sessions where id=(payload->>'session_id')::uuid))) loop
    perform club_private.assert_open(c.club_id,(changed.starts_at at time zone 'Asia/Taipei')::date);
   end loop;
   if nullif(payload->>'starts_at','') is null or nullif(payload->>'ends_at','') is null or (payload->>'ends_at')::timestamptz<=(payload->>'starts_at')::timestamptz or coalesce((payload->>'units')::numeric,0)<=0 then raise exception '請確認新時間與節數'; end if;
   perform club_private.assert_open(c.club_id,((payload->>'starts_at')::timestamptz at time zone 'Asia/Taipei')::date);
  else
   if nullif(payload->>'student_id','') is null or not exists(select 1 from club_private.students where id=(payload->>'student_id')::uuid and term_id=club.term_id) or nullif(payload->>'effective_date','') is null then raise exception '請指定同學期學生及生效日期'; end if;
   if not admin and not coalesce((select club_private.can_student(s,actor) from club_private.students s where s.id=(payload->>'student_id')::uuid),false) then raise exception '沒有該學生的異動權限'; end if;
   perform club_private.assert_open(c.club_id,(payload->>'effective_date')::date);
  end if;
  if c.status='pending' then
   update club_private.changes set reason=trim(payload->>'reason'),student_id=nullif(payload->>'student_id','')::uuid,effective_date=nullif(payload->>'effective_date','')::date,session_id=nullif(payload->>'session_id','')::uuid,starts_at=nullif(payload->>'starts_at','')::timestamptz,ends_at=nullif(payload->>'ends_at','')::timestamptz,teacher_id=nullif(payload->>'teacher_id','')::uuid,units=nullif(payload->>'units','')::numeric,rate=nullif(payload->>'rate','')::numeric,revision=revision+1,edit_history=history where id=c.id;
   new_id=c.id; -- Editing a pending request never grants implicit approval.
  else
   insert into club_private.changes(club_id,kind,reason,student_id,effective_date,session_id,starts_at,ends_at,teacher_id,units,rate,status,created_by,supersedes_id,edit_history)
   values(c.club_id,c.kind,trim(payload->>'reason'),nullif(payload->>'student_id','')::uuid,nullif(payload->>'effective_date','')::date,nullif(payload->>'session_id','')::uuid,nullif(payload->>'starts_at','')::timestamptz,nullif(payload->>'ends_at','')::timestamptz,nullif(payload->>'teacher_id','')::uuid,nullif(payload->>'units','')::numeric,nullif(payload->>'rate','')::numeric,'pending',actor.id,c.id,jsonb_build_array(jsonb_build_object('edited_at',now(),'edited_by',actor.id,'before',before_row))) returning id into new_id;
   if admin then perform club_private.apply_change(new_id); end if;
  end if;
 end if;
 insert into club_private.audit(action,created_by) values('edit_change',actor.id);
 return jsonb_build_object('ok',true,'id',new_id);
end $$;
create or replace function public.club_edit_change(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select club_private.edit_change(payload) $$;
revoke all on function club_private.edit_change(jsonb) from public,anon,authenticated;
grant execute on function club_private.edit_change(jsonb) to authenticated;
revoke all on function public.club_edit_change(jsonb) from public,anon,authenticated;
grant execute on function public.club_edit_change(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
