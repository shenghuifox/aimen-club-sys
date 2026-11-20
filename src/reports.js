import {escapeHtml as e,money,timeText,dateKey,stamp,csvString} from './domain.js';
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
 <table><colgroup><col style="width:10%"><col style="width:12%"><col style="width:5%"><col><col style="width:10%"><col style="width:12%"><col style="width:10%"><col style="width:9%"><col style="width:7%"></colgroup>
 ${headings(['日期','時間','節數','課程摘要','授課教師','線上簽到時間','紙本親簽','出席學生數','備註'])}
 <tbody>${s.rows.map(r=>`<tr><td>${e(dateKey(new Date(r.starts_at)))}</td><td>${e(timeText(r.starts_at))}–${e(timeText(r.ends_at))}</td>
 <td>${e(r.units)}</td><td>${e(r.summary)}</td><td>${e(r.teacher_name)}</td><td>${e(stamp(r.signed_at))}</td><td class="signature"></td><td>${e(r.attendance_count)}</td><td></td></tr>`).join('')}</tbody></table>
 <p>合計節數：${e(s.units)} 節</p>
 <div class="seals"><div>承辦人</div><div>主任</div><div>校長</div><div>承辦人確認後核章</div></div>`;
}

export function reportHtml(snapshot,kind,id='預覽',demo=false){
 const sign=kind==='sign';
 const orientation=sign?'landscape':'portrait';
 const width=sign?277:190;
 const maxHeight=sign?188:275;
 const title=sign?'簽到表':'鐘點費印領清冊';
 return `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>${title} ${e(id)}</title>
 <style>
 *{box-sizing:border-box}body{font-family:"Microsoft JhengHei","Noto Sans CJK TC",sans-serif;margin:0;color:#111;font-size:10px}
 .paper{width:${width}mm;margin:0 auto;display:flow-root}
 h1{text-align:center;font-size:17px;margin:0 0 8px}p{margin:0 0 6px;overflow-wrap:anywhere}
 table{border-collapse:collapse;width:100%;table-layout:fixed;margin:6px 0}
 th,td{border:1px solid #555;padding:4px;vertical-align:middle;overflow-wrap:anywhere}th{background:#f4f4f4}
 td.signature{height:${sign?24:40}px}.seals{display:flex;border:1px solid #555;margin:7px 0}
 .seals>div{flex:1;height:38px;padding:5px;border-inline-end:1px solid #555}.seals>div:last-child{border:0}
 .school,.demo{text-align:center;font-weight:bold}.demo{color:#a33}.toolbar{text-align:center;margin:12px}.toolbar button{padding:7px 12px}
 footer{font-size:9px;overflow-wrap:anywhere}
 @page{size:A4 ${orientation};margin:10mm}
 @media print{.toolbar{display:none}.page-frame{position:relative;height:${maxHeight}mm;overflow:hidden}.paper{position:absolute;left:50%;margin:0;transform-origin:top center;transform:translateX(-50%) scale(var(--print-scale,1))}}
 </style></head><body><div class="toolbar"><button onclick="window.print()">列印／另存 PDF</button></div>
 <div class="page-frame"><main class="paper">${demo?'<p class="demo">試用資料・不得作為正式核銷憑據</p>':''}
 ${sign?signHtml(snapshot):payrollHtml(snapshot)}<footer>版本 2 · ${e(id)}</footer></main></div>
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
