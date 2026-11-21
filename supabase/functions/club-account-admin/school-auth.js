export const SCHOOL_ACCOUNT_DOMAIN='accounts.aimen.invalid';

export function schoolEmail(username){
 if(typeof username!=='string')return null;
 const account=username.trim().toLowerCase();
 return /^[a-z0-9][a-z0-9_-]{1,39}$/.test(account)?account+'@'+SCHOOL_ACCOUNT_DOMAIN:null;
}

export function validSchoolPassword(password){
 return typeof password==='string'&&password.length>=8&&new TextEncoder().encode(password).length<=72
  &&/[a-z]/i.test(password)&&/\d/.test(password);
}

const initialAlphabet='abcdefghjkmnpqrstuvwxyz023456789';
const ISSUED_PASSWORD=/^a7[abcdefghjkmnpqrstuvwxyz023456789]{14}$/;
export const isInitialPassword=password=>ISSUED_PASSWORD.test(password);
export function initialSchoolPassword(){
 const random=crypto.getRandomValues(new Uint8Array(14));
 return 'a7'+Array.from(random,n=>initialAlphabet[n&31]).join('');
}
export const isSchoolAccount=email=>email?.endsWith('@'+SCHOOL_ACCOUNT_DOMAIN)===true;
