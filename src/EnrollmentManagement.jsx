import React,{useState} from 'react';
import {dateKey,enrolledOn,STATUS_NAMES,FEE_NAMES} from './domain.js';

const OPERATIONS={
 enrolled:'批次錄取',
 waitlisted:'列為候補',
 rejected:'批次不錄取',
 add_student:'批次加入',
 remove_student:'批次退選'
};

export default function EnrollmentManagement({term,clubs,students,enrollments,busy,action}) {
 const [clubId,setClubId]=useState(clubs[0]?.id||'');
 const [operation,setOperation]=useState('enrolled');
 const [effective,setEffective]=useState(()=>{
  const today=dateKey();
  if (today<term.start_date) return term.start_date;
  return today>term.end_date?term.end_date:today;
 });
 const [reason,setReason]=useState('');
 const [selected,setSelected]=useState([]);
 const [confirming,setConfirming]=useState(false);
 const reviewing=['enrolled','rejected','waitlisted'].includes(operation);
 const needsDate=!['rejected','waitlisted'].includes(operation);
 const clubEnrollments=enrollments.filter(e=>e.club_id===clubId);
 const options=reviewing
  ? clubEnrollments.filter(e=>['pending','waitlisted'].includes(e.status)&&e.status!==operation).map(e=>({id:e.id,student:students.find(s=>s.id===e.student_id)}))
  : students.filter(s=>operation==='remove_student'
    ? clubEnrollments.some(e=>e.student_id===s.id&&enrolledOn(e,effective))
    : !clubEnrollments.some(e=>e.student_id===s.id&&['pending','enrolled','waitlisted'].includes(e.status)&&(!e.end_date||e.end_date>=effective)))
   .map(student=>({id:student.id,student}));
 const count=selected.length;
 const canSubmit=clubId && count>0 && count<=200 && term.status==='active' &&
  (!needsDate || (effective>=term.start_date && effective<=term.end_date)) &&
  (reviewing || reason.trim());
 const clearSelection=()=>{setConfirming(false);setSelected([]);};
 const toggle=id=>{
  setConfirming(false);
  setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);
 };
 return <section className="panel">
  <div className="panel-head"><div><h2>報名錄取與上課名單</h2><p>依社團勾選學生。錄取與名冊調整會一起檢查名額、衝堂和歷史授課紀錄。</p></div></div>
  <div className="admin-filters">
   <label>社團<select aria-label="社團" value={clubId} disabled={busy} onChange={e=>{setClubId(e.target.value);clearSelection();}}>
    <option value="">選擇社團</option>{clubs.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
   </select></label>
   <label>處理方式<select aria-label="處理方式" value={operation} disabled={busy} onChange={e=>{setOperation(e.target.value);clearSelection();}}>
    {Object.entries(OPERATIONS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
   </select></label>
   {needsDate&&<label>生效日期
    <input type="date" min={term.start_date} max={term.end_date} disabled={busy} value={effective} onChange={e=>{setEffective(e.target.value);clearSelection();}}/>
   </label>}
  </div>
  {!reviewing&&<label>異動原因<input value={reason} maxLength={300} disabled={busy} onChange={e=>{setReason(e.target.value);setConfirming(false);}}/></label>}
  {clubId&&options.length>0&&<div className="table-wrap"><table>
   <thead><tr><th><input type="checkbox" aria-label="全選學生" disabled={busy||options.length>200}
    checked={count===options.length} onChange={e=>{setSelected(e.target.checked?options.map(row=>row.id):[]);setConfirming(false);}}/></th><th>班級與座號</th><th>學生</th></tr></thead>
   <tbody>{options.map(({id,student})=><tr key={id}><td><input type="checkbox" disabled={busy||(count===200&&!selected.includes(id))} aria-label={'選取 '+student?.name}
    checked={selected.includes(id)} onChange={()=>toggle(id)}/></td><td>{student?.class_name} · {student?.number}</td><td>{student?.name}</td></tr>)}</tbody>
  </table></div>}
  {clubId&&!options.length&&<p className="note">目前沒有符合此處理方式的學生。</p>}
  {options.length>200&&<p className="note">每批最多處理 200 位學生。</p>}
  {term.status!=='active'&&<p className="notice">此學期已封存。</p>}
  <div className="form-actions">
   {confirming&&<span role="status">將{OPERATIONS[operation]} {count} 人{needsDate?'，生效日 '+effective:''}。</span>}
   <button className="btn primary" disabled={busy||!canSubmit} onClick={async()=>{
    if (!confirming) { setConfirming(true); return; }
    const result=await action('batch_roster',{club_id:clubId,operation,effective_date:needsDate?effective:null,ids:selected,reason});
    if (result) clearSelection();
   }}>{confirming?'確認送出':OPERATIONS[operation]+'（'+count+' 人）'}</button>
  </div>
  {clubEnrollments.length>0&&<details>
   <summary>查看目前報名與錄取紀錄</summary>
   <div className="table-wrap"><table><thead><tr><th>學生</th><th>狀態</th><th>起日</th><th>最後參加日</th><th>繳費狀態</th></tr></thead>
    <tbody>{clubEnrollments.map(e=><tr key={e.id}><td>{students.find(s=>s.id===e.student_id)?.name}</td>
     <td>{STATUS_NAMES[e.status]}</td><td>{e.start_date}</td><td>{e.end_date||'—'}</td><td>{e.status==='enrolled'?<select aria-label={(students.find(s=>s.id===e.student_id)?.name||'學生')+'繳費狀態'} disabled={busy||term.status!=='active'} value={e.fee_status||''} onChange={event=>action('fee_status',{id:e.id,status:event.target.value})}><option value="">免繳／未設定</option>{Object.entries(FEE_NAMES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>:'—'}</td></tr>)}</tbody>
   </table></div>
  </details>}
 </section>;
}
