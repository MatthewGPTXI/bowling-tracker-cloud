const enc=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
let cachedToken=null;
export async function googleToken(env) {
 if(cachedToken?.email===env.GOOGLE_CLIENT_EMAIL && cachedToken.expires>Date.now()+60000)return cachedToken.token;
 if(!env.GOOGLE_PRIVATE_KEY || !env.GOOGLE_CLIENT_EMAIL)throw new Error('Firebase service credentials are not configured.');
 const now=Math.floor(Date.now()/1000);
 const header=b64(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
 const payload=b64(enc.encode(JSON.stringify({iss:env.GOOGLE_CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})));
 const pem=env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
 const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const unsigned=header+'.'+payload,signature=b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(unsigned)));
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Firebase service authentication failed. Check the Worker secrets.');
 const data=await response.json();cachedToken={email:env.GOOGLE_CLIENT_EMAIL,token:data.access_token,expires:Date.now()+Number(data.expires_in)*1000};return cachedToken.token;
}
export function decodeValue(v) {
 if('nullValue'in v)return null;if('stringValue'in v)return v.stringValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('booleanValue'in v)return v.booleanValue;
 if(v.arrayValue)return (v.arrayValue.values||[]).map(decodeValue);if(v.mapValue)return decodeFields(v.mapValue.fields||{});return null;
}
export const decodeFields=fields=>Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,decodeValue(value)]));
const pathOf=segments=>segments.map(s=>encodeURIComponent(s)).join('/');
async function firestore(env,segments,query='') {
 const token=await googleToken(env),url=`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${pathOf(segments)}${query}`;
 const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
 if(response.status===404)return null;if(!response.ok)throw new Error('Firebase read failed. Check permissions or daily quota.');return response.json();
}
export async function document(env,...segments) {const data=await firestore(env,segments);return data?decodeFields(data.fields||{}):null;}
export async function collection(env,segments,max=2000) {
 const output=[];let page='';
 do{
  const query=new URLSearchParams({pageSize:String(Math.min(500,max)),...(page?{pageToken:page}:{})});
  if(segments.at(-1)==='games')for(const field of ['id','date','score','sessionName','sessionType','ball','openFrames','strikes','strikeOpportunities','createdAt','updatedAt','gameOrder','deleted'])query.append('mask.fieldPaths',field);
  const data=await firestore(env,segments,'?'+query);for(const row of data?.documents||[])output.push({...decodeFields(row.fields||{}),_docId:row.name.split('/').at(-1)});
  page=data?.nextPageToken||'';if(page && output.length>=max)throw new Error(`This history exceeds the bot's ${max}-record limit. Use the app for this account.`);
 }while(page);return output;
}
export async function firebaseUser(request,env) {
 const token=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];if(!token)throw new Error('Please sign in to the bowling app.');
 const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Please sign in again to connect Discord.');const data=await response.json(),user=data.users?.[0];
 if(!user?.localId || user.disabled)throw new Error('This bowling account is unavailable.');return user.localId;
}
export async function activeUsers(env,uids) {
 if(!uids.length)return new Set();
 const token=await googleToken(env);const response=await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:lookup`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({localId:uids}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Could not verify bowling accounts. Check the service account’s Firebase Authentication Viewer role.');
 const data=await response.json();return new Set((data.users||[]).filter(u=>!u.disabled).map(u=>u.localId));
}
export async function gamesDuring(env,uid,from,through) {
 const token=await googleToken(env);
 const fields=['id','date','score','sessionName','sessionType','ball','openFrames','strikes','strikeOpportunities','createdAt','gameOrder','deleted'];
 const response=await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}:runQuery`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{select:{fields:fields.map(fieldPath=>({fieldPath}))},from:[{collectionId:'games'}],where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'date'},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:from}}},{fieldFilter:{field:{fieldPath:'date'},op:'LESS_THAN_OR_EQUAL',value:{stringValue:through}}}]}},limit:501}}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error('Could not read the weekly bowling history.');const rows=(await response.json()).filter(r=>r.document).map(r=>decodeFields(r.document.fields||{}));
 if(rows.length>500)throw new Error('A player has over 500 games in this week; use the app for this recap.');return rows.filter(g=>!g.deleted);
}
