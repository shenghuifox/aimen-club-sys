import React,{useEffect,useRef} from 'react';
import {dateKey} from './domain.js';
import {lessonInfo} from './WeekCalendar.jsx';

export default function LessonDetails({lesson,canEdit,close,edit}){
 const dialog=useRef(null);
 useEffect(()=>{dialog.current.showModal();},[]);
 const [name,time,teacher,location]=lessonInfo(lesson);
 return <dialog ref={dialog} className="modal lesson-details" aria-labelledby="lesson-title" onCancel={event=>{event.preventDefault();close();}}>
  <h2 id="lesson-title">{name}</h2>
  <dl>
   <dt>日期與時間</dt><dd>{dateKey(new Date(lesson.starts_at))}　{time}</dd>
   <dt>授課老師</dt><dd>{teacher}</dd>
   <dt>上課地點</dt><dd>{location}</dd>
  </dl>
  {!canEdit&&<p className="note">僅行政與該社團老師可編修。</p>}
  <footer><button type="button" className="btn" onClick={close}>關閉</button>
   <button type="button" className="btn primary" disabled={!canEdit} onClick={edit}>編修</button>
  </footer>
 </dialog>;
}
