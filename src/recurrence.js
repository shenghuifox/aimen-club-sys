import {addDays,dateKey,intersects} from './domain.js';
export function recurringCandidates(p){
 const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&!Number.isNaN(Date.parse(d+'T12:00:00+08:00'))&&dateKey(new Date(d+'T12:00:00+08:00'))===d;
 if(!valid(p.start_date)||!valid(p.end_date)||p.end_date<p.start_date)throw Error('請確認起訖日期。');
 if((Date.parse(p.end_date)-Date.parse(p.start_date))/86400000>366)throw Error('單次批次範圍最多一年。');
 if(!Array.isArray(p.weekdays)||!p.weekdays.length||p.weekdays.some(n=>!Number.isInteger(Number(n))||Number(n)<1||Number(n)>7))throw Error('請至少選擇一個有效上課星期。');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start_time||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end_time||'')||p.end_time<=p.start_time)throw Error('結束時間需晚於開始時間，且在同一天。');
 if(!(Number(p.units)>0)||!Number.isFinite(Number(p.units))||!(Number(p.rate)>=0)||!Number.isFinite(Number(p.rate)))throw Error('請確認授課節數及鐘點費。');
 const skip=Array.isArray(p.exclude_dates)?p.exclude_dates:String(p.exclude_dates||'').split(/[\s,，;；]+/).filter(Boolean);
 if(skip.some(d=>!valid(d)))throw Error('排除日期請使用 YYYY-MM-DD 格式，以逗號或換行分隔。');
 const rows=[];for(let d=p.start_date;d<=p.end_date;d=addDays(d,1)){
  const weekday=(new Date(d+'T12:00:00+08:00').getUTCDay()+6)%7+1;
  if(p.weekdays.map(Number).includes(weekday)&&!skip.includes(d))rows.push({club_id:p.club_id,teacher_id:p.teacher_id,starts_at:new Date(`${d}T${p.start_time}:00+08:00`).toISOString(),ends_at:new Date(`${d}T${p.end_time}:00+08:00`).toISOString(),units:Number(p.units),rate:Number(p.rate),date:d});
 }
 if(!rows.length)throw Error('此範圍沒有符合條件的課程日期。');if(rows.length>200)throw Error('每批最多新增 200 次課程，請縮小範圍。');return rows;
}
export function recurringPreview(data,p){
 const club=data.clubs.find(c=>c.id===p.club_id),term=data.terms.find(t=>t.id===club?.term_id);if(!club||!term)throw Error('請選擇社團。');
 return recurringCandidates(p).map(row=>{
  let problem='';const duplicate=data.sessions.find(s=>s.club_id===row.club_id&&s.status!=='cancelled'&&new Date(s.starts_at).getTime()===new Date(row.starts_at).getTime()&&new Date(s.ends_at).getTime()===new Date(row.ends_at).getTime()&&s.teacher_id===row.teacher_id&&Number(s.units)===row.units&&Number(s.rate)===row.rate);
  if(term.status!=='active')problem='學期已封存';
  else if(row.date<term.start_date||row.date>term.end_date)problem='超出學期日期';
  else if(!duplicate&&data.settlements.some(b=>b.club_id===row.club_id&&row.date>=b.start_date&&row.date<=b.end_date))problem='核銷期間已鎖定';
  else if(!duplicate&&data.sessions.some(s=>s.status!=='cancelled'&&(s.teacher_id===row.teacher_id||s.club_id===row.club_id)&&intersects(s,row)))problem='教師或社團時間衝突';
  else if(!duplicate&&data.enrollments.some(e=>e.club_id===row.club_id&&e.status==='enrolled'&&e.start_date<=row.date&&(!e.end_date||e.end_date>=row.date)&&data.enrollments.some(other=>other.student_id===e.student_id&&other.club_id!==row.club_id&&other.status==='enrolled'&&other.start_date<=row.date&&(!other.end_date||other.end_date>=row.date)&&data.sessions.some(s=>s.club_id===other.club_id&&s.status!=='cancelled'&&intersects(s,row)))))problem='學生已錄取課程時間衝突';
  return {...row,result:problem?'conflict':duplicate?'skip':'new',problem};
 });
}
