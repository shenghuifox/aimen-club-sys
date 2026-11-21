export const encodeHex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
export const randomHex=bytes=>encodeHex(crypto.getRandomValues(new Uint8Array(bytes)));
const trim=value=>typeof value==='string'?value.trim():'';
export const seatNumber=value=>trim(value).replace(/^0+/,'');
const codeAlphabet='abcdefghjkmnpqrstuvwxyz023456789';
export const setupCode=length=>Array.from(crypto.getRandomValues(new Uint8Array(length)),n=>codeAlphabet[n&31]).join('');
export const cardPattern=/^(?:[0-9a-f]{48}|[abcdefghjkmnpqrstuvwxyz023456789]{12})$/;
export const teacherCodePattern=/^[abcdefghjkmnpqrstuvwxyz023456789]{16}$/;
export const teacherDefault=username=>username.trim()+'@Amps';
export const digest=async value=>encodeHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
export const openidPattern=/^[0-9]{1,40}$/;

export function studentRosterRow(row){
 const class_name=trim(row?.class_name),number=trim(row?.number),name=trim(row?.name),openid=trim(row?.openid);
 if(!class_name||class_name.length>60||!/^0*[1-9][0-9]?$/.test(number)||number.length>5||!name||name.length>100)
  throw Error('請核對班級、座號（1 至 99）及姓名。');
 if(openid&&!openidPattern.test(openid))throw Error('OpenID 數字須使用 1 至 40 位數字。');
 return {class_name,number,name,openid};
}
export const studentKey=row=>JSON.stringify([row.class_name,seatNumber(row.number)]);
export async function studentHashes(card,openid){
 return {card_hash:await digest(card),openid_hash:await digest(card+':'+openid)};
}
export function studentResolver(snapshot,term){
 const seats=new Map();
 for(const student of snapshot.students){
  if(student.term_id!==term)continue;
  const key=studentKey(student);
  seats.set(key,seats.has(key)?null:student);
 }
 const issued=new Set(snapshot.student_links||[]),seen=new Set();
 return raw=>{
  const row=studentRosterRow(raw),key=studentKey(row);
  if(seen.has(key))throw Error('本批有重複的班級與座號。');
  seen.add(key);
  const existing=seats.get(key);
  if(existing===null)throw Error('名冊有重複座號，請先更正。');
  if(existing&&existing.name!==row.name)throw Error('同班座號已有不同學生，請核對名冊。');
  return {...row,alreadyBound:Boolean(existing?.user_id),hasLink:issued.has(existing?.id)};
 };
}
