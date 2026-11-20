import React,{useState} from 'react';
import {X,Download} from 'lucide-react';
import {ACCOUNT_HEADERS,parseAccountImport} from './account-import.js';
import {ROLE_NAMES} from './domain.js';
import {downloadCsv} from './reports.js';

export default function AccountImport({term,busy,close,save}) {
 const [input,setInput]=useState('');
 const [preview,setPreview]=useState(null);
 const [error,setError]=useState('');
 function changeInput(value) {
  setInput(value);
  setPreview(null);
  setError('');
 }
 async function readFile(event) {
  const file=event.target.files[0];
  if (!file) return;
  if (file.size>256000) { setError('檔案過大，請拆分後匯入。'); return; }
  try { changeInput(await file.text()); }
  catch { setError('無法讀取檔案，請另存成 UTF-8 CSV 後重試。'); }
 }
 return <div className="overlay" onClick={()=>!busy&&close()}>
  <section className="modal admin-modal" role="dialog" aria-modal="true" aria-label="批次匯入帳號" onClick={e=>e.stopPropagation()}>
   <header><h2>批次匯入與綁定帳號</h2><button className="icon-btn" aria-label="關閉" disabled={busy} onClick={close}><X/></button></header>
   <p className="note">目前綁定學期為 {term?.name||'未選擇'}。學生的班級、座號及姓名須與名冊完全相同。既有已驗證的登入帳號會立即綁定。新電子郵件先列為待啟用，建立並驗證登入帳號後，第一次登入時完成綁定。</p>
   <div className="toolbar">
    <button type="button" className="btn" disabled={busy} onClick={()=>downloadCsv('帳號匯入範本',[ACCOUNT_HEADERS])}><Download size={16}/>下載 CSV 範本</button>
    <label>上傳 UTF-8 CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={readFile}/></label>
   </div>
   <label>或貼上含標題的 CSV／試算表資料
    <textarea rows="6" value={input} disabled={busy} onChange={e=>changeInput(e.target.value)}/>
   </label>
   <p className="note">角色填「學生」、「社團老師」或「班級導師」。教師的班級與座號留空。請用文字格式保留座號前的 0。</p>
   {error&&<p className="notice" role="alert">{error}</p>}
   {preview&&<div className="table-wrap"><table><thead><tr>{ACCOUNT_HEADERS.map(header=><th key={header}>{header}</th>)}</tr></thead>
    <tbody>{preview.map(row=><tr key={row.email}><td>{row.email}</td><td>{row.name}</td><td>{ROLE_NAMES[row.role]}</td><td>{row.class_name}</td><td>{row.number}</td></tr>)}</tbody>
   </table></div>}
   <div className="form-actions">
    <button className="btn" disabled={busy||!input.trim()} onClick={()=>{
     try { setPreview(parseAccountImport(input)); setError(''); }
     catch (err) { setPreview(null); setError(err.message); }
    }}>預覽資料</button>
    <button className="btn primary" disabled={busy||!preview} onClick={()=>save(preview)}>確認匯入{preview?' '+preview.length+' 筆':''}</button>
   </div>
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
