import {addDays,dateKey,weekDays,settlementPreview,has,enrolledOn,intersects} from './domain.js';
import {recurringPreview} from './recurrence.js';
export function seed(){
 const monday=weekDays(dateKey())[0], term='term-115-1';
 const users=[{id:'admin',username:'admin',name:'行政測試',roles:['admin']},{id:'stu',username:'stu',name:'學生測試',roles:['stu']},{id:'clubtr',username:'clubtr',name:'社團老師測試',roles:['clubtr']},{id:'hrtr',username:'hrtr',name:'班級導師測試',roles:['hrtr']},{id:'guardian',username:'guardian',name:'家長測試',roles:['guardian']}];
 const clubs=[{id:'football',term_id:term,name:'足球小將',description:'從傳接球到團隊合作，在球場上找到自己的節奏。',plan_name:'課後多元學習計畫',teacher_id:'clubtr',location:'學校操場',capacity:20,rate:400,kind:'社團',status:'published',color:'#e7a968',registration_start:addDays(monday,-30),registration_end:addDays(monday,30)},
 {id:'art',term_id:term,name:'玩色美術',description:'觀察生活、自由創作，用色彩記錄島嶼日常。',plan_name:'課後多元學習計畫',teacher_id:'clubtr',location:'美術教室',capacity:16,rate:400,kind:'社團',status:'published',color:'#a6a0cf',registration_start:addDays(monday,-30),registration_end:addDays(monday,30)},
 {id:'study',term_id:term,name:'課後作業指導',description:'陪伴完成作業，建立自主學習與閱讀習慣。',plan_name:'課後照顧計畫',teacher_id:'hrtr',location:'三年甲班',capacity:25,rate:350,kind:'課後班',status:'published',color:'#7bb8ac',registration_start:addDays(monday,-30),registration_end:addDays(monday,30)}];
 const students=[{id:'s1',user_id:'stu',term_id:term,name:'測試學生一',class_name:'三年甲班',homeroom_id:'hrtr',number:'01'},{id:'s2',user_id:null,term_id:term,name:'測試學生二',class_name:'三年甲班',homeroom_id:'hrtr',number:'02'},{id:'s3',user_id:null,term_id:term,name:'測試學生三',class_name:'四年甲班',homeroom_id:null,number:'01'}];
 const specs=[['football',0,'15:30','16:50',2],['art',1,'15:30','16:50',2],['study',0,'13:30','15:00',2],['study',2,'13:30','15:00',2],['football',3,'15:30','16:50',2],['art',4,'13:30','14:50',2],['football',-7,'15:30','16:50',2]];
 const sessions=specs.map(([cid,day,start,end,units],i)=>({id:'session-'+i,club_id:cid,teacher_id:clubs.find(c=>c.id===cid).teacher_id,starts_at:`${addDays(monday,day)}T${start}:00+08:00`,ends_at:`${addDays(monday,day)}T${end}:00+08:00`,units,rate:clubs.find(c=>c.id===cid).rate,summary:day<0?'傳接球練習與小組合作':'',status:day<0?'completed':'scheduled',signed_at:day<0?`${addDays(monday,day)}T15:28:00+08:00`:null,attendance_confirmed_at:day<0?`${addDays(monday,day)}T16:50:00+08:00`:null}));
 return {users,guardian_links:[{guardian_id:'guardian',student_id:'s1'}],terms:[{id:term,name:'115-1',status:'active',start_date:'2026-08-01',end_date:'2027-01-31'}],clubs,students,sessions,enrollments:[{id:'e1',club_id:'football',student_id:'s1',status:'enrolled',start_date:addDays(monday,-30),end_date:null},{id:'e2',club_id:'football',student_id:'s2',status:'enrolled',start_date:addDays(monday,-30),end_date:null},{id:'e3',club_id:'study',student_id:'s1',status:'enrolled',start_date:addDays(monday,-30),end_date:null}],attendance:[{session_id:'session-6',student_id:'s1',status:'present'},{session_id:'session-6',student_id:'s2',status:'present'}],leaves:[],changes:[],settlements:[],audit:[]};
}
export function demoAction(data,user,action,p){
 const d=structuredClone(data), id=()=>crypto.randomUUID(), now=new Date().toISOString(), isAdmin=has(user,'admin');
 const fail=m=>{throw Error(m);}, requireAdmin=()=>{if(!isAdmin)fail('僅行政管理者可操作。');};
 const club=d.clubs.find(c=>c.id===p.club_id), student=d.students.find(s=>s.id===p.student_id), session=d.sessions.find(s=>s.id===p.session_id);
 const manageStudent=s=>s&&(isAdmin||s.homeroom_id===user.id||s.user_id===user.id||d.enrollments.some(e=>e.student_id===s.id&&d.clubs.find(c=>c.id===e.club_id)?.teacher_id===user.id));
 const unlocked=(cid,date)=>{if(d.settlements.some(b=>b.club_id===cid&&date>=b.start_date&&date<=b.end_date))fail('該期間已鎖定，請走核銷更正流程。');};
 const termOpen=cid=>{if(d.terms.find(t=>t.id===d.clubs.find(c=>c.id===cid)?.term_id)?.status!=='active')fail('學期已封存。');};
 if(action==='withdraw_leave'){
  const l=d.leaves.find(l=>l.id===p.id&&['pending','approved'].includes(l.status));
  const s=d.students.find(s=>s.id===l?.student_id), se=d.sessions.find(s=>s.id===l?.session_id);
  if(!l||!s||!se||!(isAdmin||(!has(user,'guardian')&&l.created_by===user.id)||s.user_id===user.id||
    (has(user,'hrtr')&&s.homeroom_id===user.id)||(has(user,'clubtr')&&se.teacher_id===user.id)||
    d.guardian_links.some(g=>g.guardian_id===user.id&&g.student_id===s.id)))fail('沒有撤回這張假單的權限。');
  termOpen(se.club_id);
  if(l.status==='approved'){
   const date=dateKey(new Date(se.starts_at));
   unlocked(se.club_id,date);
   if(d.attendance.some(a=>a.session_id===se.id&&a.student_id===s.id&&a.status==='leave')){
    if(!weekDays(dateKey()).includes(date))fail('此假單已帶入往週點名，請由學校處理更正。');
    se.status='scheduled';se.attendance_confirmed_at=null;
   }
  }
  l.status='withdrawn';
 }else if(action==='withdraw_change'){
  const c=d.changes.find(c=>c.id===p.id&&c.status==='pending');
  if(!c||!(isAdmin||has(user,'clubtr')&&c.created_by===user.id&&d.clubs.some(club=>club.id===c.club_id&&club.teacher_id===user.id)))fail('沒有撤回待確認異動的權限。');
  termOpen(c.club_id);c.status='withdrawn';
 }else if(action==='edit_account'){
  requireAdmin();
  const target=d.users.find(u=>u.id===p.id);
  if(!target||!p.username?.trim()||!p.name?.trim()||!p.roles?.length) fail('請確認帳號、名稱與角色。');
  if(d.users.some(u=>u.id!==target.id&&u.username.toLowerCase()===p.username.trim().toLowerCase()))fail('此帳號已被使用。');
  if(has(target,'guardian')!==p.roles.includes('guardian'))fail('請從學生名冊管理家長綁定。');
  if(target.active!==false&&has(target,'admin')&&!p.roles.includes('admin')&&d.users.filter(u=>u.active!==false&&has(u,'admin')).length<=2)fail('請保留至少兩位有效管理者。');
  Object.assign(target,{username:p.username.trim(),name:p.name.trim(),roles:p.roles,notes:p.notes||''});
  const linked=d.students.find(s=>s.user_id===target.id&&s.term_id===p.term_id);
  if(linked)linked.student_number=p.student_number||'';
 }else if(action==='account_status'){
  requireAdmin();
  const target=d.users.find(u=>u.id===p.id);
  if(!target||target.id===user.id||!p.reason?.trim())fail('請選其他帳號並填寫原因。');
  if(!p.active&&has(target,'admin')&&d.users.filter(u=>u.active!==false&&has(u,'admin')).length<=2)fail('請保留至少兩位有效管理者。');
  target.active=p.active;
 }else if(action==='copy_term'){
  requireAdmin();
  const source=d.terms.find(t=>t.id===p.id),name=p.name?.trim();
  if(!source||!name||p.start_date>p.end_date||d.terms.some(t=>t.name===name))fail('請確認學期名稱及日期，名稱不可重複。');
  const newTerm=id(),offset=Math.round((new Date(p.start_date)-new Date(source.start_date))/86400000);
  d.terms.push({id:newTerm,name,start_date:p.start_date,end_date:p.end_date,status:'active'});
  const names=new Map();
  for(const s of d.students.filter(s=>s.term_id===source.id)){
   const next=id();
   names.set(s.id,next);
   d.students.push({...s,id:next,term_id:newTerm});
  }
  d.guardian_links.push(...d.guardian_links.filter(g=>names.has(g.student_id)).map(g=>({...g,student_id:names.get(g.student_id)})));
  const shift=date=>[addDays(date,offset),p.end_date].sort()[0];
  d.clubs.push(...d.clubs.filter(c=>c.term_id===source.id).map(c=>({...c,id:id(),term_id:newTerm,status:'draft',activity_ref:'',registration_start:shift(c.registration_start),registration_end:shift(c.registration_end)})));
 }else if(action==='link_guardian'||action==='unlink_guardian'){
  requireAdmin();
  if(!student||(!p.email&&action==='link_guardian'))fail('請核對學生及家長帳號。');
  if(action==='unlink_guardian')d.guardian_links=d.guardian_links.filter(g=>g.guardian_id!==p.id||g.student_id!==student.id);
  else {
   const email=p.email.trim().toLowerCase();
   let account=d.users.find(u=>u.username===email);
   if(account&&(!has(account,'guardian')||account.active===false))fail('該帳號已停權或使用其他身分。');
   if(!account){account={id:id(),username:email,name:p.name,roles:['guardian']};d.users.push(account);}
   if(!d.guardian_links.some(g=>g.guardian_id===account.id&&g.student_id===student.id))d.guardian_links.push({guardian_id:account.id,student_id:student.id});
  }
 }else if(action==='guardian_leave'){
  if(!has(user,'guardian')||!session||session.status!=='scheduled'||!student||!p.reason?.trim()||
    !d.guardian_links.some(g=>g.guardian_id===user.id&&g.student_id===student.id)||
    !d.enrollments.some(e=>e.student_id===student.id&&e.club_id===session.club_id&&enrolledOn(e,dateKey(new Date(session.starts_at)))))fail('請核對孩子、課程及請假原因。');
  termOpen(session.club_id);unlocked(session.club_id,dateKey(new Date(session.starts_at)));
  if(d.leaves.some(l=>l.session_id===session.id&&l.student_id===student.id&&['pending','approved'].includes(l.status)))fail('此節已有假單。');
  d.leaves.push({id:id(),student_id:student.id,session_id:session.id,kind:p.kind,reason:p.reason,status:'pending',created_by:user.id,created_at:now});
 }else if(action==='edit_club'){
  requireAdmin();
  const target=d.clubs.find(c=>c.id===p.id);
  if(!target)fail('找不到社團。');
  termOpen(target.id);
  Object.assign(target,p);
 }else if(action==='import_accounts'){
  requireAdmin();
  d.pending_accounts??=[];
  for (const row of p.rows) {
   const s=row.role==='stu'?d.students.find(s=>s.term_id===p.term_id && s.class_name===row.class_name && s.number===row.number && s.name===row.name):null;
   if (row.role==='stu'&&!s) fail('找不到符合學期、班級、座號及姓名的學生。');
   if (s&&d.terms.find(t=>t.id===s.term_id)?.status!=='active') fail('學期已封存。');
   const account=d.users.find(u=>(u.username.includes('@')?u.username:u.username+'@test.aimen.invalid')===row.email);
   const pending=d.pending_accounts.find(a=>a.email===row.email);
   if ((pending&&(pending.role!==row.role||pending.student_id!==(s?.id||null)))||
      (s&&d.pending_accounts.some(a=>a.student_id===s.id&&a.email!==row.email))) fail('已存在不同的待啟用設定。');
   if (s?.user_id&&s.user_id!==account?.id) fail('此學生已綁定其他帳號。');
   if (account) {
    if (!has(account,row.role)) fail('既有帳號角色不一致。');
    if (s&&d.students.some(other=>other.id!==s.id&&other.term_id===p.term_id&&other.user_id===account.id)) fail('帳號已綁定其他學生。');
    if (s) s.user_id=account.id;
   } else {
    if (row.email.endsWith('.invalid')) fail('找不到已建立的測試帳號。');
    if (pending) pending.name=row.name;
    else d.pending_accounts.push({email:row.email,name:row.name,role:row.role,student_id:s?.id||null});
   }
  }
 }else if(action==='cancel_account'){
  requireAdmin();
  d.pending_accounts=(d.pending_accounts||[]).filter(a=>a.email!==p.email);
 }else if(action==='batch_roster'){
  requireAdmin();
  if (!club) fail('請選擇社團。');
  termOpen(club.id);
  const term=d.terms.find(t=>t.id===club.term_id);
  if (!['rejected','waitlisted'].includes(p.operation)) {
   if (!p.effective_date||p.effective_date<term.start_date||p.effective_date>term.end_date) fail('生效日期須在社團所屬學期內。');
   if (d.sessions.some(s=>s.club_id===club.id && s.status!=='cancelled' &&
       (s.signed_at||s.status==='completed') && dateKey(new Date(s.starts_at))>=p.effective_date)) fail('生效日會影響已授課的課程。');
   if (d.settlements.some(s=>s.club_id===club.id && s.end_date>=p.effective_date)) fail('生效日會影響已鎖定期間。');
  }
  if (!p.ids.length||p.ids.length>200||new Set(p.ids).size!==p.ids.length) fail('每批可處理 1 至 200 位不同的學生。');
  return p.ids.reduce((current,target)=>{
   if (['enrolled','rejected','waitlisted'].includes(p.operation)) {
    const e=current.enrollments.find(e=>e.id===target&&e.club_id===club.id&&['pending','waitlisted'].includes(e.status)&&e.status!==p.operation);
    if (!e) fail('有報名已處理或不屬於選定社團。');
    if(p.operation==='waitlisted'){
     e.status='waitlisted';
     return current;
    }
    e.status='pending';
    return demoAction(current,user,'admit',{id:target,status:p.operation,start_date:p.effective_date||e.start_date});
   }
   if (!['add_student','remove_student'].includes(p.operation)||!p.reason?.trim()) fail('請選擇增退方式並填寫異動原因。');
   if (!current.students.some(s=>s.id===target&&s.term_id===term.id)) fail('學生不在選定社團的學期名冊。');
   return demoAction(current,user,'change',{club_id:club.id,student_id:target,kind:p.operation,effective_date:p.effective_date,reason:p.reason});
  },d);
 }else if(action==='batch_sessions'){
  requireAdmin();if(!club)fail('請選擇社團。');termOpen(club.id);const rows=recurringPreview(d,p);if(rows.some(r=>r.result==='conflict'))fail('批次包含衝突，未新增任何課程。');
  rows.filter(r=>r.result==='new').forEach(r=>d.sessions.push({...r,id:id(),summary:'',status:'scheduled',signed_at:null,attendance_confirmed_at:null}));
 }else if(action==='update_student'){
  requireAdmin();const target=d.students.find(s=>s.id===p.id);if(!target)fail('學生名冊不存在。');if(d.terms.find(t=>t.id===target.term_id)?.status!=='active')fail('學期已封存。');
  if(!p.name?.trim()||!p.class_name?.trim()||!p.number?.trim())fail('姓名、班級、座號不可空白。');
  if(p.user_id&&!d.users.some(u=>u.id===p.user_id&&has(u,'stu')))fail('請選擇學生帳號。');if(p.homeroom_id&&!d.users.some(u=>u.id===p.homeroom_id&&has(u,'hrtr')))fail('請選擇導師帳號。');
  if(p.user_id&&d.students.some(s=>s.id!==target.id&&s.term_id===target.term_id&&s.user_id===p.user_id))fail('此帳號已綁定本學期其他學生。');
  Object.assign(target,{name:p.name.trim(),class_name:p.class_name.trim(),number:p.number.trim(),user_id:p.user_id||null,homeroom_id:p.homeroom_id||null});
 }else if(action==='leave'){
  if(!student||!session||!manageStudent(student))fail('沒有這位學生或課程的操作權限。');
  termOpen(session.club_id);
  if(!['公假','事假','病假'].includes(p.kind)||!p.reason?.trim())fail('請填寫假別與事由。');
  if(!d.enrollments.some(e=>e.student_id===student.id&&e.club_id===session.club_id&&enrolledOn(e,dateKey(new Date(session.starts_at)))))fail('學生未參加該次課程。');
  if(d.leaves.some(l=>l.student_id===student.id&&l.session_id===session.id&&['pending','approved'].includes(l.status)))fail('該課程已有請假申請。');
  d.leaves.push({id:id(),student_id:student.id,session_id:session.id,kind:p.kind,reason:p.reason,status:isAdmin||student.homeroom_id===user.id?'approved':'pending',created_by:user.id,created_at:now,reviewed_by:isAdmin||student.homeroom_id===user.id?user.id:null});
 }else if(action==='review_leave'){
  const l=d.leaves.find(x=>x.id===p.id), s=d.students.find(x=>x.id===l?.student_id);if(!l||(!isAdmin&&s?.homeroom_id!==user.id))fail('沒有覆核權限。');if(l.status!=='pending')fail('申請已處理。');if(!['approved','rejected'].includes(p.status))fail('狀態不正確。');l.status=p.status;l.reviewed_by=user.id;l.reviewed_at=now;
 }else if(action==='enroll'){
  if(!club||!student||(!isAdmin&&student.user_id!==user.id))fail('沒有報名權限。');termOpen(club.id);
  if(!isAdmin&&(club.status!=='published'||dateKey()<club.registration_start||dateKey()>club.registration_end))fail('目前不在報名期間。');
  if(d.enrollments.some(e=>e.club_id===club.id&&e.student_id===student.id&&['pending','waitlisted','enrolled'].includes(e.status)&&!e.end_date))fail('已有報名紀錄。');
  d.enrollments.push({id:id(),club_id:club.id,student_id:student.id,status:'pending',start_date:dateKey(),end_date:null});
 }else if(action==='admit'){
  requireAdmin();const e=d.enrollments.find(x=>x.id===p.id);if(!e)fail('找不到報名。');const c=d.clubs.find(c=>c.id===e.club_id);termOpen(c.id);
  if(e.status!=='pending')fail('報名已處理。');
  if(p.status==='enrolled') checkDemoAdmission(d,c.id,e.student_id,p.start_date||dateKey());
  if(!['enrolled','rejected'].includes(p.status))fail('狀態不正確。');e.status=p.status;e.start_date=p.start_date||dateKey();
 }else if(action==='sign_in'){
  if(!session||(!isAdmin&&session.teacher_id!==user.id))fail('僅授課教師可簽到。');termOpen(session.club_id);unlocked(session.club_id,dateKey(new Date(session.starts_at)));if(session.status==='cancelled')fail('課程已停課。');if(!weekDays(dateKey()).includes(dateKey(new Date(session.starts_at)))||dateKey(new Date(session.starts_at))>dateKey())fail('只能在本週補登已到日期的課程。');session.signed_at??=now;
 }else if(action==='attendance'){
  if(!session||(!isAdmin&&session.teacher_id!==user.id))fail('沒有點名權限。');termOpen(session.club_id);unlocked(session.club_id,dateKey(new Date(session.starts_at)));if(!weekDays(dateKey()).includes(dateKey(new Date(session.starts_at))))fail('只能補點本週課程。');if(!p.summary?.trim())fail('請填寫課程摘要。');if(!session.signed_at)fail('請先完成教師簽到。');if(new Date(session.starts_at)>new Date())fail('課程尚未開始。');
  const roster=d.enrollments.filter(e=>e.club_id===session.club_id&&enrolledOn(e,dateKey(new Date(session.starts_at))));
  if(roster.some(e=>!['present','absent','late','leave'].includes(p.marks?.[e.student_id])))fail('請完成每位學生的點名。');
  d.attendance=d.attendance.filter(a=>a.session_id!==session.id);roster.forEach(e=>d.attendance.push({session_id:session.id,student_id:e.student_id,status:d.leaves.some(l=>l.session_id===session.id&&l.student_id===e.student_id&&l.status==='approved')?'leave':p.marks[e.student_id]}));
  session.summary=p.summary;session.attendance_confirmed_at=now;session.status='completed';
 }else if(action==='save_club'||action==='create_club'){
  requireAdmin();if(!p.name?.trim()||Number(p.capacity)<1||Number(p.rate)<0)fail('請檢查名稱、名額與費率。');d.clubs.push({...p,id:id(),status:'draft',color:'#7bb8ac'});
 }else if(action==='publish_club'){
  requireAdmin();if(!club)fail('找不到社團。');termOpen(club.id);club.status=club.status==='published'?'draft':'published';
 }else if(action==='add_session'){
  requireAdmin();if(!club)fail('找不到社團。');termOpen(club.id);unlocked(club.id,dateKey(new Date(p.starts_at)));if(!(new Date(p.ends_at)>new Date(p.starts_at))||Number(p.units)<=0)fail('請檢查時間與節數。');if(d.sessions.some(s=>s.status!=='cancelled'&&s.teacher_id===p.teacher_id&&intersects(s,p)))fail('教師上課時間衝突。');d.sessions.push({...p,id:id(),status:'scheduled',summary:'',signed_at:null,attendance_confirmed_at:null});
 }else if(action==='change'){
  if(!club||(!isAdmin&&club.teacher_id!==user.id))fail('沒有異動權限。');termOpen(club.id);if(!p.reason?.trim())fail('請填寫異動原因。');
  const change={id:id(),...p,status:isAdmin?'approved':'pending',created_by:user.id,created_at:now};
  if(isAdmin)applyChange(d,change,unlocked);d.changes.push(change);
 }else if(action==='edit_change'){
  const c=d.changes.find(x=>x.id===p.id),cClub=d.clubs.find(x=>x.id===c?.club_id);
  if(!c||(!isAdmin&&!(c.created_by===user.id&&cClub?.teacher_id===user.id&&has(user,'clubtr'))))fail('沒有編修此異動的權限。');termOpen(c.club_id);
  if(Number(p.expected_revision)!==(c.revision||1))fail('紀錄已更新，請重新整理。');if(d.changes.some(x=>x.supersedes_id===c.id&&['pending','approved'].includes(x.status)))fail('已有修訂，請編修最新版本。');
  if(!p.reason?.trim())fail('請填寫原因。');
  const before=structuredClone(c);delete before.edit_history;
  const history=[...(c.edit_history||[]),{edited_at:now,edited_by:user.id,before}];
  if(c.status==='approved'&&['add_student','remove_student'].includes(c.kind)){
   if((p.student_id!=null&&p.student_id!==c.student_id)||(p.effective_date!=null&&p.effective_date!==c.effective_date))fail('已生效學生增退僅可編修說明，名單調整請新增異動。');
   if(d.settlements.some(b=>b.club_id===c.club_id&&b.end_date>=c.effective_date))fail('涉及核銷鎖定期間。');c.reason=p.reason;c.revision=(c.revision||1)+1;c.edit_history=history;
  }else{
   if((p.club_id&&p.club_id!==c.club_id)||(p.kind&&p.kind!==c.kind))fail('不可更換社團或異動類型。');
   if(['reschedule','weekly'].includes(c.kind)){
    if(c.status==='approved'&&p.session_id!==c.session_id)fail('不可更換已確認的原課程。');
    const source=d.sessions.find(s=>s.id===p.session_id&&s.club_id===c.club_id);if(!source||source.status!=='scheduled'||source.signed_at)fail('請選擇尚未簽到的待上課節次。');
    unlocked(c.club_id,dateKey(new Date(source.starts_at)));unlocked(c.club_id,dateKey(new Date(p.starts_at)));if(!(new Date(p.ends_at)>new Date(p.starts_at))||!(Number(p.units)>0))fail('時間或節數不正確。');
   }
   const fields={reason:p.reason,student_id:p.student_id||null,effective_date:p.effective_date||null,session_id:p.session_id||null,starts_at:p.starts_at||null,ends_at:p.ends_at||null,teacher_id:p.teacher_id||null,units:p.units||null,rate:p.rate??null};
   if(c.status==='pending')Object.assign(c,fields,{revision:(c.revision||1)+1,edit_history:history});
   else {const next={...c,...fields,id:id(),created_by:user.id,created_at:now,status:isAdmin?'approved':'pending',supersedes_id:c.id,revision:1,edit_history:[history.at(-1)]};if(isAdmin)applyChange(d,next,unlocked);d.changes.push(next);}
  }
 }else if(action==='review_change'){
  requireAdmin();const c=d.changes.find(x=>x.id===p.id);if(!c||c.status!=='pending')fail('異動已處理。');termOpen(c.club_id);if(p.status==='approved')applyChange(d,c,unlocked);c.status=p.status;c.reviewed_by=user.id;
 }else if(action==='settle'){
  requireAdmin();if(!club)fail('找不到社團。');termOpen(club.id);const snapshot=settlementPreview(d,p.club_id,p.start_date,p.end_date);d.settlements.push({id:id(),club_id:p.club_id,start_date:p.start_date,end_date:p.end_date,snapshot,created_at:now,created_by:user.id,paper_done:false,status:'locked'});
 }else if(action==='paper_done'){requireAdmin();const b=d.settlements.find(x=>x.id===p.id);if(!b)fail('找不到核銷。');b.paper_done=!b.paper_done;
 }else if(action==='fee_status'){
  requireAdmin();
  const entry=d.enrollments.find(e=>e.id===p.id&&e.status==='enrolled');
  if(!entry||!['','pending','paid','overdue'].includes(p.status))fail('請確認錄取及繳費狀態。');
  termOpen(entry.club_id);
  entry.fee_status=p.status||null;
 }else if(action==='void_settlement'){
  requireAdmin();
  const bill=d.settlements.find(b=>b.id===p.id);
  if(!bill||bill.paper_done||!p.reason?.trim())fail('請確認核銷尚未完成紙本作業並填寫原因。');
  termOpen(bill.club_id);
  d.voided_settlements??=[];
  d.voided_settlements.unshift({...bill,voided_at:now,voided_by:user.id,void_reason:p.reason.trim()});
  d.settlements=d.settlements.filter(b=>b.id!==bill.id);
 }else if(['cancel','makeup','swap'].includes(action)){
  requireAdmin();
  const day=s=>dateKey(new Date(s.starts_at));
  const checkSource=(s,status)=>{
   if(!s||s.status!==status||s.signed_at)fail('請選擇未簽到且符合異動條件的節次。');
   termOpen(s.club_id);
   unlocked(s.club_id,day(s));
  };
  const checkTime=s=>{
   if(!(new Date(s.ends_at)>new Date(s.starts_at)))fail('時間不正確。');
   unlocked(s.club_id,day(s));
   const term=d.terms.find(t=>t.id===d.clubs.find(c=>c.id===s.club_id)?.term_id);
   if(day(s)<term.start_date||dateKey(new Date(s.ends_at))>term.end_date)fail('上課日期超出學期。');
   const roster=cid=>d.enrollments.filter(e=>e.club_id===cid&&enrolledOn(e,day(s))).map(e=>e.student_id);
   const students=roster(s.club_id);
   if(d.sessions.some(x=>x.id!==s.id&&x.status!=='cancelled'&&intersects(x,s)&&
     (x.teacher_id===s.teacher_id||x.club_id===s.club_id||roster(x.club_id).some(sid=>students.includes(sid)))))fail('教師、社團或學生時間衝突。');
  };
  const record=(original,next)=>d.changes.unshift({id:id(),club_id:original.club_id,session_id:original.id,kind:action,
   reason:p.reason.trim(),starts_at:next.starts_at,ends_at:next.ends_at,original_dates:[original.starts_at],
   status:'approved',created_by:user.id,reviewed_by:user.id,created_at:now});
  if(!p.reason?.trim())fail('請填寫異動原因。');
  checkSource(session,action==='makeup'?'cancelled':'scheduled');
  if(action==='cancel'){
   session.status='cancelled';
   record(session,session);
  }else if(action==='makeup'){
   if(d.changes.some(c=>c.kind==='makeup'&&c.session_id===session.id))fail('此節次已排定補課。');
   const next={...session,id:id(),starts_at:p.starts_at,ends_at:p.ends_at,status:'scheduled'};
   checkTime(next);
   d.sessions.push(next);
   record(session,next);
  }else{
   const other=d.sessions.find(s=>s.id===p.other_id);
   checkSource(other,'scheduled');
   if(other.id===session.id||d.clubs.find(c=>c.id===other.club_id)?.term_id!==d.clubs.find(c=>c.id===session.club_id)?.term_id||
      d.leaves.some(l=>[session.id,other.id].includes(l.session_id)&&['pending','approved'].includes(l.status)))fail('請選擇同學期且無有效假單的兩個節次。');
   const move=(s,start)=>({...s,starts_at:start,ends_at:new Date(new Date(start).getTime()+new Date(s.ends_at)-new Date(s.starts_at)).toISOString()});
   const next=move(session,other.starts_at), swapped=move(other,session.starts_at);
   other.status='cancelled';
   checkTime(next);
   record(session,next);
   Object.assign(session,next);
   checkTime(swapped);
   record(other,swapped);
   Object.assign(other,swapped);
  }
 }else if(action==='roles'){
  requireAdmin();const target=d.users.find(u=>u.id===p.id);if(!target)fail('找不到使用者。');if(!p.roles?.length||p.roles.some(r=>!['admin','stu','clubtr','hrtr'].includes(r)))fail('請至少指定一個有效角色。');if(target.roles.includes('admin')&&!p.roles.includes('admin')&&d.users.filter(u=>u.roles.includes('admin')).length<=2)fail('需保留至少兩位權限管理者，請先完成交接。');target.roles=p.roles;
 }else if(action==='add_term'){
  requireAdmin();if(!p.name||p.start_date>p.end_date)fail('學期資料不正確。');d.terms.push({...p,id:id(),status:'active'});
 }else if(action==='archive_term'){requireAdmin();const t=d.terms.find(t=>t.id===p.id);if(t)t.status='archived';
 }else if(action==='add_student'){requireAdmin();if(!p.name||!p.class_name)fail('請填寫學生與班級。');d.students.push({...p,id:id(),user_id:p.user_id||null,homeroom_id:p.homeroom_id||null});
 }else fail('尚未支援的操作。');
 d.audit.unshift({id:id(),action,actor:user.name,created_at:now});return d;
}
function applyChange(d,c,unlocked){
 const fail=m=>{throw Error(m);};
 if(['add_student','remove_student'].includes(c.kind)){
  unlocked(c.club_id,c.effective_date);if(!d.students.some(s=>s.id===c.student_id))fail('請選學生。');
  const e=d.enrollments.find(e=>e.club_id===c.club_id&&e.student_id===c.student_id&&enrolledOn(e,c.effective_date));
  if(c.kind==='remove_student'){
   if(!e)fail('學生不在社團名單。');
   if(c.effective_date===e.start_date){
    const signed=d.sessions.some(s=>s.club_id===c.club_id&&s.status!=='cancelled'
     &&enrolledOn(e,dateKey(new Date(s.starts_at)))&&(s.signed_at||s.status==='completed'
      ||d.attendance.some(a=>a.session_id===s.id&&a.student_id===e.student_id)));
    if(signed)fail('已有簽到或點名，無法取消自加入日起的紀錄。');
    e.status='withdrawn';
   } else e.end_date=addDays(c.effective_date,-1);
  }
  else {
   if(d.enrollments.some(e=>e.club_id===c.club_id&&e.student_id===c.student_id&&['pending','enrolled'].includes(e.status)
    &&(!e.end_date||e.end_date>=c.effective_date)))fail('已有參加或報名紀錄。');
   checkDemoAdmission(d,c.club_id,c.student_id,c.effective_date);
   d.enrollments.push({id:crypto.randomUUID(),club_id:c.club_id,student_id:c.student_id,status:'enrolled',start_date:c.effective_date,end_date:null});
  }
 }else {
  const s=d.sessions.find(s=>s.id===c.session_id&&s.club_id===c.club_id);if(!s)fail('請選課程。');const targets=c.kind==='weekly'?d.sessions.filter(x=>x.club_id===c.club_id&&x.status==='scheduled'&&x.starts_at>=s.starts_at):[s];
  targets.forEach(x=>{unlocked(x.club_id,dateKey(new Date(x.starts_at)));if(x.status!=='scheduled'||x.signed_at)fail('已授課或已簽到課程不可直接異動。');let starts=c.starts_at,ends=c.ends_at;if(c.kind==='weekly'){const delta=new Date(c.starts_at)-new Date(s.starts_at);starts=new Date(new Date(x.starts_at).getTime()+delta).toISOString();ends=new Date(new Date(starts).getTime()+new Date(c.ends_at)-new Date(c.starts_at)).toISOString();}unlocked(x.club_id,dateKey(new Date(starts)));if(!(new Date(ends)>new Date(starts)))fail('結束時間需晚於開始時間。');const next={...x,starts_at:starts,ends_at:ends,teacher_id:c.teacher_id||x.teacher_id};if(d.sessions.some(other=>other.id!==x.id&&other.status!=='cancelled'&&other.teacher_id===next.teacher_id&&intersects(other,next)))fail('調整後教師時間衝突。');c.original_dates??=[];c.original_dates.push(x.starts_at);Object.assign(x,next,{units:Number(c.units)||x.units,rate:c.rate!==''&&c.rate!=null?Number(c.rate):x.rate});});
 }
}

function checkDemoAdmission(data,clubId,studentId,effective) {
 const club=data.clubs.find(c=>c.id===clubId);
 const roster=data.enrollments.filter(e=>e.club_id===clubId&&e.status==='enrolled');
 const dates=[effective,...roster.map(e=>e.start_date).filter(date=>date>effective)];
 if(dates.some(date=>roster.filter(e=>enrolledOn(e,date)).length>=club.capacity))throw Error('社團名額已滿。');
 const sessions=data.sessions.filter(s=>s.status!=='cancelled');
 const otherEnrollments=data.enrollments.filter(e=>e.club_id!==clubId&&e.student_id===studentId);
 const otherSessions=sessions.filter(s=>otherEnrollments.some(e=>e.club_id===s.club_id&&enrolledOn(e,dateKey(new Date(s.starts_at)))));
 if(sessions.some(s=>s.club_id===clubId&&dateKey(new Date(s.starts_at))>=effective&&otherSessions.some(o=>intersects(s,o)))) {
  throw Error('學生已有同時段課程。');
 }
}
