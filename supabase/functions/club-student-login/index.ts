import {createClient} from "npm:@supabase/supabase-js@2.95.3";
import {cardPattern,openidPattern,seatNumber,studentHashes} from "../club-account-admin/student-access.js";
const origin="https://shenghuifox.github.io";
const headers={
 "Access-Control-Allow-Origin":origin,
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Cache-Control":"no-store",
};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
const invalid=()=>reply({error:"無法確認學生身分。請核對登入連結、班級、座號、OpenID 數字及姓名末字。"},401);

Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(request.method!=="POST")return reply({error:"不支援此操作。"},405);
 try{
  const body=await request.text();
  if(body.length>2048)return invalid();
  const {card,openid,class_name,last_character,number}=JSON.parse(body)||{};
  if(typeof card!=="string"||!cardPattern.test(card)||typeof openid!=="string"||!openidPattern.test(openid)
    ||typeof class_name!=="string"||!class_name||class_name.length>60||typeof last_character!=="string"
    ||[...last_character].length!==1||!(/^[1-9][0-9]?$/.test(seatNumber(number))))return invalid();
  const service=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
   {auth:{persistSession:false,autoRefreshToken:false}});
  const {data:email,error}=await service.rpc("club_resolve_student",{payload:{
   ...await studentHashes(card,openid),class_name,last_character,number:seatNumber(number),
  }});
  if(error||!email)return invalid();
  const {data:link,error:issueError}=await service.auth.admin.generateLink({type:"magiclink",email});
  if(issueError||!link?.properties?.hashed_token)return reply({error:"目前無法登入，請稍後重試。"},503);
  return reply({token_hash:link.properties.hashed_token});
 }catch{return invalid();}
});
