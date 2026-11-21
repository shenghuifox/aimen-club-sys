export const ROLE_NAMES={admin:'行政管理',stu:'學生',clubtr:'社團老師',hrtr:'班級導師',guardian:'家長'};
export const STATUS_NAMES={pending:'未確認',waitlisted:'候補',approved:'已確認',rejected:'未通過',enrolled:'已錄取',withdrawn:'已退出',scheduled:'待上課',completed:'已完成',cancelled:'已停課',locked:'已鎖定',draft:'草稿',published:'已開放',archived:'已封存',present:'出席',absent:'缺席',late:'遲到',leave:'請假'};
export const FEE_NAMES={pending:'待繳',paid:'已繳',overdue:'逾期待處理'};
export const SCHEDULE_NAMES={cancel:'停課',makeup:'補課',swap:'雙向調課',extra:'加課'};
export const has=(user,role)=>user?.roles?.includes(role);
export const dateKey=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
export function addDays(date,n){const d=new Date(date+'T12:00:00+08:00');d.setUTCDate(d.getUTCDate()+n);return dateKey(d);}
export function weekDays(date){const d=new Date(date+'T12:00:00+08:00');const day=(d.getUTCDay()+6)%7;return Array.from({length:7},(_,i)=>addDays(date,i-day));}
export const timeText=iso=>iso?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)):'';
export const stamp=iso=>iso?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)):'—';
export const money=n=>new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(n||0);
export const intersects=(a,b)=>new Date(a.starts_at)<new Date(b.ends_at)&&new Date(a.ends_at)>new Date(b.starts_at);
export function enrolledOn(enrollment,date){return enrollment.status==='enrolled'&&enrollment.start_date<=date&&(!enrollment.end_date||enrollment.end_date>=date);}
export function rosterClubMemberships(enrollments,clubs,date){
 const byClub=new Map(clubs.map(club=>[club.id,club]));
 const byStudent=new Map();
 for(const enrollment of enrollments){
  const club=byClub.get(enrollment.club_id);
  if(!club||!enrolledOn(enrollment,date))continue;
  let memberships=byStudent.get(enrollment.student_id);
  if(!memberships){memberships=new Map();byStudent.set(enrollment.student_id,memberships);}
  memberships.set(club.id,club);
 }
 return new Map([...byStudent].map(([id,memberships])=>[id,[...memberships.values()]]));
}
export function inRange(session,start,end){const d=dateKey(new Date(session.starts_at));return d>=start&&d<=end;}
export function settlementPreview(data,clubId,start,end){
 if(!start||!end||start>end)throw Error('請確認核算起訖日期。');
 if(data.settlements.some(b=>b.club_id===clubId&&b.start_date<=end&&b.end_date>=start))throw Error('選取期間與已鎖定核銷重疊。');
 const sessions=data.sessions.filter(s=>s.club_id===clubId&&inRange(s,start,end)&&s.status!=='cancelled');
 if(!sessions.length)throw Error('這個期間沒有可核算的課程。');
 const incomplete=sessions.filter(s=>s.status!=='completed'||!s.signed_at||!s.attendance_confirmed_at||!s.summary?.trim());
 if(incomplete.length)throw Error(`尚有 ${incomplete.length} 次課程未完成簽到、摘要或點名確認。`);
 const teachers={}; let total=0;
 const rows=sessions.map(s=>{const amount=Math.round(Number(s.units)*Number(s.rate));total+=amount;const key=s.teacher_id+':'+s.rate;teachers[key]??={teacher_id:s.teacher_id,name:data.users.find(u=>u.id===s.teacher_id)?.name||'未指定',rate:s.rate,units:0,amount:0};teachers[key].units+=Number(s.units);teachers[key].amount+=amount;return {...s,teacher_name:teachers[key].name,amount,attendance_count:data.attendance.filter(a=>a.session_id===s.id&&['present','late'].includes(a.status)).length};});
 return {club:data.clubs.find(c=>c.id===clubId),start_date:start,end_date:end,rows,teachers:Object.values(teachers),total,units:rows.reduce((n,s)=>n+Number(s.units),0),school:'隘門國民小學',template_version:1};
}
export function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function csvString(rows) {
 return '\uFEFF'+rows.map(row=>row.map(value=>{
  let cell=String(value??'');
  if (/^[\t\r\n]|^[\s\u0000-\u001f]*[=+@\-=＋－＠＝]/u.test(cell)) cell="'"+cell;
  return '"'+cell.replaceAll('"','""')+'"';
 }).join(',')).join('\r\n');
}
