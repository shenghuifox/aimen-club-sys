import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`
 create role anon; create role authenticated; create role service_role; create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb default '{}'::jsonb);
 create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
`);
await db.exec(await fs.readFile(new URL('../supabase/schemas/001_club.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/002_recurring_and_student_binding.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/003_edit_changes.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/004_bulk_administration.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/005_club_operations.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/006_operations_handover.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/007_requests_and_accounts.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/008_single_admin_invites.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/009_school_username_login.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/010_public_calendar.sql',import.meta.url),'utf8'));
const ids={admin:'00000000-0000-0000-0000-000000000001',stu:'00000000-0000-0000-0000-000000000002',clubtr:'00000000-0000-0000-0000-000000000003',hrtr:'00000000-0000-0000-0000-000000000004',other:'00000000-0000-0000-0000-000000000005'};
for(const [role,id] of Object.entries(ids)){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,role+'@test.aimen.invalid']);await db.query('insert into club_private.users(id,username,name,roles) values($1,$2,$2,$3)',[id,role,[role==='other'?'stu':role]]);}
const as=async(role)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[role]||'']);await db.exec('set role '+(role==='anon'?'anon':'authenticated'));};
const act=async(action,payload)=>(await db.query('select public.club_action($1,$2) as result',[action,JSON.stringify(payload)])).rows[0].result;
const snapshot=async()=>(await db.query('select public.club_snapshot() as result')).rows[0].result;
const term=(await db.query('select id from club_private.terms')).rows[0].id;
let count=0;const check=async(name,fn)=>{await fn();console.log('PASS',name);count++;};
await check('匿名不可讀取資料或建立帳號',async()=>{await as('anon');await assert.rejects(snapshot);await assert.rejects(()=>db.query("select public.club_bootstrap_profile($1,'x','x',array['admin'])",[ids.stu]));});
await as('admin');
await check('行政建立社團、學生及課程',async()=>{
 await act('save_club',{term_id:term,name:'測試社團',plan_name:'測試計畫',description:'測試',kind:'社團',teacher_id:ids.clubtr,location:'教室',capacity:1,rate:400,funding_source:'測試',registration_start:'2026-08-01',registration_end:'2027-01-31'});
 await act('add_student',{term_id:term,user_id:ids.stu,name:'學生一',class_name:'三甲',number:'01',homeroom_id:ids.hrtr});
 await act('add_student',{term_id:term,user_id:ids.other,name:'學生二',class_name:'四甲',number:'01'});
});
let d=await snapshot();const cid=d.clubs[0].id,sid=d.students.find(s=>s.user_id===ids.stu).id,sid2=d.students.find(s=>s.user_id===ids.other).id;
await act('publish_club',{club_id:cid});
await act('add_session',{club_id:cid,teacher_id:ids.clubtr,starts_at:'2026-11-16T07:30:00+08:00',ends_at:'2026-11-16T08:10:00+08:00',units:1,rate:400});
d=await snapshot();const seid=d.sessions[0].id;
await check('學生只能讀自己名冊，不能升權、越權查表',async()=>{await as('stu');const mine=await snapshot();assert.equal(mine.students.length,1);assert.equal(mine.students[0].id,sid);await assert.rejects(()=>act('roles',{id:ids.stu,roles:['admin']}));await assert.rejects(()=>db.query('select * from club_private.students'));});
await check('報名與錄取、防止重複及超收',async()=>{await act('enroll',{club_id:cid,student_id:sid});await assert.rejects(()=>act('enroll',{club_id:cid,student_id:sid}));await as('admin');d=await snapshot();await act('admit',{id:d.enrollments[0].id,status:'enrolled',start_date:'2026-08-01'});await act('enroll',{club_id:cid,student_id:sid2});d=await snapshot();await assert.rejects(()=>act('admit',{id:d.enrollments.find(e=>e.student_id===sid2).id,status:'enrolled',start_date:'2026-08-01'}));});
await check('學生申請需覆核，學生不能自我覆核',async()=>{await as('stu');await act('leave',{session_id:seid,student_id:sid,kind:'事假',reason:'測試'});d=await snapshot();assert.equal(d.leaves[0].status,'pending');await assert.rejects(()=>act('review_leave',{id:d.leaves[0].id,status:'approved'}));await as('hrtr');await act('review_leave',{id:d.leaves[0].id,status:'approved'});d=await snapshot();assert.equal(d.leaves[0].status,'approved');});
await check('教師不可替別的班級未參與學生請假',async()=>{await as('clubtr');await assert.rejects(()=>act('leave',{session_id:seid,student_id:sid2,kind:'事假',reason:'測試'}));});
await check('未綁定帳號與導師時仍拒絕越權',async()=>{
 await db.exec('reset role');
 await db.query('update club_private.students set user_id=null,homeroom_id=null where id=$1',[sid2]);
 await as('stu');await assert.rejects(()=>act('enroll',{club_id:cid,student_id:sid2}));
 await db.exec('reset role');
 const fake=(await db.query("insert into club_private.leaves(session_id,student_id,kind,reason,status,created_by) values($1,$2,'事假','測試','pending',$3) returning id",[seid,sid2,ids.other])).rows[0].id;
 await as('hrtr');await assert.rejects(()=>act('review_leave',{id:fake,status:'approved'}));
});
await check('沒有完整上課紀錄不可核銷',async()=>{await as('admin');await assert.rejects(()=>act('settle',{club_id:cid,start_date:'2026-11-16',end_date:'2026-11-16'}));});
await db.exec('reset role');await db.query("update club_private.sessions set signed_at=starts_at,attendance_confirmed_at=ends_at,status='completed',summary='已完成授課' where id=$1",[seid]);await db.query("insert into club_private.attendance values($1,$2,'leave')",[seid,sid]);
await check('分期核銷金額、出席人數快照與重複鎖定',async()=>{await as('admin');await act('settle',{club_id:cid,start_date:'2026-11-16',end_date:'2026-11-16'});d=await snapshot();assert.equal(d.settlements[0].snapshot.total,400);assert.equal(d.settlements[0].snapshot.rows[0].attendance_count,0);await assert.rejects(()=>act('settle',{club_id:cid,start_date:'2026-11-15',end_date:'2026-11-17'}));await assert.rejects(()=>act('add_session',{club_id:cid,teacher_id:ids.clubtr,starts_at:'2026-11-16T10:00:00+08:00',ends_at:'2026-11-16T10:40:00+08:00',units:1,rate:400}));});
await check('移除管理者保底；資料庫所有應用表均開啟 RLS',async()=>{await assert.rejects(()=>act('roles',{id:ids.admin,roles:['stu']}));await act('roles',{id:ids.hrtr,roles:['hrtr','admin']});await assert.rejects(()=>act('roles',{id:ids.admin,roles:['stu']}));await db.exec('reset role');const r=await db.query("select count(*)::int as n from pg_tables where schemaname='club_private' and not rowsecurity");assert.equal(r.rows[0].n,0);});
const batch=async p=>(await db.query('select public.club_batch_sessions($1) as result',[JSON.stringify(p)])).rows[0].result;
const bind=async p=>(await db.query('select public.club_update_student($1) as result',[JSON.stringify(p)])).rows[0].result;
const series={club_id:cid,teacher_id:ids.clubtr,start_date:'2026-11-23',end_date:'2026-12-07',weekdays:[1],start_time:'15:30',end_time:'16:10',units:1,rate:400,exclude_dates:['2026-11-30']};
await check('週期排課排除日期、重複執行不新增',async()=>{await as('admin');const result=await batch(series);assert.equal(result.added,2);const again=await batch(series);assert.equal(again.added,0);assert.equal(again.skipped,2);});
await check('批次衝突回滾整批、學生禁止批次排課',async()=>{
 await act('add_session',{club_id:cid,teacher_id:ids.clubtr,starts_at:'2026-11-30T14:00:00+08:00',ends_at:'2026-11-30T14:40:00+08:00',units:1,rate:999});
 const before=(await snapshot()).sessions.length;
 await assert.rejects(()=>batch({...series,end_date:'2026-11-30',start_time:'14:00',end_time:'14:40',exclude_dates:[]}));
 assert.equal((await snapshot()).sessions.length,before);
 await as('stu');await assert.rejects(()=>batch(series));
});
await check('批次尊重學期範圍與已核銷鎖定',async()=>{
 await as('admin');await assert.rejects(()=>batch({...series,start_date:'2026-11-16',end_date:'2026-11-16',start_time:'10:00',end_time:'10:40'}));
 await assert.rejects(()=>batch({...series,end_date:'2027-02-10'}));
});
await check('行政綁定學生帳號、重複綁定與學生自改均阻擋',async()=>{
 await as('admin');await bind({id:sid2,name:'學生二',class_name:'四甲',number:'01',user_id:ids.other,homeroom_id:ids.hrtr});
 await as('other');assert.equal((await snapshot()).students[0].id,sid2);
 await assert.rejects(()=>bind({id:sid2,name:'學生二',class_name:'四甲',number:'01',user_id:ids.stu}));
 await as('admin');await assert.rejects(()=>bind({id:sid2,name:'學生二',class_name:'四甲',number:'01',user_id:ids.stu}));
});
const edit=async p=>(await db.query('select public.club_edit_change($1) as result',[JSON.stringify(p)])).rows[0].result;
let changeId,revisionId;let editPayload;
await check('待覆核異動編修保留未確認並記錄歷史',async()=>{
 await as('clubtr');d=await snapshot();const source=d.sessions.find(s=>s.starts_at.startsWith('2026-11-30'));
 const result=await act('change',{club_id:cid,kind:'reschedule',session_id:source.id,starts_at:'2026-11-30T13:00:00+08:00',ends_at:'2026-11-30T13:40:00+08:00',teacher_id:ids.clubtr,units:1,rate:400,reason:'原申請'});changeId=result.id;
 editPayload={id:changeId,expected_revision:1,session_id:source.id,starts_at:'2026-11-30T12:00:00+08:00',ends_at:'2026-11-30T12:40:00+08:00',teacher_id:ids.clubtr,units:1,rate:400,reason:'修改申請'};
 await edit(editPayload);d=await snapshot();const c=d.changes.find(x=>x.id===changeId);assert.equal(c.status,'pending');assert.equal(c.revision,2);assert.equal(c.edit_history[0].before.reason,'原申請');
 assert.equal(new Date(d.sessions.find(s=>s.id===source.id).starts_at).toISOString(),'2026-11-30T06:00:00.000Z');
 await assert.rejects(()=>edit(editPayload));
});
await check('學生不可編修；已確認代調課以新版本生效',async()=>{
 await as('stu');await assert.rejects(()=>edit({...editPayload,expected_revision:2}));
 await as('admin');await act('review_change',{id:changeId,status:'approved'});
 const result=await edit({...editPayload,expected_revision:2,starts_at:'2026-11-30T11:00:00+08:00',ends_at:'2026-11-30T11:40:00+08:00',reason:'行政修訂'});revisionId=result.id;assert.notEqual(revisionId,changeId);
 d=await snapshot();const original=d.changes.find(c=>c.id===changeId),next=d.changes.find(c=>c.id===revisionId);assert.equal(original.reason,'修改申請');assert.equal(next.supersedes_id,changeId);assert.equal(next.status,'approved');assert.equal(new Date(d.sessions.find(s=>s.id===editPayload.session_id).starts_at).toISOString(),'2026-11-30T03:00:00.000Z');
 await assert.rejects(()=>edit({...editPayload,expected_revision:2}));
});
await check('編修衝突整筆回滾，已授課或鎖定不可覆寫',async()=>{
 const before=(await snapshot()).changes.length;
 await assert.rejects(()=>edit({...editPayload,id:revisionId,expected_revision:1,starts_at:'2026-11-23T15:30:00+08:00',ends_at:'2026-11-23T16:10:00+08:00',reason:'撞課測試'}));
 assert.equal((await snapshot()).changes.length,before);
 await db.exec('reset role');await db.query("update club_private.sessions set signed_at=starts_at where id=$1",[editPayload.session_id]);await as('admin');
 await assert.rejects(()=>edit({...editPayload,id:revisionId,expected_revision:1}));
});
const importAccounts=async rows=>(await db.query('select public.club_import_accounts($1) result',[{term_id:term,rows}])).rows[0].result;
const claim=()=>db.query('select public.club_claim_account()');
ids.newStudent='00000000-0000-0000-0000-000000000006';
ids.newTeacher='00000000-0000-0000-0000-000000000007';
const studentImport={email:'school-student@example.test',name:'待綁定學生',role:'stu',class_name:'四甲',number:'02'};
const teacherImport={email:'school-teacher@example.test',name:'既有教師',role:'clubtr'};
await check('批次匯入僅供行政，錯誤列會回滾，已驗證帳號立即綁定',async()=>{
 await db.exec('reset role');
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,null),($3,$4,now())',
  [ids.newStudent,studentImport.email,ids.newTeacher,teacherImport.email]);
 await as('admin');
 await act('add_student',{term_id:term,name:studentImport.name,class_name:studentImport.class_name,number:studentImport.number});
 await as('stu');
 await assert.rejects(()=>importAccounts([teacherImport]),/僅行政/);
 await as('admin');
 await assert.rejects(()=>importAccounts([teacherImport,{...studentImport,number:'99'}]),/第 2 筆/);
 assert.ok(!(await snapshot()).users.some(u=>u.id===ids.newTeacher));
 assert.deepEqual(await importAccounts([studentImport,teacherImport]),{bound:1,pending:1});
 assert.deepEqual(await importAccounts([studentImport,teacherImport]),{bound:1,pending:1});
 assert.ok((await snapshot()).users.some(u=>u.id===ids.newTeacher));
});
await check('未驗證帳號無法領取名冊，驗證後只能領取自己的帳號',async()=>{
 await as('stu');await claim();
 let view=await snapshot();
 assert.deepEqual(view.pending_accounts,[]);
 assert.equal(view.users.find(u=>u.id===ids.clubtr).username,null);
 assert.equal(view.clubs[0].rate,undefined);
 await assert.rejects(()=>db.query("select public.club_cancel_account($1)",[{email:studentImport.email}]),/僅行政/);
 await as('newStudent');await claim();await assert.rejects(snapshot,/尚未獲授權/);
 await db.exec('reset role');
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[ids.newStudent]);
 await as('newStudent');await claim();await claim();
 view=await snapshot();
 assert.equal(view.students.length,1);
 assert.equal(view.students[0].name,studentImport.name);
 await as('admin');assert.deepEqual((await snapshot()).pending_accounts,[]);
});
await check('批次錄取超額回滾，批次加入與退選保留歷史',async()=>{
 await as('admin');
 const newClub=async (name,capacity)=>(await act('save_club',{term_id:term,name,plan_name:'測試計畫',kind:'社團',
  teacher_id:ids.clubtr,location:'教室',capacity,rate:400,funding_source:'',registration_start:'2026-08-01',registration_end:'2027-01-31'})).id;
 const small=await newClub('名額測試',1);
 const roomy=await newClub('批次加退選',10);
 const one=await act('enroll',{club_id:small,student_id:sid});
 const two=await act('enroll',{club_id:small,student_id:sid2});
 const batch=async (club_id,operation,ids,effective_date='2026-12-01')=>(await db.query(
  'select public.club_batch_roster($1) result',[{club_id,operation,ids,effective_date,reason:'班級名冊調整'}])).rows[0].result;
 await as('stu');await assert.rejects(()=>batch(small,'enrolled',[one.id]),/僅行政/);
 await as('admin');
 await assert.rejects(()=>batch(small,'enrolled',[one.id,two.id]),/名額已滿/);
 assert.equal((await snapshot()).enrollments.filter(e=>e.club_id===small&&e.status==='pending').length,2);
 assert.deepEqual(await batch(small,'enrolled',[one.id]),{count:1});
 assert.deepEqual(await batch(small,'rejected',[two.id],null),{count:1});
 assert.deepEqual(await batch(roomy,'add_student',[sid,sid2]),{count:2});
 assert.deepEqual(await batch(roomy,'remove_student',[sid,sid2],'2026-12-02'),{count:2});
 const result=await snapshot();
 assert.ok(result.enrollments.filter(e=>e.club_id===roomy).every(e=>e.end_date==='2026-12-01'));
 assert.equal(result.changes.filter(e=>e.club_id===roomy&&e.status==='approved').length,4);
 assert.deepEqual(await batch(roomy,'add_student',[sid],'2026-12-07'),{count:1});
 assert.deepEqual(await batch(roomy,'remove_student',[sid],'2026-12-07'),{count:1});
 assert.equal((await snapshot()).enrollments.find(e=>e.club_id===roomy&&e.start_date==='2026-12-07').status,'withdrawn');
});
const operation=(action,payload)=>db.query('select public.club_operations($1,$2)',[action,JSON.stringify(payload)]);
await check('停課保留原節次、補課沿用費率且禁止重排',async()=>{
 await as('admin');
 const original=(await snapshot()).sessions.find(s=>s.club_id===cid&&s.status==='scheduled'&&!s.signed_at);
 const payload={session_id:original.id,reason:'天候停課',starts_at:'2027-01-21T15:30:00+08:00',ends_at:'2027-01-21T16:10:00+08:00'};
 await as('stu');
 await assert.rejects(()=>operation('cancel',payload));
 await as('admin');
 await operation('cancel',payload);
 assert.equal((await snapshot()).sessions.find(s=>s.id===original.id).status,'cancelled');
 await operation('makeup',payload);
 await assert.rejects(()=>operation('makeup',payload));
 const after=await snapshot();
 const makeup=after.sessions.find(s=>+new Date(s.starts_at)===+new Date(payload.starts_at));
 assert.equal(makeup.rate,original.rate);
 assert.equal(makeup.status,'scheduled');
 const other=after.sessions.find(s=>s.club_id===cid&&s.id!==makeup.id&&s.status==='scheduled'&&!s.signed_at);
 await operation('swap',{session_id:makeup.id,other_id:other.id,reason:'兩節互換'});
 assert.equal((await snapshot()).sessions.find(s=>s.id===other.id).starts_at,makeup.starts_at);
});
await check('候補與繳費狀態，學生僅見自己的結果',async()=>{
 await as('admin');
 const entries=(await snapshot()).enrollments.filter(e=>e.club_id===cid);
 const waiting=entries.find(e=>e.student_id===sid2);
 const waitlist={club_id:cid,operation:'waitlisted',ids:[waiting.id]};
 await db.query('select public.club_batch_roster($1)',[{...waitlist,preview:true}]);
 assert.equal((await snapshot()).enrollments.find(e=>e.id===waiting.id).status,'pending');
 await db.query('select public.club_batch_roster($1)',[waitlist]);
 const accepted=entries.find(e=>e.student_id===sid);
 await operation('fee_status',{id:accepted.id,status:'paid'});
 await as('stu');
 const mine=await snapshot();
 assert.equal(mine.enrollments.find(e=>e.id===accepted.id).fee_status,'paid');
 assert.ok(!mine.enrollments.some(e=>e.id===waiting.id));
 await assert.rejects(()=>operation('fee_status',{id:accepted.id,status:'overdue'}));
 await as('other');
 assert.equal((await snapshot()).enrollments.find(e=>e.id===waiting.id).status,'waitlisted');
});
await check('核銷作廢保留快照，且可重新鎖定',async()=>{
 await as('admin');
 const old=(await snapshot()).settlements[0];
 await operation('void_settlement',{id:old.id,reason:'資料更正'});
 const next=await snapshot();
 assert.ok(!next.settlements.some(b=>b.id===old.id));
 assert.deepEqual(next.voided_settlements.find(b=>b.id===old.id).snapshot,old.snapshot);
 await act('settle',{club_id:old.club_id,start_date:old.start_date,end_date:old.end_date});
 await as('stu');
 assert.deepEqual((await snapshot()).voided_settlements,[]);
});
const manage=async(action,payload)=>(await db.query('select public.club_manage($1,$2) as result',[action,JSON.stringify(payload)])).rows[0].result;
await check('停權即時拒絕讀寫、復權沿用原綁定，管理者不得自停',async()=>{
 await as('admin');
 await assert.rejects(()=>manage('account_status',{id:ids.admin,active:false,reason:'測試'}));
 await assert.rejects(()=>manage('account_status',{id:ids.hrtr,active:false,reason:'管理者保底'}));
 await manage('account_status',{id:ids.other,active:false,reason:'離校測試'});
 await as('other');
 await assert.rejects(snapshot);
 await assert.rejects(()=>act('enroll',{student_id:sid2,club_id:cid}));
 await as('admin');
 assert.equal((await snapshot()).users.find(u=>u.id===ids.other).active,false);
 await manage('account_status',{id:ids.other,active:true,reason:'恢復資格'});
 await as('other');
 assert.equal((await snapshot()).students[0].id,sid2);
});
await check('家長只讀已綁定孩子的資料，請假進入導師覆核',async()=>{
 ids.guardian='00000000-0000-0000-0000-000000000011';
 await db.exec('reset role');
 await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'guardian@example.com',now())",[ids.guardian]);
 await as('admin');
 await manage('link_guardian',{student_id:sid,name:'測試家長',email:'guardian@example.com'});
 const item=(await snapshot()).sessions.find(s=>s.club_id===cid&&s.status==='scheduled'&&new Date(s.starts_at)>new Date());
 await as('guardian');
 const mine=await snapshot();
 assert.deepEqual(mine.students.map(s=>s.id),[sid]);
 assert.deepEqual(mine.users.map(u=>u.id).sort(),[ids.clubtr,ids.guardian].sort());
 assert.equal(mine.users.find(u=>u.id===ids.clubtr).username,null);
 assert.equal(mine.enrollments.find(e=>e.student_id===sid).fee_status,'paid');
 assert.ok(mine.clubs.every(c=>!('rate' in c)&&!('activity_ref' in c)));
 const leave={session_id:item.id,student_id:sid,kind:'事假',reason:'家庭事務測試'};
 await assert.rejects(()=>manage('guardian_leave',{...leave,student_id:sid2}));
 await assert.rejects(()=>manage('link_guardian',{student_id:sid2,name:'測試',email:'guardian@example.com'}));
 await manage('guardian_leave',leave);
 await as('hrtr');
 const pending=(await snapshot()).leaves.find(l=>l.session_id===item.id&&l.student_id===sid);
 assert.equal(pending.status,'pending');
 await act('review_leave',{id:pending.id,status:'approved'});
 await as('guardian');
 assert.equal((await snapshot()).leaves.find(l=>l.id===pending.id).status,'approved');
});
await check('複製名冊、社團與帳號關係，避開舊節次與核銷',async()=>{
 await as('admin');
 const before=await snapshot();
 const payload={id:term,name:'新學期測試',start_date:'2027-02-01',end_date:'2027-07-31'};
 const {id}=await manage('copy_term',payload);
 await assert.rejects(()=>manage('copy_term',payload));
 const after=await snapshot(), next=after.students.filter(s=>s.term_id===id), copied=after.clubs.filter(c=>c.term_id===id);
 assert.equal(next.length,before.students.filter(s=>s.term_id===term).length);
 assert.equal(copied.length,before.clubs.filter(c=>c.term_id===term).length);
 assert.ok(copied.every(c=>c.status==='draft'));
 assert.equal(after.sessions.length,before.sessions.length);
 assert.equal(after.settlements.length,before.settlements.length);
 const child=next.find(s=>s.user_id===ids.stu);
 assert.equal(child.homeroom_id,ids.hrtr);
 assert.ok(after.guardian_links.some(g=>g.guardian_id===ids.guardian&&g.student_id===child.id));
 await manage('unlink_guardian',{id:ids.guardian,student_id:sid});
 await as('guardian');
 assert.deepEqual((await snapshot()).students.map(s=>s.id),[child.id]);
});
const follow=async(action,payload)=>(await db.query('select public.club_followup($1,$2) result',[action,JSON.stringify(payload)])).rows[0].result;
await check('假單撤回有身分限制，撤回後可以重送',async()=>{
 await as('admin');
 const item=(await snapshot()).leaves.find(l=>l.student_id===sid&&l.status==='approved'&&l.session_id!==seid);
 await as('other');
 await assert.rejects(()=>follow('withdraw_leave',{id:item.id}));
 await as('stu');
 await follow('withdraw_leave',{id:item.id});
 assert.equal((await snapshot()).leaves.find(l=>l.id===item.id).status,'withdrawn');
 await act('leave',{session_id:item.session_id,student_id:sid,kind:'事假',reason:'重新送出'});
});
await check('社團老師可撤回自己尚未確認的異動，行政保留異動歷史',async()=>{
 await as('clubtr');
 const {id}=await act('change',{club_id:cid,kind:'add_student',student_id:sid,effective_date:'2027-01-15',reason:'撤回測試'});
 await as('stu');
 await assert.rejects(()=>follow('withdraw_change',{id}));
 await as('clubtr');
 await follow('withdraw_change',{id});
 assert.equal((await snapshot()).changes.find(c=>c.id===id).status,'withdrawn');
 await as('admin');
 await assert.rejects(()=>act('review_change',{id,status:'approved'}));
});
await check('本週可補登、完成點名，往週及非任課者被拒絕',async()=>{
 await db.exec('reset role');
 const dates=(await db.query(`select (now() at time zone 'Asia/Taipei')::date today,
  date_trunc('week',now() at time zone 'Asia/Taipei')::date week_start,
  (now() at time zone 'Asia/Taipei')::date-1 yesterday,
  date_trunc('week',now() at time zone 'Asia/Taipei')::date-1 previous`)).rows[0];
 const add=async date=>(await db.query(`insert into club_private.sessions(club_id,teacher_id,starts_at,ends_at,units,rate)
 values($1,$2,$3::date::timestamp at time zone 'Asia/Taipei',($3::date::timestamp + interval '1 hour') at time zone 'Asia/Taipei',1,400) returning id`,
 [cid,ids.clubtr,date])).rows[0].id;
 const lesson=await add(dates.today),old=await add(dates.previous);
 const makeup=dates.week_start===dates.today?null:await add(dates.yesterday);
 await as('stu');
 await assert.rejects(()=>act('sign_in',{session_id:lesson}));
 await as('clubtr');
 await assert.rejects(()=>act('sign_in',{session_id:old}));
 await assert.rejects(()=>db.query(`select club_private.act_before_weekly_attendance('sign_in','{}')`),/permission denied/);
 if(makeup){
  await act('sign_in',{session_id:makeup});
  await act('attendance',{session_id:makeup,summary:'補登前一日課程',marks:{[sid]:'present'}});
 }
 await act('sign_in',{session_id:lesson});
 await act('attendance',{session_id:lesson,summary:'完成課程',marks:{[sid]:'present'}});
 assert.equal((await snapshot()).sessions.find(s=>s.id===lesson).status,'completed');
 await db.exec('reset role');
 const {id: leave}= (await db.query(`insert into club_private.leaves(session_id,student_id,kind,reason,status,created_by) values($1,$2,'事假','測試','approved',$3) returning id`,[lesson,sid,ids.stu])).rows[0];
 await db.query(`update club_private.attendance set status='leave' where session_id=$1 and student_id=$2`,[lesson,sid]);
 await as('stu');
 await follow('withdraw_leave',{id:leave});
 await as('clubtr');
 const refreshed=await snapshot();
 assert.equal(refreshed.sessions.find(s=>s.id===lesson).attendance_confirmed_at,null);
 assert.ok(!refreshed.attendance.some(a=>a.session_id===lesson&&a.student_id===sid));
 await act('attendance',{session_id:lesson,summary:'確認撤回後重新點名',marks:{[sid]:'present'}});
});
await check('帳號編修及登入憑證管理限行政，私密欄位不外露',async()=>{
 await as('stu');
 await assert.rejects(()=>follow('auth_account',{id:ids.other}));
 await as('admin');
 await assert.rejects(()=>follow('auth_account',{id:ids.hrtr}));
 await follow('edit_account',{id:ids.other,username:'new-student',name:'新版學生',roles:['stu'],notes:'校內備註',student_number:'007',term_id:term});
 let data=await snapshot();
 assert.equal(data.users.find(u=>u.id===ids.other).notes,'校內備註');
 assert.equal(data.students.find(s=>s.id===sid2).student_number,'007');
 await as('other');
 data=await snapshot();
 assert.ok(data.users.every(u=>!('notes' in u)&&!('email' in u)));
 assert.ok(data.students.every(s=>!('student_number' in s)));
});
await check('行政可單筆邀請管理員，未驗證及一般帳號不能取得或授予管理權',async()=>{
 const invite=async email=>(await db.query('select public.club_prepare_admin_account($1) result',[{email,name:'行政測試'}])).rows[0].result;
 const email='new-admin@example.com';
 ids.newManager='00000000-0000-0000-0000-000000000012';
 await as('anon');
 await assert.rejects(()=>invite(email),/permission denied/);
 await as('stu');
 await assert.rejects(()=>invite(email));
 await as('admin');
 assert.equal((await invite(email)).pending,1);
 await assert.rejects(()=>db.query('select public.club_import_accounts($1)',[{rows:[{email:'bulk@example.com',name:'批次行政',role:'admin'}]}]));
 await db.exec('reset role');
 await db.query('insert into auth.users(id,email) values($1,$2)',[ids.newManager,email]);
 await as('newManager');
 await db.query('select public.club_claim_account()');
 await assert.rejects(snapshot);
 await db.exec('reset role');
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[ids.newManager]);
 await as('newManager');
 await db.query('select public.club_claim_account()');
 assert.deepEqual((await snapshot()).users.find(u=>u.id===ids.newManager).roles,['admin']);
 assert.ok(!(await snapshot()).pending_accounts.some(p=>p.email===email));
 await as('admin');
 assert.equal((await invite('clubtr@test.aimen.invalid')).bound,1);
 assert.deepEqual((await snapshot()).users.find(u=>u.id===ids.clubtr).roles,['clubtr','admin']);
 await assert.rejects(()=>invite('guardian@example.com'));
});
const registerSchool=payload=>db.query('select public.club_register_school_account($1)',[payload]);
const changeRequired=async()=>(await db.query('select public.club_school_password_required() value')).rows[0].value;
const confirmSchoolPassword=id=>db.query('select public.club_complete_school_password($1)',[id]);
await check('新校用帳號限行政核發，行政、導師及社團老師首次登入須換密碼',async()=>{
 for(const [index,role] of ['admin','hrtr','clubtr'].entries()){
  const username='schoolstaff'+index,id='10000000-0000-0000-0000-00000000000'+index;
  ids[username]=id;
  const staff={id,username,name:'新進教師',role};
  await db.exec('reset role');
  await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)',
   [id,username+'@accounts.aimen.invalid',{aimen_issued_by:ids.admin}]);
  await as('anon');await assert.rejects(()=>registerSchool(staff),/permission denied/);await assert.rejects(changeRequired,/permission denied/);
  await as('stu');await assert.rejects(()=>registerSchool(staff),/僅行政/);
  await as('newManager');await assert.rejects(()=>registerSchool(staff),/帳號服務/);
  await as('admin');await registerSchool(staff);
  await as(username);
  assert.equal(await changeRequired(),true);
  await assert.rejects(snapshot,/首次登入/);
  await assert.rejects(()=>act('add_student',{}),/首次登入/);
  await assert.rejects(()=>confirmSchoolPassword(id),/permission denied/);
  const before='20000000-0000-0000-0000-00000000000'+index;
  const after='30000000-0000-0000-0000-00000000000'+index;
  await db.exec('reset role');
  await db.query("insert into auth.sessions values($1,$2,clock_timestamp()-interval '1 second')",[before,id]);
  await db.exec('set role service_role');await confirmSchoolPassword(id);
  await as(username);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({session_id:before})]);
  assert.equal(await changeRequired(),false);
  await assert.rejects(snapshot,/重新登入/);
  await db.exec('reset role');
  await db.query("insert into auth.sessions values($1,$2,clock_timestamp()+interval '1 second')",[after,id]);
  await as(username);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({session_id:after})]);
  assert.deepEqual((await snapshot()).users.find(u=>u.id===id).roles,[role]);
 }
});
await check('新學生及家長可直接登入，只能查看綁定的學生資料',async()=>{
 await as('admin');
 await act('add_student',{term_id:term,name:'新學生',class_name:'六甲',number:'99'});
 const pupil=(await snapshot()).students.find(s=>s.name==='新學生').id;
 for(const [index,role] of ['stu','guardian'].entries()){
  const username='family'+index,id='40000000-0000-0000-0000-00000000000'+index;
  ids[username]=id;
  await db.exec('reset role');
  await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)',
   [id,username+'@accounts.aimen.invalid',{aimen_issued_by:ids.admin}]);
  await as('admin');
  await registerSchool({id,username,name:'受邀家庭',role,student_id:pupil});
  await assert.rejects(()=>follow('edit_account',{id,username:'replacement',name:'變更',roles:[role]}));
  await as(username);
  assert.equal(await changeRequired(),false);
  assert.deepEqual((await snapshot()).students.map(s=>s.id),[pupil]);
 }
 await as('admin');
 await follow('edit_account',{id:ids.family0,username:'family0',name:'升級角色',roles:['stu','hrtr']});
 await as('family0');
 assert.equal(await changeRequired(),true);
 await assert.rejects(snapshot,/首次登入/);
});
await check('公開行事曆限已發布社團及使用中學期，匿名僅取得允許的欄位',async()=>{
 await db.exec('reset role');
 const [{id:archived}]=(await db.query("insert into club_private.terms(name,start_date,end_date,status) values('封存測試','2026-08-01','2027-01-31','archived') returning id")).rows;
 const makeClub=async(termId,name,status)=>(await db.query(
  `insert into club_private.clubs(term_id,name,plan_name,kind,teacher_id,location,capacity,rate,registration_start,registration_end,status)
   values($1,$2,'內部計畫','社團',$3,'公開地點',10,500,'2026-08-01','2027-01-31',$4) returning id`,
  [termId,name,ids.clubtr,status])).rows[0].id;
 const pub=await makeClub(term,'公開社團','published');
 const draft=await makeClub(term,'草稿社團','draft');
 const old=await makeClub(archived,'封存社團','published');
 const makeSession=(club,starts,ends,status='scheduled')=>db.query(
  `insert into club_private.sessions(club_id,teacher_id,starts_at,ends_at,units,rate,summary,status) values($1,$2,$3,$4,1,500,'內部教學摘要',$5)`,
  [club,ids.clubtr,starts,ends,status]);
 await makeSession(pub,'2026-11-15T23:30:00+08:00','2026-11-16T00:00:00+08:00');
 await makeSession(pub,'2026-11-16T00:00:00+08:00','2026-11-16T00:30:00+08:00');
 await makeSession(pub,'2026-11-22T17:00:00+08:00','2026-11-22T18:00:00+08:00','cancelled');
 await makeSession(pub,'2026-11-23T00:00:00+08:00','2026-11-23T00:30:00+08:00');
 for(const club of [draft,old])await makeSession(club,'2026-11-16T12:00:00+08:00','2026-11-16T13:00:00+08:00');

 const calendar=async date=>(await db.query('select * from public.club_public_calendar($1)',[date])).rows;
 await as('anon');
 const publicRows=await calendar('2026-11-16');
 assert.ok(!publicRows.some(r=>['草稿社團','封存社團'].includes(r.club_name)));
 const rows=publicRows.filter(r=>r.club_name==='公開社團');
 assert.equal(rows.length,2);
 assert.deepEqual(Object.keys(rows[0]).sort(),['cancelled','club_name','ends_at','location','starts_at']);
 assert.equal(rows[0].location,'公開地點');
 assert.equal(new Date(rows[0].starts_at).toISOString(),'2026-11-15T16:00:00.000Z');
 assert.equal(rows[1].cancelled,true);
 assert.equal((await calendar('2026-11-17')).length,0);
 assert.ok((await calendar('2026-11-23')).some(r=>r.club_name==='公開社團'));
 await assert.rejects(()=>db.query('select * from club_private.sessions'),/permission denied/);
 await assert.rejects(snapshot,/permission denied/);
 await as('stu');
 assert.deepEqual(await calendar('2026-11-16'),publicRows);
});
await db.exec('reset role');
await db.exec(await fs.readFile(new URL('../supabase/schemas/011_student_portal.sql',import.meta.url),'utf8'));
const provision=payload=>db.query('select public.club_provision_student($1)',[payload]);
const resolveStudent=async payload=>(await db.query('select public.club_resolve_student($1) email',[payload])).rows[0].email;
await check('學生匯入原子建立名冊及帳號，連結與名冊欄位一起比對',async()=>{
 ids.portalStudent='50000000-0000-0000-0000-000000000001';
 const username='newportal1',email=username+'@accounts.aimen.invalid';
 const payload={id:ids.portalStudent,username,name:'新生甲',class_name:'新一甲',number:'01',term_id:term,card_hash:'a'.repeat(64),openid_hash:'b'.repeat(64)};
 await as('anon');await assert.rejects(()=>provision(payload),/permission denied/);
 await as('admin');await assert.rejects(()=>provision(payload),/帳號服務/);
 assert.ok(!(await snapshot()).students.some(s=>s.name===payload.name));
 await db.exec('reset role');
 await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)',[ids.portalStudent,email,{aimen_issued_by:ids.admin}]);
 await as('admin');await provision(payload);
 const admin=await snapshot(),pupil=admin.students.find(s=>s.name===payload.name);
 assert.equal(pupil.user_id,ids.portalStudent);
 assert.ok(admin.student_links.includes(pupil.id));
 assert.ok(!JSON.stringify(admin).includes(payload.card_hash));
 const checkId={class_name:payload.class_name,number:'1',last_character:'甲',card_hash:payload.card_hash,openid_hash:payload.openid_hash};
 await assert.rejects(()=>resolveStudent(checkId),/permission denied/);
 await assert.rejects(()=>provision({...payload,id:null,number:'1',name:'另一位'}),/不同學生/);
 await assert.rejects(()=>provision({...payload,id:null,number:'1'}),/已發行/);
 await db.exec('reset role; set role service_role');
 assert.equal(await resolveStudent(checkId),email);
 for(const mismatch of [{last_character:'乙'},{class_name:'陌生班'},{number:'2'},{openid_hash:'c'.repeat(64)},{card_hash:'d'.repeat(64)}])
  assert.equal(await resolveStudent({...checkId,...mismatch}),null);
 await as('admin');await provision({...payload,id:null,number:'1',replace:true,card_hash:'d'.repeat(64)});
 await db.exec('reset role; set role service_role');
 assert.equal(await resolveStudent(checkId),null);
 assert.equal(await resolveStudent({...checkId,card_hash:'d'.repeat(64)}),email);
 await as('portalStudent');
 const personal=await snapshot();
 assert.deepEqual(personal.students.map(s=>s.id),[pupil.id]);
 assert.deepEqual(personal.sessions,[]);
 assert.deepEqual(personal.leaves,[]);
 await assert.rejects(()=>act('leave',{}),/學生僅能/);
 await assert.rejects(()=>follow('withdraw_leave',{}),/限教職員/);
 await act('enroll',{club_id:cid,student_id:pupil.id});
 assert.ok((await snapshot()).enrollments.some(e=>e.student_id===pupil.id));
 await as('admin');
 await assert.rejects(()=>db.query("select public.club_manage('link_guardian','{}')"),/不適用/);
});
await check('隔離測試學期、關閉測試帳號，保留名冊關聯並建立空白正式學期',async()=>{
 await db.exec('reset role');
 await db.exec(await fs.readFile(new URL('../supabase/schemas/012_separate_test_term.sql',import.meta.url),'utf8'));
 const {rows}=await db.query(`select t.id,t.name,t.status,count(s.id)::int pupils from club_private.terms t left join club_private.students s on s.term_id=t.id where t.name in ('115test','115-1') group by t.id`);
 assert.ok(rows.some(t=>t.name==='115test'&&t.id===term&&t.status==='archived'&&t.pupils>0));
 assert.ok(rows.some(t=>t.name==='115-1'&&t.id!==term&&t.status==='active'&&t.pupils===0));
 await as('admin');await assert.rejects(snapshot,/尚未獲授權/);
 await as('newManager');assert.ok((await snapshot()).terms.some(t=>t.name==='115-1'));
 await as('portalStudent');await assert.rejects(snapshot,/尚未啟用/);
 await as('anon');
 const published=(await db.query("select * from public.club_public_calendar('2026-11-16')")).rows;
 assert.ok(!published.some(r=>r.club_name==='測試社團'));
});
await db.close();console.log(`${count} database security scenarios passed`);
