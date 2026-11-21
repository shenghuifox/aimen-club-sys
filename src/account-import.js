import {SCHOOL_IMPORT_ROLES,schoolBatchRow} from '../supabase/functions/club-account-admin/school-batch.js';
export const ACCOUNT_HEADERS=['帳號','姓名','角色','班級','座號'];
export const SCHOOL_HEADERS=['帳號','姓名','角色','班級','座號','學生姓名'];
export const IMPORT_ROLES={學生:'stu',社團老師:'clubtr',班級導師:'hrtr',stu:'stu',clubtr:'clubtr',hrtr:'hrtr'};

function fields(line,delimiter) {
 const values=[];
 let index=0;
 do {
  if (line[index]==='"') {
   const match=line.slice(index).match(/^"((?:[^"]|"")*)"/);
   if (!match) throw Error('欄位引號未關閉');
   values.push(match[1].replaceAll('""','"').trim());
   index+=match[0].length;
   if (index<line.length && line[index]!==delimiter) throw Error('欄位引號格式錯誤');
  } else {
   const end=line.indexOf(delimiter,index);
   const value=line.slice(index,end===-1?line.length:end);
   if (value.includes('"')) throw Error('欄位引號格式錯誤');
   values.push(value.trim());
   index=end===-1?line.length:end;
  }
  if (index===line.length) break;
  index++;
 } while (index<=line.length);
 return values;
}

function parseRows(text,expectedHeaders,read) {
 const lines=text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/).filter(line=>line.trim() && !/^[,;\t]+$/.test(line.trim()));
 const delimiter=lines[0]?.includes('\t')?'\t':lines[0]?.includes(';')?';':',';
 const headers=fields(lines.shift()||'',delimiter);
 if (headers.join('|')!==expectedHeaders.join('|')) throw Error('請依範本欄位順序填寫：'+expectedHeaders.join('、'));
 if (lines.length<1 || lines.length>200) throw Error('每批可匯入 1 至 200 筆。');
 const seen=new Set();
 return lines.map((line,index)=>{
  try {
   const row=fields(line,delimiter);
   if (row.length!==headers.length) throw Error('欄位數量不正確');
   const item=read(row);
   const account=item.username||item.email;
   if (seen.has(account)) throw Error('帳號重複');
   seen.add(account);
   return item;
  } catch (error) {
   throw Error('第 '+(index+1)+' 筆：'+error.message);
  }
 });
}

export function parseAccountImport(text) {
 return parseRows(text,ACCOUNT_HEADERS,([account,name,roleLabel,class_name,number])=>{
  const role=Object.hasOwn(IMPORT_ROLES,roleLabel)?IMPORT_ROLES[roleLabel]:null;
  const email=(account.includes('@')?account:account+'@test.aimen.invalid').toLowerCase();
  if(!account||email.length>254||!emailPattern.test(email)||!name||name.length>100||!role)
   throw Error('請核對帳號、姓名及角色');
  if(role==='stu'&&(!class_name||!number))throw Error('學生須填寫班級與座號');
  if(role!=='stu'&&(class_name||number))throw Error('教師的班級與座號請留空');
  return {email,name,role,class_name,number};
 });
}

const emailPattern=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseSchoolImport(text) {
 return parseRows(text,SCHOOL_HEADERS,([username,name,roleLabel,class_name,number,student_name])=>{
  const role=Object.hasOwn(SCHOOL_IMPORT_ROLES,roleLabel)?SCHOOL_IMPORT_ROLES[roleLabel]:null;
  return schoolBatchRow({username,name,role,class_name,number,student_name});
 });
}
