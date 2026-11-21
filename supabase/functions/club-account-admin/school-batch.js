import {schoolEmail} from './school-auth.js';

export const SCHOOL_BATCH_SIZE=10;
export const SCHOOL_IMPORT_ROLES={
 學生:'stu',家長:'guardian',社團老師:'clubtr',班級導師:'hrtr',
 stu:'stu',guardian:'guardian',clubtr:'clubtr',hrtr:'hrtr',
};
const schoolRoles=new Set(Object.values(SCHOOL_IMPORT_ROLES));
const trim=value=>typeof value==='string'?value.trim():'';
export const familyRole=role=>role==='stu'||role==='guardian';

export function schoolBatchRow(row) {
 const alias=schoolEmail(row?.username),name=trim(row?.name),role=row?.role;
 const class_name=trim(row?.class_name),number=trim(row?.number);
 const student_name=trim(row?.student_name)||(role==='stu'?name:'');
 if(!alias||!name||name.length>100||!schoolRoles.has(role))throw Error('請核對校用帳號、姓名及角色。');
 if(familyRole(role)&&(!class_name||!number||!student_name||[class_name,number,student_name].some(v=>v.length>100)))
  throw Error('學生及家長帳號須填寫班級、座號及學生姓名。');
 if(!familyRole(role)&&(class_name||number||student_name))throw Error('教師的班級、座號及學生姓名請留空。');
 return {username:alias.split('@')[0],name,role,class_name,number,student_name};
}

export function schoolBatchResolver({students,users},termId){
 const usernames=new Set(users.map(u=>u.username?.toLowerCase()).filter(Boolean));
 const roster=new Map();
 const pupilKey=(className,number,name)=>JSON.stringify([className,number,name]);
 for(const student of students){
  if(student.term_id!==termId)continue;
  const key=pupilKey(student.class_name,String(student.number),student.name);
  roster.set(key,roster.has(key)?null:student);
 }
 const allocated=new Set();
 return raw=>{
  const row=schoolBatchRow(raw);
  if(usernames.has(row.username))throw Error('帳號已存在或重複，請核對帳號名稱。');
  if(familyRole(row.role)){
   const student=roster.get(pupilKey(row.class_name,row.number,row.student_name));
   if(!student)throw Error('本學期名冊找不到唯一符合的學生，請核對班級、座號與姓名。');
   if(row.role==='stu'){
    if(student.user_id||allocated.has(student.id))throw Error('此學生已有帳號綁定或在檔案中重複。');
    allocated.add(student.id);
   }
   row.student_id=student.id;
  }
  usernames.add(row.username);
  return row;
 };
}

export async function issueSchoolBatch(rows,resolve,issue){
 const results=[];
 for(const raw of rows){
  let row;
  try{row=resolve(raw);}
  catch(error){results.push({status:'failed',error:error.message});continue;}
  try{
   const result=await issue(row);
   results.push(result.error?{status:'failed',error:result.error}:{status:'created',initial_password:result.initial_password});
  }catch{
   results.push({status:'unknown',error:'無法確認建帳結果，請先查看帳號管理。'});
  }
 }
 return results;
}
