import {escapeHtml as e,money,timeText,dateKey,csvString,weekDays} from './domain.js';
import {buildPayrollWorkbook,payrollDetails} from './payroll.js';

function downloadFile(name,contents,type) {
 const url=URL.createObjectURL(new Blob([contents],{type}));
 const link=document.createElement('a');
 link.href=url;
 link.download=name;
 link.click();
 setTimeout(()=>URL.revokeObjectURL(url),5000);
}
export function downloadCsv(name,rows) {
 downloadFile(name+'.csv',csvString(rows),'text/csv;charset=utf-8;');
}

export function downloadPayroll(snapshot,demo) {
 const name=(demo?'試用_':'')+snapshot.start_date+'_'+snapshot.club.name.replace(/[\\/:*?"<>|]/g,'_')+'_鐘點費印領清冊.xlsx';
 downloadFile(name,buildPayrollWorkbook(snapshot,demo),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

const headings=labels=>'<thead><tr>'+labels.map(label=>'<th>'+label+'</th>').join('')+'</tr></thead>';

function payrollHtml(s){
 const {title,teachers}=payrollDetails(s);
 return `<p class="school">${e(s.school)}　${e(s.club.name)}</p><h1>${e(title)}</h1>
 <table><colgroup><col style="width:8%"><col style="width:13%"><col style="width:11%"><col style="width:12%"><col style="width:13%"><col style="width:13%"><col></colgroup>
 ${headings(['職別','姓名','授課節數','每節金額','印領金額','簽章','備註'])}
 <tbody>${teachers.map(t=>`<tr><td>教師</td><td>${e(t.name)}</td><td>${e(t.units)}</td><td>${e(money(t.rate))}</td>
 <td>${e(money(t.amount))}</td><td class="signature"></td><td>${e(t.note)}</td></tr>`).join('')}
 <tr><th colspan="2">合計</th><td>${e(s.units)}</td><td></td><td>${e(money(s.total))}</td><td colspan="2"></td></tr></tbody></table>
 <p>備註：扣繳憑單由出納確認　　出納：</p>`;
}

function signHtml(s){
 return `<h1>${e(s.school)} 社團簽到表</h1>
 <p>計畫名稱：${e(s.club.plan_name)}　社團：${e(s.club.name)}　核算期間：${e(s.start_date)} 至 ${e(s.end_date)}</p>
 <table><colgroup><col style="width:12%"><col style="width:13%"><col style="width:6%"><col><col style="width:11%"><col style="width:10%"><col style="width:9%"><col style="width:7%"></colgroup>
 ${headings(['日期','上課時間','節數','課程摘要','授課教師','紙本親簽','出席學生數','備註'])}
 <tbody>${s.rows.map(r=>`<tr><td>${e(dateKey(new Date(r.starts_at)))}</td><td>${e(timeText(r.starts_at))}–${e(timeText(r.ends_at))}</td>
 <td>${e(r.units)}</td><td>${e(r.summary)}</td><td>${e(r.teacher_name)}</td><td class="signature"></td><td>${e(r.attendance_count)}</td><td></td></tr>`).join('')}</tbody></table>
 <p>合計節數：${e(s.units)} 節</p>
 <p class="handler-seal">承辦人</p>`;
}

function rosterHtml({group,teacher,term,students}){
 const columns=Math.min(4,Math.max(1,Math.ceil(students.length/25)));
 const size=Math.max(1,Math.ceil(students.length/columns));
 return `<h1>隘門國民小學　${e(group)}名冊</h1>
 <p>${e(term)}　｜　教師 ${e(teacher||'未登錄')}　｜　共 ${students.length} 人</p>
 <div class="roster-columns" style="--columns:${columns}">${Array.from({length:columns},(_,i)=>
  `<table>${headings(['班級','座號','姓名'])}<tbody>${students.slice(i*size,(i+1)*size).map(student=>
   `<tr><td>${e(student.class_name)}</td><td>${e(student.number)}</td><td>${e(student.name)}</td></tr>`).join('')}</tbody></table>`).join('')}</div>`;
}

function calendarHtml({week,rows,title}){
 const days=weekDays(week);
 const groups=new Map(days.map(day=>[day,[]]));
 for(const row of [...rows].sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))){
  groups.get(dateKey(new Date(row.starts_at)))?.push(row);
 }
 return `<h1>隘門國民小學　${e(title||'社團週課表')}</h1>
 <p>${e(days[0])} 至 ${e(days[6])}</p>
 <table class="calendar-print">${headings(days.map((day,i)=>'週'+'一二三四五六日'[i]+' '+e(day.slice(5))))}
 <tbody><tr>${days.map(day=>`<td>${groups.get(day).map(row=>`<div class="print-event${row.cancelled?' cancelled':''}">
  <strong>${row.cancelled?'【停課】':''}${e(row.club_name)}</strong>
  <div>${e(timeText(row.starts_at))}–${e(timeText(row.ends_at))}</div>
  <div>${e([row.location,row.teacher].filter(Boolean).join(' · '))}</div>
 </div>`).join('')||'—'}</td>`).join('')}</tr></tbody></table>`;
}

export function reportHtml(snapshot,kind,id='預覽',demo=false){
 const layouts={
  sign:['簽到表',signHtml],payroll:['鐘點費印領清冊',payrollHtml],
  roster:['學生名冊',rosterHtml],calendar:['週課表',calendarHtml],
 };
 const [title,render]=layouts[kind];
 const landscape=kind==='calendar',orientation=landscape?'landscape':'portrait';
 const width=landscape?277:190,maxHeight=landscape?188:275;
 return `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>${title} ${e(id)}</title>
 <style>
 *{box-sizing:border-box}body{font-family:"Microsoft JhengHei","Noto Sans CJK TC",sans-serif;margin:0;color:#111;font-size:10px}
 .paper{width:${width}mm;margin:0 auto;display:flow-root}
 h1{text-align:center;font-size:17px;margin:0 0 8px}p{margin:0 0 6px;overflow-wrap:anywhere}
 table{border-collapse:collapse;width:100%;table-layout:fixed;margin:6px 0}
 th,td{border:1px solid #555;padding:4px;vertical-align:middle;overflow-wrap:anywhere}th{background:#f4f4f4}
 td.signature{height:${kind==='sign'?24:40}px}
 .handler-seal{width:31mm;height:13mm;border:1px solid #555;padding:5px;margin:7px 0}
 .school,.demo{text-align:center;font-weight:bold}.demo{color:#a33}.toolbar{text-align:center;margin:12px}.toolbar button{padding:7px 12px}
 footer{font-size:9px;overflow-wrap:anywhere}
 .roster-columns{display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:8px;align-items:start}
 .roster-columns th:nth-child(2){width:24%}.roster-columns td{font-size:11px}
 .calendar-print td{vertical-align:top}.print-event{padding:5px 1px;line-height:1.4}.print-event+.print-event{border-top:1px solid #aaa}
 .cancelled strong{color:#9e1d1d}
 @page{size:A4 ${orientation};margin:10mm}
 @media print{.toolbar{display:none}.page-frame{position:relative;height:${maxHeight}mm;overflow:hidden}.paper{position:absolute;left:50%;margin:0;transform-origin:top center;transform:translateX(-50%) scale(var(--print-scale,1))}}
 </style></head><body><div class="toolbar"><button onclick="window.print()">列印／另存 PDF</button></div>
 <div class="page-frame"><main class="paper">${demo?'<p class="demo">試用資料'+(['sign','payroll'].includes(kind)?'・不得作為正式核銷憑據':'')+'</p>':''}
 ${render(snapshot)}<footer>版本 2 · ${e(id)}</footer></main></div>
 <script>
 const paper=document.querySelector('.paper');
 function fitPage(){
  // Use the unscaled height so repeated print previews get the same scale.
  paper.style.setProperty('--print-scale',Math.min(1,${maxHeight}*96/25.4/Math.max(paper.scrollHeight+2,1)));
 }
 addEventListener('beforeprint',fitPage);
 fitPage();
 </script></body></html>`;
}

export function printReport(snapshot,kind,id,demo){
 const win=window.open('','_blank');
 if(!win)throw Error('請允許開啟報表視窗。');
 win.opener=null;
 win.document.write(reportHtml(snapshot,kind,id,demo));
 win.document.close();
}
