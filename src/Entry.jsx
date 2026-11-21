import {version as appVersion} from '../package.json';
import React,{useEffect,useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {configured,googleEnabled,supabase,studentClasses} from './api.js';
import {ROLE_NAMES} from './domain.js';
import PublicCalendar from './PublicCalendar.jsx';
import {cardPattern} from '../supabase/functions/club-account-admin/student-access.js';

const seats=Array.from({length:20},(_,i)=>String(i+1));
const version=import.meta.env.BASE_URL;
export const rememberStudentCode=(code)=>{
 try{if(code)localStorage.setItem('aimen-student-device',code);else localStorage.removeItem('aimen-student-device');}catch{}
};
function savedCode(){
 try{const code=localStorage.getItem('aimen-student-device')||'';return cardPattern.test(code)?code:'';}catch{return '';}
}

export default function Entry({card,busy,onTeacher,onStudent,onDemo,showSetup,children}){
 const [remembered,setRemembered]=useState(savedCode);
 const known=card||remembered;
 const [identity,setIdentity]=useState(known?'student':'teacher');
 const [classes,setClasses]=useState(null);
 useEffect(()=>{
  if(identity!=='student'||!configured)return;
  const controller=new AbortController();
  studentClasses(controller.signal).then(
   value=>{if(!controller.signal.aborted)setClasses({value});},
   ()=>{if(!controller.signal.aborted)setClasses({error:true});},
  );
  return ()=>controller.abort();
 },[identity]);
 function submit(handler,event){
  event.preventDefault();
  handler(Object.fromEntries(new FormData(event.currentTarget)));
 }
 return <div className="login-shell">
  <section className="login-story">
   <div className="login-story-head"><div className="brand"><img className="brand-icon" src={version+'logo.svg'} alt=""/><div>隘門國小<small>課後活動管理系統</small></div></div>
    <a className="btn small login-jump" href="#account-login">前往登入</a>
   </div>
   <PublicCalendar/><small>隘門國小課後活動 · {appVersion}</small>
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
     <label>首次啟用碼 <small>首次登入或重設後填寫</small><input name="teacher_code" autoComplete="off" autoCapitalize="none"/></label>
     <button className="btn primary full" disabled={!configured||busy}>{busy?'登入中…':'老師登入'}<ArrowUpRight size={18}/></button>
    </form>
    {configured&&<div className="form-actions">
     <button className="btn small" onClick={()=>showSetup('verify')}>驗證邀請連結</button>
     <button className="btn small" onClick={()=>showSetup('reset')}>Email 忘記密碼</button>
    </div>}
    {googleEnabled&&configured&&<button className="btn full" onClick={()=>supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}})}>使用 Google 帳號登入</button>}
   </>:<>
    {classes?.error&&<p role="status">暫時無法載入班級，請重新整理頁面。</p>}
    {classes?.value?.length===0&&<p role="status">目前學期尚未有可登入的學生名冊。</p>}
    <form onSubmit={e=>submit(values=>onStudent({...values,card:(known||values.code||'').trim().toLowerCase()}),e)}>
     <label>班級<select name="class_name" required disabled={!classes?.value?.length}>
      <option value="">請選擇班級</option>{classes?.value?.map(v=><option key={v}>{v}</option>)}
     </select></label>
     <label>座號<select name="number" required>
      <option value="">請選擇座號</option>{seats.map(v=><option key={v} value={v}>{v} 號</option>)}
     </select></label>
     <label>OpenID 帳號<input name="openid" inputMode="numeric" pattern="[0-9]+" maxLength={40} placeholder="請輸入open id數字" required autoComplete="off"/></label>
     <label>姓名最後一個字<input name="last_character" maxLength={2} required autoComplete="off" placeholder="請輸入姓名最後一個字"/></label>
     {!known&&<label>學生登入碼<input name="code" autoComplete="off" autoCapitalize="none" required maxLength={48} placeholder="請輸入學校發給你的登入碼"/></label>}
     {!known&&<p className="note">第一次可直接輸入學校發的登入碼。勾選下方選項後，下次可直接從首頁登入。</p>}
     {!remembered&&<label><span><input name="remember" type="checkbox" style={{width:'auto'}}/> 在我的裝置記住登入碼（共用電腦請勿勾選）</span></label>}
     {remembered&&!card&&<button type="button" className="btn small" onClick={()=>{rememberStudentCode('');setRemembered('');}}>忘記這部裝置的登入碼</button>}
     <button className="btn primary full" disabled={!classes?.value?.length||busy}>{busy?'登入中…':'學生登入'}<ArrowUpRight size={18}/></button>
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
