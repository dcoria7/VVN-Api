// Real integration, refuses every project except vvn-pruebas; cleans synthetic rows.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const env=parseEnv(readFileSync(new URL('../.env.local',import.meta.url),'utf8'));
const url='https://msfrkqfvdhyjnktwuhzd.supabase.co';
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,url,'Only vvn-pruebas is allowed');
let checks=0;const check=(v,m)=>{assert(v,m);checks++};
const key=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const login=await db.auth.signInWithPassword({email:env.BRAND_OPERATOR_EMAIL,password:env.BRAND_OPERATOR_PASSWORD});assert(!login.error);
const other=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const otherLogin=await other.auth.signInWithPassword({email:env.TEST_OTHER_OPERATOR_EMAIL,password:env.TEST_OTHER_OPERATOR_PASSWORD});assert(!otherLogin.error);
const anon=createClient(url,key,{auth:{persistSession:false}});
const ids=[];const files=[];
const hash=x=>createHash('sha256').update(x).digest('hex');
const token=hash(randomUUID()),device=hash(randomUUID()),invite=hash(randomUUID());
const auth={session_hash:token,device_hash:device};
const rpc=async(op,args={},client=db,brand=env.VVN_BRAND_ID)=>{
 const r=await client.rpc('vvn_owner_api',{p_brand:brand,p_op:op,p_args:args});
 assert(!r.error,`RPC ${op} failed: ${r.error?.code}`);return r.data;
};
async function venue(premium=true){
 const r=await db.from('venues').insert({owner_id:login.data.user.id,name:'Synthetic owner-access integration',type:'both',lat:20.7,lng:-103.4,location_reference:'Synthetic test only',is_premium:premium}).select('id').single();assert(!r.error);ids.push(r.data.id);return r.data.id;
}
try{
 const id=await venue();
 const path=`${env.VVN_BRAND_ID}/owners/${id}/${randomUUID()}.pdf`;
 const signed=await db.storage.from('venue-catalogs').createSignedUploadUrl(path,{upsert:false});
 check(!signed.error&&!!signed.data,`PDF upload authorization: ${signed.error?.statusCode} ${signed.error?.message}`);
 const uploaded=await fetch(signed.data.signedUrl,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:Buffer.from('%PDF-1.4\n%%EOF\n')});
 check(uploaded.ok,`Signed PDF upload returns ${uploaded.status}`);files.push(path);
 const publicUrl=db.storage.from('venue-catalogs').getPublicUrl(path).data.publicUrl;
 const file=await fetch(publicUrl,{headers:{Range:'bytes=0-15'}});
 check(file.ok&&Buffer.from(await file.arrayBuffer()).subarray(0,5).toString()==='%PDF-','Uploaded PDF is readable for verification');
 const foreignUpload=await other.storage.from('venue-catalogs').createSignedUploadUrl(path.replace(/[^/]+$/,`${randomUUID()}.pdf`));
 check(!!foreignUpload.error,'Another brand cannot authorize uploads into this venue');
 const second=await venue();const free=await venue(false);
 check((await rpc('admin_invite',{venue_id:free,invitation_hash:hash('free')})).error==='pro_required','Free cannot link');
 check(!!(await rpc('admin_invite',{venue_id:id,invitation_hash:invite})).expires_at,'Invite created');
 const preview=await rpc('preview',{invitation_hash:invite});check(preview.name==='Synthetic owner-access integration'&&!preview.phone,'Preview is minimal');
 const race=await Promise.all([rpc('claim',{invitation_hash:invite,...auth}),rpc('claim',{invitation_hash:invite,session_hash:hash('loser'),device_hash:hash('loser-device')})]);
 check(race.filter(r=>!r.error).length===1,'Only one concurrent claim wins');
 const winner=race[0].error?{session_hash:hash('loser'),device_hash:hash('loser-device')}:auth;
 check(!(await rpc('claim',{invitation_hash:invite,...winner})).error,'Identical claim is retryable');
 check((await rpc('preview',{invitation_hash:invite})).error==='invitation_unavailable','Used QR cannot preview');
 check((await rpc('admin_invite',{venue_id:id,invitation_hash:hash('replacement')})).error==='already_linked','Must revoke before replacement');
 let doc=await rpc('read',winner);
 check(!('owner_id'in doc.venue)&&!('paid_until'in doc.venue)&&!('bot_phone'in doc.venue),'Private fields excluded');
 const save=async(section,values,item_id,extra={})=>{
  const revision=(await rpc('read',winner)).revision;
  return rpc('save',{...winner,section,values,revision,item_id,request_hash:hash(randomUUID()),...extra});
 };
 check(!(await save('info',{description:'Edited by owner'})).error,'Can edit info');
 check((await save('info',{is_premium:false})).error==='invalid','Cannot set admin-only fields');
 check((await rpc('save',{...winner,section:'info',values:{name:'Stale'},revision:doc.revision,request_hash:hash('conflict')})).error==='conflict','Stale edit rejected');
 doc=await rpc('read',winner);
 const request={...winner,section:'menu',values:{name:'Synthetic menu',price:25},revision:doc.revision,request_hash:hash('retry')};
 check(!(await rpc('save',request)).error,'Can add menu');check(!(await rpc('save',request)).error,'Lost response retry succeeds');
 doc=await rpc('read',winner);check(doc.menu.length===1,'Retry does not duplicate');
 check(!(await save('menu',{price:30},doc.menu[0].id)).error,'Can edit collection');
 check((await save('menu',{name:'Foreign'},randomUUID())).error==='not_found','Cannot edit foreign child');
 for(const section of ['services','promotions','photos']){
  const values=section==='services'?{name:'Synthetic service',price:10}:section==='promotions'?{title:'Synthetic promo',kind:'coupon',code:'TEST'}:{url:'https://example.invalid/synthetic.webp',order:0};
  check(!(await save(section,values)).error,`Can add ${section}`);
 }
 for(let n=1;n<10;n++)assert(!(await save('photos',{url:'https://example.invalid/synthetic.webp',order:n})).error);
 check((await save('photos',{url:'https://example.invalid/overflow.webp',order:10})).error==='photo_limit','Gallery limit is atomic');
 check(!(await save('daily',{daily_text:'Synthetic daily',daily_image_url:null})).error,'Can publish daily');
 check(!!(await rpc('read',winner)).venue.daily_updated_at,'Server sets daily timestamp');
 check(!(await save('daily',{daily_text:null,daily_image_url:null})).error,'Can remove daily');
 doc=await rpc('read',winner);
 check(!(await save('menu',{},doc.menu[0].id,{delete:true})).error,'Can delete own collection item');
 await rpc('admin_invite',{venue_id:second,invitation_hash:hash('second')});
 check((await rpc('claim',{invitation_hash:hash('second'),session_hash:hash('second-token'),device_hash:winner.device_hash})).error==='device_linked','One venue per device');
 const denied=await anon.rpc('vvn_owner_api',{p_brand:env.VVN_BRAND_ID,p_op:'read',p_args:winner});check(!!denied.error,'Anonymous RPC denied');
 check((await rpc('read',winner,other)).error==='unauthorized','Other brand cannot use credentials');
 await rpc('admin_revoke',{venue_id:id});check((await rpc('read',winner)).error==='unauthorized','Revocation is immediate');
 const next={session_hash:hash('next'),device_hash:hash('next-device')};
 await rpc('admin_invite',{venue_id:id,invitation_hash:hash('next-invite')});await rpc('claim',{...next,invitation_hash:hash('next-invite')});
 const expired=await db.from('venues').update({paid_until:'2000-01-01'}).eq('id',id);assert(!expired.error);
 check((await rpc('read',next)).error==='pro_required','Expiry revokes');
 await db.from('venues').update({paid_until:null,is_premium:true}).eq('id',id);
 check((await rpc('read',next)).error==='unauthorized','Renewal cannot restore old access');
 await rpc('admin_invite',{venue_id:id,invitation_hash:hash('cancel')});await rpc('admin_cancel',{venue_id:id});
 check((await rpc('preview',{invitation_hash:hash('cancel')})).error==='unauthorized','Cancelled QR rejected');
 console.log(`Owner access: ${checks} real staging checks passed.`);
}finally{
 if(files.length){const removed=await db.storage.from('venue-catalogs').remove(files);assert(!removed.error,'Storage cleanup failed')}
 for(const id of ids){const r=await db.from('venues').delete().eq('id',id);assert(!r.error,`Cleanup failed ${r.error?.code}`)}
 await db.auth.signOut();await other.auth.signOut();
}
