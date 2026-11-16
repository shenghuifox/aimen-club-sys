import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
await db.exec(await fs.readFile(new URL('../supabase/schemas/001_club.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/schemas/002_recurring_and_student_binding.sql',import.meta.url),'utf8'));
const ids={admin:'00000000-0000-0000-0000-000000000001',stu:'00000000-0000-0000-0000-000000000002',clubtr:'00000000-0000-0000-0000-000000000003',hrtr:'00000000-0000-0000-0000-000000000004',other:'00000000-0000-0000-0000-000000000005'};
for(const [role,id] of Object.entries(ids)){await db.query('insert into auth.users values($1)',[id]);await db.query('insert into club_private.users(id,username,name,roles) values($1,$2,$2,$3)',[id,role,[role==='other'?'stu':role]]);}
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
await db.close();console.log(`${count} database security scenarios passed`);
