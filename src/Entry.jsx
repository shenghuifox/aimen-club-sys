import React,{useEffect,useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {configured,googleEnabled,supabase,studentClasses} from './api.js';
import {ROLE_NAMES} from './domain.js';
import PublicCalendar from './PublicCalendar.jsx';

const seats=Array.from({length:99},(_,i)=>String(i+1));
const version=import.meta.env.BASE_URL;

export default function Entry({card,busy,onTeacher,onStudent,onDemo,showSetup,children}){
 const [identity,setIdentity]=useState(card?'student':'teacher');
 const [classes,setClasses]=useState(null);
 useEffect(()=>{
  if(identity!=='student'||!card||!configured)return;
  const controller=new AbortController();
  studentClasses(controller.signal).then(
   value=>{if(!controller.signal.aborted)setClasses({value});},
   ()=>{if(!controller.signal.aborted)setClasses({error:true});},
  );
  return ()=>controller.abort();
 },[identity,card]);
 function submit(handler,event){
  event.preventDefault();
  handler(Object.fromEntries(new FormData(event.currentTarget)));
 }
 return <div className="login-shell">
  <section className="login-story">
   <div className="login-story-head"><div className="brand"><img className="brand-icon" src={version+'logo.svg'} alt=""/><div>隘門國小<small>課後活動管理系統</small></div></div>
    <a className="btn small login-jump" href="#account-login">前往登入</a>
   </div>
   <PublicCalendar/><small>隘門國小課後活動 · 0.9.0</small>
  </section>
  <section className="login-panel" id="account-login">
   <h2>登入隘門國小課後活動</h2>
   <div className="entry-roles" role="group" aria-label="登入身分">
    <button type="button" className={'btn '+(identity==='teacher'?'primary':'')} aria-pressed={identity==='teacher'} onClick={()=>setIdentity('teacher')}>我是老師</button>
    <button type="button" className={'btn '+(identity==='student'?'primary':'')} aria-pressed={identity==='student'} onClick={()=>setIdentity('student')}>我是學生</button>
   </div>
   {identity==='teacher'?<>
    <form onSubmit={e=>submit(onTeacher,e)}>
     <label>帳號<input name="username" required autoComplete="username" autoCapitalize="none" placeholder="請輸入學校帳號"/></label>
     <label>密碼<input name="password" type="password" required autoComplete="current-password" placeholder="請輸入密碼"/></label>
     <button className="btn primary full" disabled={!configured||busy}>{busy?'登入中…':'老師登入'}<ArrowUpRight size={18}/></button>
    </form>
    {configured&&<div className="form-actions">
     <button className="btn small" onClick={()=>showSetup('verify')}>驗證邀請連結</button>
     <button className="btn small" onClick={()=>showSetup('reset')}>舊帳號郵件重設</button>
    </div>}
    {googleEnabled&&configured&&<button className="btn full" onClick={()=>supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}})}>使用 Google 帳號登入</button>}
   </>:<>
    {!card&&<p className="note">請開啟學校個別發給你的學生登入連結。需要補發時，請聯繫教導處。</p>}
    {classes?.error&&<p role="status">暫時無法載入班級，請重新開啟學生登入連結。</p>}
    <form onSubmit={e=>submit(values=>onStudent({...values,card}),e)}>
     <label>班級<select name="class_name" required disabled={!card||!classes?.value?.length}>
      <option value="">請選擇班級</option>{classes?.value?.map(v=><option key={v}>{v}</option>)}
     </select></label>
     <label>座號<select name="number" required>
      <option value="">請選擇座號</option>{seats.map(v=><option key={v} value={v}>{v} 號</option>)}
     </select></label>
     <label>OpenID 數字<input name="openid" inputMode="numeric" pattern="[0-9]+" maxLength={40} placeholder="請輸入open id數字" required autoComplete="off"/></label>
     <label>姓名最後一個字<input name="last_character" maxLength={2} required autoComplete="off" placeholder="請輸入姓名最後一個字"/></label>
     <button className="btn primary full" disabled={!card||!classes?.value?.length||busy}>{busy?'登入中…':'學生登入'}<ArrowUpRight size={18}/></button>
    </form>
   </>}
   {children}
   <details className="install-help">
    <summary>角色體驗（假資料）</summary>
    <div className="demo-buttons">{Object.entries(ROLE_NAMES).filter(([id])=>id!=='guardian').map(([id,label])=><button key={id} onClick={()=>onDemo(id)}><span>{label}</span><small>{id}</small><ArrowUpRight size={15}/></button>)}</div>
   </details>
  </section>
 </div>;
}
