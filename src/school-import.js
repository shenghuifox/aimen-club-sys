import {SCHOOL_BATCH_SIZE} from '../supabase/functions/club-account-admin/school-batch.js';

export async function submitSchoolImport(rows,termId,send,onProgress){
 const results=[];
 for(let offset=0;offset<rows.length;offset+=SCHOOL_BATCH_SIZE){
  const chunk=rows.slice(offset,offset+SCHOOL_BATCH_SIZE);
  try{
   const response=await send({action:'batch_create_school',term_id:termId,rows:chunk});
   if(response?.results?.length!==chunk.length)throw Error('未收到完整的匯入結果');
   results.push(...response.results.map((result,index)=>({...chunk[index],...result})));
  }catch(error){
   results.push(...chunk.map(row=>({...row,status:'unknown',error:'本批結果未確認。'+error.message})));
   results.push(...rows.slice(offset+chunk.length).map(row=>({...row,status:'skipped',error:'尚未送出。'})));
   break;
  }
  onProgress(results.length);
 }
 return results;
}
