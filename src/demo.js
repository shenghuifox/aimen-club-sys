import {addDays,dateKey,weekDays,settlementPreview,has,enrolledOn,intersects} from './domain.js';
import {recurringPreview} from './recurrence.js';
export function seed(){
 const monday=weekDays(dateKey())[0], term='term-115-1';
 const users=[{id:'admin',username:'admin',name:'行政測試',roles:['admin']},{id:'stu',username:'stu',name:'學生測試',roles:['stu']},{id:'clubtr',username:'clubtr',name:'社團老師測試',roles:['clubtr']},{id:'hrtr',username:'hrtr',name:'班級導師測試',roles:['hrtr']}];
 const clubs=[{id:'football',term_id:term,name:'足球小將',description:'從傳接球到團隊合作，在球場上找到自己的節奏。',plan_name:'課後多元學習計畫',teacher_id:'clubtr',location:'學校操場',capacity:20,rate:400,kind:'社團',status:'published',color:'#e7a968',registration_start:addDays(monday,-30),registration_end:addDays(monday,30)},
 {id:'art',term_id:term,name:'玩色美術',description:'觀察生活、自由創作，用色彩記錄島嶼日常。',plan_name:'課後多元學習計畫',teacher_id:'clubtr',location:'美術教室',capacity:16,rate:400,kind:'社團',status:'published',color:'#a6a0cf',registration_start:addDays(monday,-30),registration_end:addDays(monday,30)},
 {id:'study',term_id:term,name:'課後作業指導',description:'陪伴完成作業，建立自主學習與閱讀習慣。',plan_name:'課後照顧計畫',teacher_id:'hrtr',location:'三年甲班',capacity:25,rate:350,kind:'課後班',status:'published',color:'#7bb8ac',registration_start:addDays(monday,-30),registration_end:addDays(monday,30)}];
 const students=[{id:'s1',user_id:'stu',term_id:term,name:'測試學生一',class_name:'三年甲班',homeroom_id:'hrtr',number:'01'},{id:'s2',user_id:null,term_id:term,name:'測試學生二',class_name:'三年甲班',homeroom_id:'hrtr',number:'02'},{id:'s3',user_id:null,term_id:term,name:'測試學生三',class_name:'四年甲班',homeroom_id:null,number:'01'}];
 const specs=[['football',0,'15:30','16:50',2],['art',1,'15:30','16:50',2],['study',0,'13:30','15:00',2],['study',2,'13:30','15:00',2],['football',3,'15:30','16:50',2],['art',4,'13:30','14:50',2],['football',-7,'15:30','16:50',2]];
 const sessions=specs.map(([cid,day,start,end,units],i)=>({id:'session-'+i,club_id:cid,teacher_id:clubs.find(c=>c.id===cid).teacher_id,starts_at:`${addDays(monday,day)}T${start}:00+08:00`,ends_at:`${addDays(monday,day)}T${end}:00+08:00`,units,rate:clubs.find(c=>c.id===cid).rate,summary:day<0?'傳接球練習與小組合作':'',status:day<0?'completed':'scheduled',signed_at:day<0?`${addDays(monday,day)}T15:28:00+08:00`:null,attendance_confirmed_at:day<0?`${addDays(monday,day)}T16:50:00+08:00`:null}));
 return {users,terms:[{id:term,name:'115-1',status:'active',start_date:'2026-08-01',end_date:'2027-01-31'}],clubs,students,sessions,enrollments:[{id:'e1',club_id:'football',student_id:'s1',status:'enrolled',start_date:addDays(monday,-30),end_date:null},{id:'e2',club_id:'football',student_id:'s2',status:'enrolled',start_date:addDays(monday,-30),end_date:null},{id:'e3',club_id:'study',student_id:'s1',status:'enrolled',start_date:addDays(monday,-30),end_date:null}],attendance:[{session_id:'session-6',student_id:'s1',status:'present'},{session_id:'session-6',student_id:'s2',status:'present'}],leaves:[],changes:[],settlements:[],audit:[]};
}
export function demoAction(data,user,action,p){
 const d=structuredClone(data), id=()=>crypto.randomUUID(), now=new Date().toISOString(), isAdmin=has(user,'admin');
 const fail=m=>{throw Error(m);}, requireAdmin=()=>{if(!isAdmin)fail('僅行政管理者可操作。');};
 const club=d.clubs.find(c=>c.id===p.club_id), student=d.students.find(s=>s.id===p.student_id), session=d.sessions.find(s=>s.id===p.session_id);
 const manageStudent=s=>s&&(isAdmin||s.homeroom_id===user.id||s.user_id===user.id||d.enrollments.some(e=>e.student_id===s.id&&d.clubs.find(c=>c.id===e.club_id)?.teacher_id===user.id));
 const unlocked=(cid,date)=>{if(d.settlements.some(b=>b.club_id===cid&&date>=b.start_date&&date<=b.end_date))fail('該期間已鎖定，請走核銷更正流程。');};
 const termOpen=cid=>{if(d.terms.find(t=>t.id===d.clubs.find(c=>c.id===cid)?.term_id)?.status!=='active')fail('學期已封存。');};
 if(action==='batch_sessions'){
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
  if(d.leaves.some(l=>l.student_id===student.id&&l.session_id===session.id&&l.status!=='rejected'))fail('該課程已有請假申請。');
  d.leaves.push({id:id(),student_id:student.id,session_id:session.id,kind:p.kind,reason:p.reason,status:isAdmin||student.homeroom_id===user.id?'approved':'pending',created_by:user.id,created_at:now,reviewed_by:isAdmin||student.homeroom_id===user.id?user.id:null});
 }else if(action==='review_leave'){
  const l=d.leaves.find(x=>x.id===p.id), s=d.students.find(x=>x.id===l?.student_id);if(!l||(!isAdmin&&s?.homeroom_id!==user.id))fail('沒有覆核權限。');if(l.status!=='pending')fail('申請已處理。');if(!['approved','rejected'].includes(p.status))fail('狀態不正確。');l.status=p.status;l.reviewed_by=user.id;l.reviewed_at=now;
 }else if(action==='enroll'){
  if(!club||!student||(!isAdmin&&student.user_id!==user.id))fail('沒有報名權限。');termOpen(club.id);
  if(!isAdmin&&(club.status!=='published'||dateKey()<club.registration_start||dateKey()>club.registration_end))fail('目前不在報名期間。');
  if(d.enrollments.some(e=>e.club_id===club.id&&e.student_id===student.id&&e.status!=='withdrawn'))fail('已有報名紀錄。');
  d.enrollments.push({id:id(),club_id:club.id,student_id:student.id,status:'pending',start_date:dateKey(),end_date:null});
 }else if(action==='admit'){
  requireAdmin();const e=d.enrollments.find(x=>x.id===p.id);if(!e)fail('找不到報名。');const c=d.clubs.find(c=>c.id===e.club_id);termOpen(c.id);
  if(p.status==='enrolled'&&d.enrollments.filter(x=>x.id!==e.id&&x.club_id===c.id&&enrolledOn(x,p.start_date||dateKey())).length>=c.capacity)fail('社團名額已滿。');
  if(!['enrolled','rejected'].includes(p.status))fail('狀態不正確。');e.status=p.status;e.start_date=p.start_date||dateKey();
 }else if(action==='sign_in'){
  if(!session||(!isAdmin&&session.teacher_id!==user.id))fail('僅授課教師可簽到。');termOpen(session.club_id);unlocked(session.club_id,dateKey(new Date(session.starts_at)));if(session.status==='cancelled')fail('課程已停課。');if(dateKey(new Date(session.starts_at))!==dateKey())fail('僅能於上課當日線上簽到。');session.signed_at??=now;
 }else if(action==='attendance'){
  if(!session||(!isAdmin&&session.teacher_id!==user.id))fail('沒有點名權限。');termOpen(session.club_id);unlocked(session.club_id,dateKey(new Date(session.starts_at)));if(!p.summary?.trim())fail('請填寫課程摘要。');if(!session.signed_at)fail('請先完成教師簽到。');if(new Date(session.starts_at)>new Date())fail('課程尚未開始。');
  const roster=d.enrollments.filter(e=>e.club_id===session.club_id&&enrolledOn(e,dateKey(new Date(session.starts_at))));
  if(roster.some(e=>!['present','absent','late','leave'].includes(p.marks?.[e.student_id])))fail('請完成每位學生的點名。');
  d.attendance=d.attendance.filter(a=>a.session_id!==session.id);roster.forEach(e=>d.attendance.push({session_id:session.id,student_id:e.student_id,status:d.leaves.some(l=>l.session_id===session.id&&l.student_id===e.student_id&&l.status==='approved')?'leave':p.marks[e.student_id]}));
  session.summary=p.summary;session.attendance_confirmed_at=now;session.status='completed';
 }else if(action==='save_club'){
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
  const e=d.enrollments.find(e=>e.club_id===c.club_id&&e.student_id===c.student_id&&e.status==='enrolled');
  if(c.kind==='remove_student'){if(!e)fail('學生不在社團名單。');if(c.effective_date<=e.start_date)fail('退出日必須晚於加入日。');e.end_date=addDays(c.effective_date,-1);}
  else {if(e&&(!e.end_date||e.end_date>=c.effective_date))fail('學生已參加社團。');const club=d.clubs.find(x=>x.id===c.club_id);if(d.enrollments.filter(x=>x.club_id===c.club_id&&enrolledOn(x,c.effective_date)).length>=club.capacity)fail('社團名額已滿。');d.enrollments.push({id:crypto.randomUUID(),club_id:c.club_id,student_id:c.student_id,status:'enrolled',start_date:c.effective_date,end_date:null});}
 }else {
  const s=d.sessions.find(s=>s.id===c.session_id&&s.club_id===c.club_id);if(!s)fail('請選課程。');const targets=c.kind==='weekly'?d.sessions.filter(x=>x.club_id===c.club_id&&x.status==='scheduled'&&x.starts_at>=s.starts_at):[s];
  targets.forEach(x=>{unlocked(x.club_id,dateKey(new Date(x.starts_at)));if(x.status!=='scheduled'||x.signed_at)fail('已授課或已簽到課程不可直接異動。');let starts=c.starts_at,ends=c.ends_at;if(c.kind==='weekly'){const delta=new Date(c.starts_at)-new Date(s.starts_at);starts=new Date(new Date(x.starts_at).getTime()+delta).toISOString();ends=new Date(new Date(starts).getTime()+new Date(c.ends_at)-new Date(c.starts_at)).toISOString();}unlocked(x.club_id,dateKey(new Date(starts)));if(!(new Date(ends)>new Date(starts)))fail('結束時間需晚於開始時間。');const next={...x,starts_at:starts,ends_at:ends,teacher_id:c.teacher_id||x.teacher_id};if(d.sessions.some(other=>other.id!==x.id&&other.status!=='cancelled'&&other.teacher_id===next.teacher_id&&intersects(other,next)))fail('調整後教師時間衝突。');c.original_dates??=[];c.original_dates.push(x.starts_at);Object.assign(x,next,{units:Number(c.units)||x.units,rate:c.rate!==''&&c.rate!=null?Number(c.rate):x.rate});});
 }
}
