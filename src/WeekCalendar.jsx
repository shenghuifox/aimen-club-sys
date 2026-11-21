import React from 'react';
import {ChevronLeft,ChevronRight,Printer} from 'lucide-react';
import {dateKey,addDays,weekDays,timeText} from './domain.js';
import {FIRST_HOUR,LAST_HOUR,dayEvents} from './calendar.js';

export function lessonInfo(lesson){
 return [lesson.club_name,timeText(lesson.starts_at)+'–'+timeText(lesson.ends_at),
  lesson.teacher||'未指派',lesson.location||'地點待確認'];
}

export default function WeekCalendar({sessions,week,setWeek,onEvent,onPrint}){
 const today=dateKey(),days=weekDays(week);
  const available=sessions.filter(s=>s.status!=='cancelled');
  const calendar=days.map(day=>({day,...dayEvents(available,day)}));
  const hours=Array.from({length:LAST_HOUR-FIRST_HOUR+1},(_,i)=>String(i+FIRST_HOUR).padStart(2,'0')+':00');
  const outside=[...new Set(calendar.flatMap(({outside})=>outside))];
  return <section className="panel calendar-panel">
   <div className="panel-head">
    <h2>本週社團</h2>
    <div className="week-tools">
     <button className="icon-btn" aria-label="上一週" onClick={()=>setWeek(addDays(week,-7))}><ChevronLeft size={18}/></button>
     <span>{days[0].slice(5)} 至 {days[6].slice(5)}</span>
     <button className="icon-btn" aria-label="下一週" onClick={()=>setWeek(addDays(week,7))}><ChevronRight size={18}/></button>
     <button className="btn small" onClick={()=>setWeek(today)}>本週</button>
     <button className="btn small print-control" onClick={onPrint}><Printer size={16}/>列印週課表</button>
    </div>
   </div>
   <div className="week-scroll" role="region" aria-label="週行事曆，週一至週日 07:00 至 18:00" tabIndex={0}>
    <div className="week-calendar">
     <header className="week-header"><span>時間</span>{calendar.map(({day},i)=>
      <div className={day===today?'current-day':''} key={day}><span>週{'一二三四五六日'[i]}</span><strong>{day.slice(5).replace('-','/')}</strong></div>)}
     </header>
     <div className="week-body">
      <div className="week-hours">{hours.map((hour,i)=><span key={hour} style={{top:100*i/(hours.length-1)+'%'}}>{hour}</span>)}</div>
      {calendar.map(({day,visible})=><div key={day} className={'week-day '+(day===today?'current-day':'')}>
       {visible.map(({session:s,top,height,left,width})=>{
        const [name,time,teacher,location]=lessonInfo(s);
        const description=[name,time,'授課老師 '+teacher,'上課地點 '+location].join('，');
        return <button key={s.id} className="week-event" title={description} aria-label={description} onClick={()=>onEvent(s)}
         style={{top:top+'%',height:height+'%',left:left+'%',width:width+'%',borderInlineStartColor:s.color}}>
          <strong>{name}</strong><span>{time}</span><span>{teacher}</span><span>{location}</span>
         </button>;
       })}
      </div>)}
     </div>
    </div>
   </div>
   {outside.length>0&&<div className="week-outside"><h3>含 07:00–18:00 以外時段的課程</h3>
    {outside.map(s=><button className="btn small" key={s.id} onClick={()=>onEvent(s)}>{dateKey(new Date(s.starts_at))}　{lessonInfo(s).join(' · ')}</button>)}
   </div>}
  </section>;
}
