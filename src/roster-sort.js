const natural=new Intl.Collator('zh-Hant',{numeric:true,sensitivity:'base'});
const accounts=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
const digits='一二三四五六七八九';
const classKey=value=>String(value??'').trim().replace(/^([一二三四五六七八九])(?=年級?|班|[甲乙丙丁戊己庚辛])/,(_,grade)=>String(digits.indexOf(grade)+1));
const compare=(a,b,collator)=>{
 const left=String(a??'').trim(),right=String(b??'').trim();
 return left&&right?collator.compare(left,right):Number(!left)-Number(!right);
};
export function studentOrder(mode='class',account=()=>'',student=row=>row){
 return (left,right)=>{
  const a=student(left),b=student(right);
  if(mode==='account'){
   const byAccount=compare(account(a),account(b),accounts);
   if(byAccount)return byAccount;
  }
  return compare(classKey(a?.class_name),classKey(b?.class_name),natural)
   ||compare(a?.number,b?.number,natural)||compare(a?.name,b?.name,natural)||compare(a?.id,b?.id,natural);
 };
}
export const accountOrder=(a,b)=>compare(a?.username||a?.email,b?.username||b?.email,accounts)
 ||compare(a?.name,b?.name,natural)||compare(a?.id,b?.id,natural);
