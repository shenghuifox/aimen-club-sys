import {strToU8,zipSync} from 'fflate';
import {dateKey,escapeHtml} from './domain.js';

const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PKG_RELS='http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.';
const XML='<?xml version="1.0" encoding="UTF-8"?>';
const COLUMNS='ABCDEFG';
const STYLE={plain:0,title:1,label:2,center:3,money:4,box:5};

const rocDate=date=>{
 const [year,month,day]=date.split('-').map(Number);
 return [year-1911,month,day].join('/');
};

export function payrollDetails(snapshot) {
 const datesByRate=new Map();
 for (const session of snapshot.rows) {
  const key=JSON.stringify([session.teacher_id,Number(session.rate)]);
  const dates=datesByRate.get(key) || new Map();
  const date=dateKey(new Date(session.starts_at));
  dates.set(date,(dates.get(date)||0)+Math.round(Number(session.units)*100));
  datesByRate.set(key,dates);
 }
 const label=rocDate(snapshot.start_date)+' 至 '+rocDate(snapshot.end_date)+' '+snapshot.club.plan_name;
 const teachers=snapshot.teachers.map(teacher=>{
  const key=JSON.stringify([teacher.teacher_id,Number(teacher.rate)]);
  const dates=[...(datesByRate.get(key)||[])].sort(([a],[b])=>a.localeCompare(b));
  return {...teacher,note:dates.map(([date,units])=>{
   const [,month,day]=date.split('-').map(Number);
   return month+'/'+day+'('+units/100+')';
  }).join('、')};
 });
 return {title:label+' 鐘點費印領清冊',teachers};
}

function cell(ref,value,style) {
 const start='<c r="'+ref+'" s="'+style+'"';
 if (typeof value==='number') {
  if (!Number.isFinite(value)) throw Error('鐘點費資料含有無效數值');
  return start+'><v>'+value+'</v></c>';
 }
 if (!value) return start+'/>';
 const safe=escapeHtml(String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,''));
 return start+' t="inlineStr"><is><t xml:space="preserve">'+safe+'</t></is></c>';
}

function worksheet(snapshot,demo,last) {
 const {title,teachers}=payrollDetails(snapshot);
 const rows=[];
 const merges=[];
 const {plain,label,center,money,box}=STYLE;
 const row=(height,layout=[])=>{
  const number=rows.length+1;
  const cells=new Map();
  for (const [range,value,style] of layout) {
   const [from,to=from]=range.split(':');
   if (from!==to) {
    merges.push(range);
    for (let i=COLUMNS.indexOf(from[0]);i<=COLUMNS.indexOf(to[0]);i++) cells.set(COLUMNS[i],cell(COLUMNS[i]+number,'',style));
   }
   cells.set(from[0],cell(from,value,style));
  }
  rows.push('<row r="'+number+'" ht="'+height+'" customHeight="1">'+[...cells].sort(([a],[b])=>a.localeCompare(b))
   .map(([,xml])=>xml).join('')+'</row>');
 };
 const blanks=(number,columns)=>[...columns].map(col=>[col+number,'',box]);

 row(25,[['A1:G1',(demo?'試用資料｜':'')+snapshot.school+'　'+snapshot.club.name,STYLE.title]]);
 row(24,[['A2:G2',title,STYLE.title]]);
 row(24,['職別','姓名','授課節數','每節金額','印領金額','簽章','備註'].map((value,i)=>[COLUMNS[i]+'3',value,label]));
 teachers.forEach((t,i)=>{
  const values=['教師',t.name,Number(t.units),Number(t.rate),Number(t.amount),'',t.note];
  const lines=Math.max(Math.ceil(t.note.length/22),Math.ceil(t.name.length/8));
  row(Math.min(409,Math.max(38,14*lines+8)),[center,center,center,money,money,box,box]
   .map((style,j)=>[COLUMNS[j]+(4+i),values[j],style]));
 });
 const total=last-1;
 row(28,[['A'+total+':B'+total,'合計',label],['C'+total,Number(snapshot.units),center],
  ['E'+total,Number(snapshot.total),money],...blanks(total,'DFG')]);
 row(24,[['A'+last+':G'+last,'備註：扣繳憑單由出納確認　　出納：',plain]]);
 const cols=[8,15,10,12,13,14,35].map((width,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+width+'" customWidth="1"/>').join('');
 return '<worksheet xmlns="'+MAIN+'"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:G'+last+
  '"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols>'+cols+'</cols><sheetData>'+rows.join('')+
  '</sheetData><mergeCells count="'+merges.length+'">'+merges.map(range=>'<mergeCell ref="'+range+'"/>').join('')+
  '</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.28" right="0.28" top="0.34" bottom="0.34" header="0" footer="0"/>'+
  '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/></worksheet>';
}

function styles() {
 const font=(size,bold='')=>'<font>'+bold+'<sz val="'+size+'"/><name val="Microsoft JhengHei"/></font>';
 const sides=['left','right','top','bottom'].map(side=>'<'+side+' style="thin"><color rgb="FF555555"/></'+side+'>').join('');
 const xf=(fontId,borderId,horizontal,numFmtId=0,fillId=0)=>'<xf xfId="0" fontId="'+fontId+'" borderId="'+borderId+
  '" fillId="'+fillId+'" numFmtId="'+numFmtId+'" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="'+horizontal+
  '" vertical="center" wrapText="1"/></xf>';
 return '<styleSheet xmlns="'+MAIN+'"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.##"/></numFmts>'+
  '<fonts count="2">'+font(10)+font(13,'<b/>')+'</fonts>'+
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF0F0F0"/><bgColor indexed="64"/></patternFill></fill></fills>'+
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>'+sides+'<diagonal/></border></borders>'+
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6">'+
  [xf(0,0,'left'),xf(1,0,'center'),xf(0,1,'center',0,2),xf(0,1,'center'),xf(0,1,'right',164),xf(0,1,'left')].join('')+
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

export function buildPayrollWorkbook(snapshot,demo=false) {
 const last=5+snapshot.teachers.length;
 const sheetName='鐘點費印領清冊';
 const rel=(id,type,target)=>'<Relationship Id="rId'+id+'" Type="'+OFFICE_RELS+'/'+type+'" Target="'+target+'"/>';
 const rels=(...items)=>'<Relationships xmlns="'+PKG_RELS+'">'+items.join('')+'</Relationships>';
 const override=(path,type)=>'<Override PartName="/xl/'+path+'" ContentType="'+MIME+type+'+xml"/>';
 const parts={
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
   '<Default Extension="xml" ContentType="application/xml"/>'+
   override('workbook.xml','sheet.main')+override('worksheets/sheet1.xml','worksheet')+override('styles.xml','styles')+'</Types>',
  '_rels/.rels':rels(rel(1,'officeDocument','xl/workbook.xml')),
  'xl/_rels/workbook.xml.rels':rels(rel(1,'worksheet','worksheets/sheet1.xml'),rel(2,'styles','styles.xml')),
  'xl/workbook.xml':'<workbook xmlns="'+MAIN+'" xmlns:r="'+OFFICE_RELS+'"><bookViews><workbookView/></bookViews><sheets>'+
   '<sheet name="'+sheetName+'" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'+
   "'"+sheetName+"'!$A$1:$G$"+last+'</definedName></definedNames></workbook>',
  'xl/styles.xml':styles(),
  'xl/worksheets/sheet1.xml':worksheet(snapshot,demo,last)
 };
 return zipSync(Object.fromEntries(Object.entries(parts).map(([path,xml])=>[path,strToU8(XML+xml)])));
}
