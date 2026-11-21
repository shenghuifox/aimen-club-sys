import {createClient} from "npm:@supabase/supabase-js@2.95.3";
import {cardPattern,openidPattern,seatNumber,studentHashes,digest,teacherCodePattern,teacherDefault} from "../club-account-admin/student-access.js";
const origin="https://shenghuifox.github.io";
const headers={
 "Access-Control-Allow-Origin":origin,
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Cache-Control":"no-store",
};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
const invalid=()=>reply({error:"無法確認學生身分。請核對班級、座號、OpenID 數字、姓名末字及登入碼。"},401);

Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(request.method!=="POST")return reply({error:"不支援此操作。"},405);
 try{
  const body=await request.text();
  if(body.length>2048)return invalid();
  const input=JSON.parse(body)||{};
  const service=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
   {auth:{persistSession:false,autoRefreshToken:false}});
  let email;
  if(input.action==="teacher_setup") {
   const {username,password,teacher_code}=input;
   if(typeof username!=="string"||!(/^[a-z0-9][a-z0-9_-]{1,39}$/i.test(username))
     ||typeof teacher_code!=="string"||!teacherCodePattern.test(teacher_code)
     ||password!==teacherDefault(username.toLowerCase()))return reply({error:"請核對老師帳號、初始密碼與啟用碼。"},401);
   const r=await service.rpc("club_teacher_activation_email",{
    p_username:username.toLowerCase(),p_digest:await digest(teacher_code),
   });
   if(r.error||!r.data)return reply({error:"啟用碼無效或已用過。請聯絡行政。"},401);
   email=r.data;
  } else {
   const {card,openid,class_name,last_character,number}=input;
   if(typeof card!=="string"||!cardPattern.test(card)||typeof openid!=="string"||!openidPattern.test(openid)
     ||typeof class_name!=="string"||!class_name||class_name.length>60||typeof last_character!=="string"
     ||[...last_character].length!==1||!(/^[1-9][0-9]?$/.test(seatNumber(number))))return invalid();
   const r=await service.rpc("club_resolve_student",{payload:{
    ...await studentHashes(card,openid),class_name,last_character,number:seatNumber(number),
   }});
   if(r.error||!r.data)return invalid();
   email=r.data;
  }
  const {data:link,error:issueError}=await service.auth.admin.generateLink({type:"magiclink",email});
  if(issueError||!link?.properties?.hashed_token)return reply({error:"目前無法登入，請稍後重試。"},503);
  return reply({token_hash:link.properties.hashed_token});
 }catch{return invalid();}
});
