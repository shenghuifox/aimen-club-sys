import React,{useState} from 'react';
import {X} from 'lucide-react';
import {dateKey,timeText} from './domain.js';

export default function ScheduleLesson({clubs,teachers,source,busy,close,save}){
 const first=clubs.find(club=>club.id===source?.club_id)||clubs[0];
 const [clubId,setClubId]=useState(first?.id||'');
 const [teacherId,setTeacherId]=useState(source?.teacher_id||first?.teacher_id||'');
 const club=clubs.find(item=>item.id===clubId);
 const title=source?'安排補課':'安排加課';
 function submit(event){
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const date=form.get('date'),start=form.get('start'),end=form.get('end');
  if(end<=start){
   const input=event.currentTarget.elements.end;
   input.setCustomValidity('結束時間須晚於開始時間。');
   input.reportValidity();
   return;
  }
  save({
   club_id:clubId,session_id:source?.id,
   starts_at:date+'T'+start+':00+08:00',ends_at:date+'T'+end+':00+08:00',
   units:Number(form.get('units')),reason:form.get('reason').trim(),
   teacher_id:teacherId,
  });
 }
 return <div className="overlay" onClick={close}><section className="modal schedule-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-title" onClick={event=>event.stopPropagation()}>
  <header><h2 id="schedule-title">{title}</h2><button className="icon-btn" aria-label="關閉" onClick={close}><X/></button></header>
  {source&&<p className="note">原停課節次 {dateKey(new Date(source.starts_at))} {timeText(source.starts_at)}–{timeText(source.ends_at)}</p>}
  <form onSubmit={submit}>
   <label>社團
    <select required value={clubId} disabled={Boolean(source)} onChange={event=>{
     const id=event.target.value;
     setClubId(id);setTeacherId(clubs.find(item=>item.id===id)?.teacher_id||'');
    }}>{clubs.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select>
   </label>
   <fieldset className="schedule-time"><legend>時間</legend>
    <label>上課日期<input required type="date" name="date" defaultValue={source?'':dateKey()}/></label>
    <label>開始時間<input required type="time" name="start" defaultValue={source?timeText(source.starts_at):'15:30'} onChange={e=>e.target.form.elements.end.setCustomValidity('')}/></label>
    <label>結束時間<input required type="time" name="end" defaultValue={source?timeText(source.ends_at):'16:50'} onChange={e=>e.target.setCustomValidity('')}/></label>
   </fieldset>
   <label>節數<input required type="number" name="units" min="0.5" max="99.5" step="0.5" defaultValue={source?.units||2}/></label>
   <label>授課老師<select required value={teacherId} onChange={event=>setTeacherId(event.target.value)}>
    <option value="">請選擇授課老師</option>
    {teachers.map(teacher=><option value={teacher.id} key={teacher.id}>{teacher.name}</option>)}
   </select></label>
   <label>異動原因<textarea required name="reason" maxLength={300}/></label>
   <p className="note">{source?'沿用原節次':'採用社團設定'}的每節鐘點費。</p>
   <footer><button type="button" className="btn" onClick={close}>取消</button><button className="btn primary" disabled={busy||!club}>{busy?'處理中…':'確認排課'}</button></footer>
  </form>
 </section></div>;
}
