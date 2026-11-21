import React,{useState} from 'react';
import {X,Download} from 'lucide-react';
import {ACCOUNT_HEADERS,STAFF_HEADERS,STUDENT_HEADERS,parseAccountImport,parseStaffImport,parseStudentImport} from './account-import.js';
import {studentResolver} from '../supabase/functions/club-account-admin/student-access.js';
import {ROLE_NAMES} from './domain.js';
import {downloadCsv} from './reports.js';

const labels={created:'已完成',failed:'未完成',unknown:'待確認',skipped:'已略過'};
const roles={students:{title:'批次匯入學生名冊',headers:STUDENT_HEADERS,example:['三甲','01','王小明','00123456'],parse:parseStudentImport,
 note:'必填班級、座號、姓名。填寫 OpenID 數字即可同時發行個人登入連結。請將 OpenID 欄設為文字格式，以保留開頭的 0。'},
 school:{title:'批次匯入校用帳號',headers:STAFF_HEADERS,example:['teacher01','王老師','班級導師'],parse:parseStaffImport,
 note:'角色可填「班級導師」或「社團老師」。行政管理帳號請逐筆新增。'},
 legacy:{title:'既有電子郵件帳號匯入',headers:ACCOUNT_HEADERS,parse:input=>parseAccountImport(input).map(row=>{
  if(row.role==='stu')throw Error('學生請從「學生管理」匯入。');
  return row;
 }),note:'角色可填「班級導師」或「社團老師」。班級、座號請留空。'},
};
const position=row=>row.class_name+' '+row.number;
const identifier=(row,students)=>students?position(row):row.username||row.email;

function ImportResults({results,students,close}) {
 const issued=results.filter(row=>row.student_link||row.initial_password);
 const credential=students?'學生登入連結':'初始密碼';
 return <>
  <p role="status">已完成 {results.filter(x=>x.status==='created').length} 筆，共 {results.length} 筆。</p>
  {issued.length>0&&<>
   <p className="note">請在關閉前下載，並個別交付給帳號持有人。</p>
   <button type="button" className="btn" onClick={()=>downloadCsv(credential,students?[
    ['班級','座號','姓名','學生登入碼',credential],...issued.map(row=>[row.class_name,row.number,row.name,row.student_link.split('#student=')[1],row.student_link]),
   ]:[['帳號','姓名','角色',credential,'首次啟用碼'],...issued.map(row=>[row.username,row.name,ROLE_NAMES[row.role],row.initial_password,row.teacher_code])])}>
    <Download size={16}/>下載{credential}清單
   </button>
  </>}
  <div className="table-wrap"><table><thead><tr><th>{students?'班級／座號':'帳號'}</th><th>姓名</th><th>結果</th><th>{credential}</th></tr></thead>
   <tbody>{results.map((row,i)=><tr key={i}><td>{identifier(row,students)}</td><td>{row.name}</td>
    <td>{labels[row.status]}{row.error&&<small>{row.error}</small>}</td>
    <td>{row.student_link?<a href={row.student_link} target="_blank" rel="noreferrer">個人登入連結</a>:<code>{row.initial_password||'—'}</code>}{row.teacher_code&&<small>啟用碼 {row.teacher_code}</small>}</td>
   </tr>)}</tbody>
  </table></div>
  <div className="form-actions"><button className="btn primary" onClick={close}>完成並關閉</button></div>
 </>;
}

export default function AccountImport({type,term,busy,demo,snapshot,close,save}) {
 const {title,headers,example,parse,note}=roles[type];
 const students=type==='students', liveIssue=type!=='legacy';
 const [input,setInput]=useState(''),[reading,setReading]=useState(false),[preview,setPreview]=useState(null);
 const [error,setError]=useState(''),[progress,setProgress]=useState(0),[results,setResults]=useState(null);
 function changeInput(value){setInput(value);setPreview(null);setError('');}
 async function readFile(event) {
  const file=event.target.files[0];
  if(!file)return;
  changeInput('');
  if(file.size>256000){setError('檔案過大，請拆分後匯入。');return;}
  setReading(true);
  try{changeInput(await file.text());}
  catch{setError('無法讀取檔案，請另存成 UTF-8 CSV 後重試。');}
  finally{setReading(false);}
 }
 function showPreview(){
  try{
   const rows=parse(input);
   const validate=students?studentResolver(snapshot,term?.id):null;
   const warnings=rows.map(row=>{
    if(!validate)return '';
    try{
     const checked=validate(row);
     if(checked.hasLink)return '已發行，略過';
     return row.openid?'可發行登入連結':'僅建立名冊與帳號';
    }catch(err){return err.message;}
   });
   setPreview({rows,warnings});setError('');
  }catch(err){setPreview(null);setError(err.message);}
 }
 async function submit(){
  setError('');
  try{
   const reply=await save(preview.rows,setProgress);
   if(liveIssue){changeInput('');setResults(reply);}
  }catch(err){setError(err.message);}
 }
 const noWrite=liveIssue&&(demo||term?.status!=='active');
 return <div className="overlay" onClick={()=>!busy&&!results&&close()}>
  <section className="modal admin-modal" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}>
   <header><h2>{title}</h2>{!results&&<button className="icon-btn" aria-label="關閉" disabled={busy} onClick={close}><X/></button>}</header>
   {results?<ImportResults results={results} close={close} students={students}/>:<>
    <p className="note">目前學期為 {term?.name||'未選擇'}。{note}</p>
    <div className="toolbar">
     <button type="button" className="btn" disabled={busy} onClick={()=>downloadCsv(title+'範本',example?[headers,example]:[headers])}><Download size={16}/>下載 CSV 範本</button>
     <label>上傳 UTF-8 CSV<input type="file" accept=".csv,text/csv" disabled={busy||reading} onChange={readFile}/></label>
    </div>
    <label>或貼上含標題的 CSV／試算表資料<textarea rows="6" value={input} disabled={busy||reading} onChange={e=>changeInput(e.target.value)}/></label>
    {example&&<p className="note">送出前請刪除範本的示例列。</p>}
    {noWrite&&<p className="note">{demo?'試用模式可預覽資料。正式建立請使用行政帳號。':'請切換至使用中的學期後再匯入。'}</p>}
    {error&&<p className="notice" role="alert">{error}</p>}
    {preview&&<div className="table-wrap"><table><thead><tr><th>{students?'班級／座號':'帳號'}</th><th>姓名</th><th>{students?'名冊檢查':'角色'}</th></tr></thead>
     <tbody>{preview.rows.map((row,i)=><tr key={i}><td>{identifier(row,students)}</td><td>{row.name}</td><td>{students?preview.warnings[i]:ROLE_NAMES[row.role]}</td></tr>)}</tbody>
    </table></div>}
    {busy&&liveIssue&&<p role="status">已收到 {progress}／{preview?.rows.length} 筆處理結果，請保持此頁開啟。</p>}
    <div className="form-actions">
     <button className="btn" disabled={busy||!input.trim()} onClick={showPreview}>預覽資料</button>
     <button className="btn primary" disabled={busy||!preview||noWrite} onClick={submit}>確認匯入{preview?' '+preview.rows.length+' 筆':''}</button>
    </div>
   </>}
  </section>
 </div>;
}

export function PendingAccounts({entries,students,terms,busy,action}) {
 if (!entries.length) return null;
 return <section className="panel">
  <div className="panel-head"><div><h2>待啟用帳號</h2><p>電子郵件完成驗證並首次登入後，帳號才會取得系統權限。</p></div></div>
  <div className="table-wrap"><table><thead><tr><th>電子郵件／姓名</th><th>角色</th><th>學生名冊</th><th>操作</th></tr></thead>
   <tbody>{entries.map(entry=>{
    const student=students.find(s=>s.id===entry.student_id);
    const term=terms.find(t=>t.id===student?.term_id);
    return <tr key={entry.email}>
     <td>{entry.email}<small>{entry.name}</small></td>
     <td>{ROLE_NAMES[entry.role]}</td>
     <td>{student?`${term?.name||''} · ${student.class_name} ${student.number}`:'—'}</td>
     <td><button className="btn small" disabled={busy} onClick={()=>{
      if (confirm('取消 '+entry.email+' 的待啟用設定？')) action('cancel_account',{email:entry.email});
     }}>取消待啟用</button></td>
    </tr>;
   })}</tbody>
  </table></div>
 </section>;
}
