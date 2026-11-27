import 'server-only';
import {createHash} from 'node:crypto';
import {createSupabaseAdmin} from '@/lib/supabase-admin';
import {deploymentBrandId} from '@/lib/deployment-brand';
import {deploymentEnvironment} from '@/lib/deployment-environment';
import {secretPattern} from './validation';
export const hashSecret=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function ownerRpc(op:string,args:Record<string,unknown>) {
 const {data,error}=await createSupabaseAdmin().rpc('vvn_owner_api',{p_brand:deploymentBrandId,p_op:op,p_args:args});
 if(error) throw new Error(`Owner database operation failed (${error.code})`);
 return data as Record<string,unknown>;
}
export function credentials(req:Request) {
 const session=req.headers.get('authorization')?.replace(/^Bearer /,'')??'';
 const device=req.headers.get('x-vvn-device')??'';
 if(!secretPattern.test(session)||!secretPattern.test(device)) return null;
 return {session_hash:hashSecret(session),device_hash:hashSecret(device)};
}
export function invitationHash(payload:unknown) {
 if(typeof payload!=='string') return null;
 const parts=payload.split(':');
 if(parts.length!==3||parts[0]!=='vvn-owner'||parts[1]!==deploymentEnvironment||!secretPattern.test(parts[2])) return null;
 return hashSecret(parts[2]);
}
