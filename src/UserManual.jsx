import React,{useState} from 'react';
import {ROLE_NAMES} from './domain.js';

const roles=['admin','clubtr','hrtr','stu'];
const general=[
 ['登入與帳號',[
  '先在首頁選擇身分。老師使用個人帳號與密碼，初次啟用或由學校重設後，依畫面輸入啟用碼並更改密碼。行政帳號需先完成 Email 驗證。',
  '學生在首頁選班級、座號，輸入數字 OpenID 帳號、姓名最後一個字與學校發給你的登入碼。個人裝置可勾選記住登入碼，共用裝置請勿勾選。',
  '忘記登入資料時，請聯絡教導處。用完共用裝置時請登出。',
 ]],
 ['入口首頁和本週課表',[
  '老師登入後，從首頁查看今日課程、本週課表與異動。先核對右上角學期。點課堂可看社團、時間、老師與地點，手機可橫向滑動週課表。',
  '未登入時可查看首頁公開行事曆，並按「列印週課表」列印目前週次的 A4 橫式版本。個人結果與名冊須登入後依權限查看。',
 ]],
 ['安裝到手機主畫面',[
  'iPhone 或 iPad 用 Safari 開啟網站，點「分享」後選「加入主畫面」。Android 用 Chrome 開啟，從選單選「安裝應用程式」或「加到主畫面」。',
 ]],
];

const attendance=['授課與點名',[
 '從「授課與點名」選擇自己的節次。上課日按「教師簽到」，並在開課後填寫本節摘要、逐一核對學生出缺席，再按儲存確認。',
 '系統預填出席，請逐一核對。已覆核的假單會帶入請假；待確認的假單仍須覆核。',
 '本週已到日期可補簽到，開課後可補點；已核銷的節次請由行政處理更正。',
 ],'attendance'];
const leave=['請假與覆核',[
 '選學生、課程、假別並填原因。行政和本班導師可依權限登記、覆核；授課老師可查看所授節次的假單，並可依欄位權限撤回。',
 '撤回前先確認是否已帶入點名或核銷。往週點名已引用、或已鎖定的紀錄，請聯絡行政處理。',
 ],'leave'];
const roster=['課表與名冊',[
 '可用班級、姓名或社團找學生，查看權限範圍內的名冊與上課安排。可依班級及座號排序。行政也可依帳號英數順序排列。先選班級或社團，再按「列印名冊」，可列印成一張 A4 或另存 PDF。',
 ],'roster'];

const byRole={
 admin:[
  ['社團與報名',[
   '先切換學期，確認社團名稱、老師、地點、名額、報名期間與費率。可在本週課表批次新增週期節次，核對後再開放報名。',
   '在「報名與上課名單管理」處理錄取、候補或不錄取。生效日期會影響點名名冊，請先核對再批次確認。',
  ],'clubs'],
  ['加課、停課、補課與調課',[
   '加課進「異動管理 → 安排加課」。選社團、日期與起訖時間、節數、授課老師，再填原因。加課沿用社團的費率。',
   '停課後在該筆停課紀錄旁點「安排補課」，填同一張五欄表單。原節次會自動關聯，補課沿用原節次的費率，避免重複補排。',
   '外聘老師可在授課老師選單點「＋新增外聘老師」，填姓名後隨排課一起儲存。再聘時請選原有師資資料。系統會檢查教師、社團及學生時段衝突。',
   '「雙向調課」交換兩個可調節次的開始時間，保留各自授課長度。「新增異動」可處理代課、每週調整及學生增退。確認待審異動前，先核對範圍和生效日。',
  ],'changes'],
  ['外聘老師紙本簽到與點名',[
   '尚無帳號的老師上課時先紙本親簽。行政在「授課與點名」開啟該節次，選「補登紙本簽到」，填寫說明，再依現場紀錄確認摘要及點名。',
   '系統保留授課老師與行政補登者。外聘老師有個人帳號後，可自行操作指派節次。',
  ],'attendance'],
  attendance,leave,roster,
  ['行政核銷',[
   '先確認課程已完成簽到、授課摘要及點名。在「行政核銷」選社團和起訖日，預覽並核對老師、節數、費率與總額，再鎖定期間。',
   '鎖定後可下載印領清冊 Excel 或列印簽到表。簽到表為直式單頁 A4，保留紙本親簽及承辦人章。紙本完成後登記狀態。',
   '需更正時，先確認會計流程及紙本狀態。紙本未完成的核銷可依權限作廢並留下理由，修正後再重新核銷。',
  ],'billing'],
  ['學生管理',[
   '在正式學期批次匯入班級、座號、姓名，先核對預覽。要發行登入碼時，依匯入欄位提供學生的數字 OpenID，或在個別紀錄發行。',
   '請把學生登入碼或連結個別交付。學生可直接從首頁登入。需重發時用「補發登入連結」並交付新資料。',
  ],'students'],
  ['帳號管理與交接',[
   '新增或批次匯入老師的個人校用帳號。行政另用「邀請行政管理員」，由對方完成 Email 驗證。可依身分重設密碼或停復權。',
   '在「帳號管理 → 外聘老師」選「開通個人帳號」，輸入登入帳號。原排課仍指向同一人。初始密碼及啟用碼請單獨交付。',
   '交接時確認新行政可以登入，再依權限停用不再任職的帳號。',
  ],'permissions'],
  ['學期與設定',[
   '可新增或複製學期。複製後先檢查名冊、導師、授課老師、時段、報名期間與社團公開狀態，再開放使用。',
   '操作前核對右上角學期。115test 用於歷史測試資料。封存學期前請確認該學期業務已結束。需要追蹤操作人時，可查看最近操作。',
  ],'settings'],
 ],
 clubtr:[
  attendance,roster,leave,
  ['異動管理',[
   '需要代課、調課或調整名單時，選「新增異動」並填寫原因，送出後由行政覆核。自己的待確認異動可撤回。',
   '需新增整節課、補回停課或臨時更換外聘老師時，請把社團、日期、起訖時間、節數、實際授課老師和原因交給行政安排。',
  ],'changes'],
 ],
 hrtr:[
  ['本班名冊與課表',[
   '到「課表與名冊」查詢本班學生的社團、參加日期和本週安排。請先確認學期；報名或錄取資料有誤時，請聯絡行政。',
  ],'roster'],leave,attendance,
 ],
 stu:[
  ['社團報名',[
   '點「社團與報名」，查看開放期間、名額與上課時間，在報名期間按「申請報名」。回到同一頁查看是否錄取。',
  ],'clubs'],
  ['個人課表',[
   '錄取後，到「個人課表」看已安排的課程。時間有變動時，也可以先看首頁公開行事曆。',
  ],'roster'],
 ],
};

export default function UserManual({roles:ownRoles,canView,jump}){
 const available=ownRoles.includes('admin')?roles:roles.filter(role=>ownRoles.includes(role));
 const [chosen,setChosen]=useState(available[0]);
 const role=available.includes(chosen)?chosen:available[0];
 const sections=[...byRole[role]||[],...general];
 return <div className="manual">
  <section className="panel">
   <label>依身分查閱<select value={role} onChange={event=>setChosen(event.target.value)}>
    {available.map(item=><option key={item} value={item}>{ROLE_NAMES[item]}</option>)}
   </select></label>
   <nav aria-label="手冊章節">
    {sections.map(([title],i)=><a key={title} href={'#manual-'+i}>{title}</a>)}
   </nav>
  </section>
  {sections.map(([title,steps,destination],i)=><section key={title} id={'manual-'+i} className="panel">
   <h2>{title}</h2><ol>{steps.map(step=><li key={step}>{step}</li>)}</ol>
   {destination&&canView(destination)&&<button className="btn small" onClick={()=>jump(destination)}>開啟此功能</button>}
  </section>)}
  <section className="panel"><h2>聯絡教導處</h2><a href="tel:069212692;ext=20">06-9212692#20</a></section>
 </div>;
}
