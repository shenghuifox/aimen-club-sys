const setupTypes=new Set(['invite','recovery']);
const tokenPattern=/^[A-Za-z0-9_-]{16,256}$/;

function tokenProof(params,key){
 const type=params.get('type'),token=params.get(key);
 return setupTypes.has(type)&&tokenPattern.test(token||'')?{type,token_hash:token}:null;
}

export function readAuthCallback(url){
 const search=new URLSearchParams(url.search);
 const hash=new URLSearchParams(url.hash.slice(1));
 const proof=tokenProof(search,'token_hash');
 if(proof)return {proof};
 const type=hash.get('type');
 const accessToken=hash.get('access_token');
 if(setupTypes.has(type)&&accessToken)return {accessToken};
 const codes=[hash.get('error_code'),search.get('error_code')];
 if(codes.includes('otp_expired')||setupTypes.has(type)||search.has('token_hash'))return {invalid:true};
 return null;
}

export function parseSetupLink(input,projectUrl,siteUrl){
 if(!projectUrl||!siteUrl||input.length>4096)return null;
 try {
  const url=new URL(input.trim());
  if(url.username||url.password||url.protocol!=='https:')return null;
  const route=url.origin+url.pathname;
  if(route===new URL('/auth/v1/verify',projectUrl).href)return tokenProof(url.searchParams,'token');
  const site=new URL(siteUrl);
  if(route===site.origin+site.pathname)return tokenProof(url.searchParams,'token_hash');
  return null;
 }catch{return null;}
}
