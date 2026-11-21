import React,{useState} from 'react';
import {X,Download} from 'lucide-react';
import {SCHOOL_HEADERS,ACCOUNT_HEADERS,parseAccountImport,parseSchoolImport} from './account-import.js';
import {schoolBatchResolver} from '../supabase/functions/club-account-admin/school-batch.js';
import {ROLE_NAMES} from './domain.js';
import {downloadCsv} from './reports.js';

const labels={created:'已建立',failed:'未建立',unknown:'待確認',skipped:'未送出'};
const example=['parent-001','王家長','家長','三甲','01','王小明'];

function ImportResults({results,close}) {
 const created=results.filter(row=>row.status==='created');
 const interrupted=results.some(row=>row.status==='unknown'||row.status==='skipped');
 return <>
  <p role="status">已建立 {created.length} 筆，其餘 {results.length-created.length} 筆請查看結果。</p>
  {created.length>0&&<>
   <p className="note">初始密碼只在此畫面提供。離開前請下載交付清單，並個別交付帳號持有人。</p>
   <button type="button" className="btn" onClick={()=>downloadCsv('校用帳號初始密碼',[
    ['帳號','姓名','角色','初始密碼'],
    ...created.map(row=>[row.username,row.name,ROLE_NAMES[row.role],row.initial_password]),
   ])}><Download size={16}/>下載初始密碼清單</button>
  </>}
  {interrupted&&<p className="note">待確認的帳號請先在帳號管理查詢。若帳號已建立，可從帳號管理重設其密碼。尚未建立的項目可重新匯入。</p>}
  <div className="table-wrap"><table><thead><tr><th>帳號</th><th>姓名</th><th>結果</th><th>初始密碼</th></tr></thead>
   <tbody>{results.map(row=><tr key={row.username}><td>{row.username}</td><td>{row.name}</td>
    <td>{labels[row.status]}{row.error&&<small>{row.error}</small>}</td><td><code>{row.initial_password||'—'}</code></td></tr>)}</tbody>
  </table></div>
  <div className="form-actions"><button className="btn primary" onClick={close}>完成並關閉</button></div>
 </>;
}

export default function AccountImport({type,term,busy,demo,snapshot,close,save}) {
 const school=type==='school';
 const title=school?'批次匯入校用帳號':'既有電子郵件帳號匯入';
 const headers=school?SCHOOL_HEADERS:ACCOUNT_HEADERS;
 const [input,setInput]=useState('');
 const [reading,setReading]=useState(false);
 const [preview,setPreview]=useState(null);
 const [error,setError]=useState('');
 const [progress,setProgress]=useState(0);
 const [results,setResults]=useState(null);
 function changeInput(value) {
  setInput(value);
  setPreview(null);
  setError('');
 }
 async function readFile(event) {
  const file=event.target.files[0];
  if (!file) return;
  changeInput('');
  if (file.size>256000) { setError('檔案過大，請拆分後匯入。');return; }
  setReading(true);
  try { changeInput(await file.text()); }
  catch { setError('無法讀取檔案，請另存成 UTF-8 CSV 後重試。'); }
  finally { setReading(false); }
 }
 function showPreview(){
  try{
   const rows=(school?parseSchoolImport:parseAccountImport)(input);
   const validate=school?schoolBatchResolver(snapshot,term?.id):null;
   const warnings=rows.map(row=>{
    if(!validate)return '';
    try{validate(row);return '';}
    catch(err){return err.message;}
   });
   setPreview({rows,warnings});setError('');
  }catch(err){setPreview(null);setError(err.message);}
 }
 async function submit(){
  setError('');
  try{
   const reply=await save(preview.rows,setProgress);
   if(school)setResults(reply);
  }catch(err){setError(err.message);}
 }
 return <div className="overlay" onClick={()=>!busy&&!results&&close()}>
  <section className="modal admin-modal" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}>
   <header><h2>{title}</h2>{!results&&<button className="icon-btn" aria-label="關閉" disabled={busy} onClick={close}><X/></button>}</header>
   {results?<ImportResults results={results} close={close}/>:<>
    <p className="note">目前學期為 {term?.name||'未選擇'}。{school?'使用 CSV 或貼上試算表資料。新帳號無須電子郵件即可登入。':'已驗證的電子郵件帳號會立即綁定，其他帳號待完成驗證後啟用。'}</p>
    <div className="toolbar">
     <button type="button" className="btn" disabled={busy} onClick={()=>downloadCsv(school?'校用帳號匯入範本':'電子郵件帳號匯入範本',school?[headers,example]:[headers])}><Download size={16}/>下載 CSV 範本</button>
     <label>上傳 UTF-8 CSV<input type="file" accept=".csv,text/csv" disabled={busy||reading} onChange={readFile}/></label>
    </div>
    <label>或貼上含標題的 CSV／試算表資料
     <textarea rows="6" value={input} disabled={busy||reading} onChange={e=>changeInput(e.target.value)}/>
    </label>
    <p className="note">{school?'可匯入學生、家長、社團老師及班級導師。學生與家長請填班級、座號及學生姓名，學生帳號的學生姓名可沿用姓名欄。匯入前請刪除範本的示例列。':'角色填「學生」、「社團老師」或「班級導師」。學生的班級、座號及姓名須與名冊完全相同。'}教師請留空名冊欄位。座號如有前導 0，請在試算表以文字格式填寫。</p>
    {school&&(demo||term?.status!=='active')&&<p className="note">{demo?'試用模式可預覽格式。正式建帳請用行政帳號登入。':'請切換至使用中的學期後再匯入。'}</p>}
    {preview?.warnings.some(Boolean)&&<p className="note">請核對預覽中的提示。匯入時會再次比對名冊，符合條件的項目才會建立。</p>}
    {error&&<p className="notice" role="alert">{error}</p>}
    {preview&&<div className="table-wrap"><table><thead><tr>{headers.map(header=><th key={header}>{header}</th>)}{school&&<th>名冊檢查</th>}</tr></thead>
     <tbody>{preview.rows.map((row,index)=><tr key={row.username||row.email}><td>{row.username||row.email}</td><td>{row.name}</td><td>{ROLE_NAMES[row.role]}</td><td>{row.class_name}</td><td>{row.number}</td>{school&&<><td>{row.student_name}</td><td>{preview.warnings[index]||'通過'}</td></>}</tr>)}</tbody>
    </table></div>}
    {busy&&school&&<p role="status">已收到 {progress}／{preview?.rows.length} 筆處理結果，請保持此頁開啟。</p>}
    <div className="form-actions">
     <button className="btn" disabled={busy||!input.trim()} onClick={showPreview}>預覽資料</button>
     <button className="btn primary" disabled={busy||!preview||school&&(demo||term?.status!=='active')} onClick={submit}>確認匯入{preview?' '+preview.rows.length+' 筆':''}</button>
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
