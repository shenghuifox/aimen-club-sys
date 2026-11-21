import React,{useEffect,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import {configured,getPublicCalendar} from './api.js';
import {addDays,dateKey,timeText,weekDays} from './domain.js';
import './public-calendar.css';

const dayName='一二三四五六日';
const shortDate=date=>date.slice(5).replace('-','/');

export default function PublicCalendar(){
 const today=dateKey();
 const [week,setWeek]=useState(()=>weekDays(today)[0]);
 const [selected,setSelected]=useState(null);
 const [retry,setRetry]=useState(0);
 const [result,setResult]=useState(null);
 const days=weekDays(week);
 useEffect(()=>{
  if(!configured)return;
  const controller=new AbortController();
  getPublicCalendar(week,controller.signal).then(
   rows=>{if(!controller.signal.aborted)setResult({week,retry,rows});},
   ()=>{if(!controller.signal.aborted)setResult({week,retry,error:true});},
  );
  return ()=>controller.abort();
 },[week,retry]);

 function changeWeek(next){
  setWeek(next);
  setSelected(null);
 }
 const current=result?.week===week&&result.retry===retry?result:null;
 const byDay=new Map(days.map(day=>[day,[]]));
 for(const row of current?.rows||[])byDay.get(dateKey(new Date(row.starts_at)))?.push(row);
 const groups=(selected?[selected]:days).filter(day=>byDay.get(day).length);

 return <section className="public-calendar" aria-labelledby="public-calendar-title">
  <header>
   <h1 id="public-calendar-title"><CalendarDays size={22} aria-hidden="true"/>社團行事曆</h1>
   <p>免登入查看學校已發布的課程與停課資訊。</p>
  </header>
  <div className="public-week-tools">
   <button className="icon-btn" type="button" aria-label="上一週" onClick={()=>changeWeek(addDays(week,-7))}><ChevronLeft size={20}/></button>
   <strong aria-live="polite">{shortDate(week)} – {shortDate(days[6])}</strong>
   <button className="icon-btn" type="button" aria-label="下一週" onClick={()=>changeWeek(addDays(week,7))}><ChevronRight size={20}/></button>
   <button className="btn small" type="button" onClick={()=>changeWeek(weekDays(today)[0])}>回本週</button>
  </div>
  <div className="public-calendar-days" role="group" aria-label="依日期篩選課程">
   {days.map((day,index)=><button key={day} type="button" aria-pressed={selected===day}
    aria-current={day===today?'date':undefined} aria-label={shortDate(day)+' 星期'+dayName[index]}
    onClick={()=>setSelected(selected===day?null:day)}>
    <span>週{dayName[index]}</span><strong>{shortDate(day)}</strong>
    <span className="public-day-count">{current?.rows?byDay.get(day).length+' 堂':'　'}</span>
   </button>)}
  </div>
  <div className="public-agenda-head">
   <h2>{selected?shortDate(selected)+' 課程':'全週課程'}</h2>
   {selected&&<button className="btn small" type="button" onClick={()=>setSelected(null)}>顯示全週</button>}
  </div>
  <div aria-live="polite" aria-busy={configured&&!current}>
   {!configured||current?.error?<div className="public-calendar-message">
    <p>暫時無法載入公開行事曆。</p>
    {configured&&<button type="button" className="btn small" onClick={()=>setRetry(retry+1)}>重新載入</button>}
   </div>:!current?<p className="public-calendar-message">正在載入課程…</p>
    :!groups.length?<p className="public-calendar-message">{selected?'這一天':'這一週'}沒有已發布的課程。</p>
    :groups.map(day=><div key={day} className="public-agenda-group">
     <h3><time dateTime={day}>{shortDate(day)}</time> 週{dayName[days.indexOf(day)]}</h3>
     <ul>{byDay.get(day).map((row,index)=><li key={index}>
      <div className="public-agenda-time"><time dateTime={row.starts_at}>{timeText(row.starts_at)}</time>–<time dateTime={row.ends_at}>{timeText(row.ends_at)}</time></div>
      <div className="public-agenda-course"><strong>{row.club_name}</strong><span>{row.location||'地點待確認'}</span></div>
      {row.cancelled&&<span className="badge cancelled">停課</span>}
     </li>)}</ul>
    </div>)}
  </div>
 </section>;
}
