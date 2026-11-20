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
 const name=(demo?'試用_':'')+snapshot.start_date+'_'+snapshot.club.name.replace(/[\\/:*?"<>|]/g,'_')+'_憑證及印領清冊.xlsx';
 downloadFile(name,buildPayrollWorkbook(snapshot,demo),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function payrollHtml(snapshot) {
 const {title,purpose,teachers}=payrollDetails(snapshot);
 return `<section class="voucher">
  <div class="voucher-number">日　期：　　年　　月　　日<br>簽證號：</div>
  <p class="school">${e(snapshot.school)}</p>
  <h1>採購（費用動支）申請單暨黏貼憑證用紙</h1>
  <table><tr><th>憑證編號</th><th>預算科目</th><th>金額</th><th>用途說明</th></tr>
   <tr><td></td><td>業務計畫：<br>工作計畫：<br>用途別：鐘點費</td>
   <td>${e(money(snapshot.total))}</td><td>${e(purpose)}</td></tr></table>
  <table><tr><th>經（承）辦單位</th><th>保管</th><th>主計單位</th><th>校長</th></tr>
   <tr><td>經（承）辦人<br><br>人事<br><br>單位主管<br><br>總務主任</td>
   <td>物品登記<br><br>財產登記</td><td>會計審核</td><td></td></tr></table>
  </section>
  <p class="paste-line">憑 證 黏 貼 線</p>
  <h2>${e(title)}</h2>
  <table><thead><tr>${['職別','姓名','授課節數','每節金額','印領金額','簽章','備註'].map(label=>'<th>'+label+'</th>').join('')}</tr></thead>
   <tbody>${teachers.map(t=>`<tr><td>教師</td><td>${e(t.name)}</td><td>${e(t.units)}</td><td>${e(money(t.rate))}</td>
    <td>${e(money(t.amount))}</td><td class="signature"></td><td>${e(t.note)}</td></tr>`).join('')}
   <tr><th>合計</th><td></td><td>${e(snapshot.units)}</td><td></td><td>${e(money(snapshot.total))}</td><td colspan="2"></td></tr>
  </tbody></table>
  <p>備註：扣繳憑單由出納確認　　出納：</p>`;
}

export function reportHtml(snapshot,kind,id='預覽',demo=false){
 const s=snapshot;
 const content=kind==='sign'?`<h1>${e(s.school)} 社團簽到表</h1><p>計畫名稱：${e(s.club.plan_name)}　社團：${e(s.club.name)}</p><p>核算期間：${e(s.start_date)} 至 ${e(s.end_date)}</p><table><thead><tr>${['日期','時間','節數','課程摘要','授課教師','線上簽到時間','紙本親簽','出席學生數','備註'].map(x=>'<th>'+x+'</th>').join('')}</tr></thead><tbody>${s.rows.map(r=>`<tr><td>${e(dateKey(new Date(r.starts_at)))}</td><td>${e(timeText(r.starts_at))}–${e(timeText(r.ends_at))}</td><td>${e(r.units)}</td><td>${e(r.summary)}</td><td>${e(r.teacher_name)}</td><td>${e(stamp(r.signed_at))}</td><td class="signature"></td><td>${e(r.attendance_count)}</td><td></td></tr>`).join('')}</tbody></table><p>合計節數：${e(s.units)} 節</p><div class="seals"><div>承辦人</div><div>主任</div><div>校長</div></div><div class="confirm">承辦人確認後核章</div>`:
 payrollHtml(s);
 return `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>${kind==='sign'?'簽到表':'鐘點費憑證'} ${e(id)}</title><style>body{font-family:"Microsoft JhengHei",sans-serif;padding:28px;color:#111;font-size:12px}h1{text-align:center;font-size:22px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{border:1px solid #555;padding:9px;vertical-align:middle}th{background:#f4f4f4}td.signature{min-width:65px;height:54px}.seals{display:flex;border:1px solid;margin-top:28px;break-inside:avoid}.seals>div{flex:1;height:85px;padding:10px;border-right:1px solid}.confirm{border:1px solid;height:90px;margin-top:20px;padding:12px;break-inside:avoid}.voucher h1{font-size:18px;margin:4px 0 10px}.voucher table{margin:8px 0;table-layout:fixed}.voucher th:first-child{width:20%}.voucher td{height:60px;vertical-align:top}.voucher-number{text-align:right;line-height:1.7}.school{text-align:center;font-weight:bold}.paste-line{text-align:center;border-top:1px dashed #555;padding-top:8px}.demo{color:#a33;font-weight:bold;text-align:center}.toolbar{text-align:center;margin-bottom:20px}thead{display:table-header-group}tr{break-inside:avoid}@page{size:A4 ${kind==='sign'?'landscape':'portrait'};margin:12mm}@media print{body{padding:0}.toolbar{display:none}}</style></head><body><div class="toolbar"><button onclick="window.print()">列印／另存 PDF</button></div>${demo?'<p class="demo">試用資料・不得作為正式核銷憑證</p>':''}${content}<footer>版本 1 · ${e(id)}</footer></body></html>`;
}
export function printReport(snapshot,kind,id,demo){const win=window.open('','_blank');if(!win)throw Error('請允許開啟報表視窗。');win.opener=null;win.document.write(reportHtml(snapshot,kind,id,demo));win.document.close();}
