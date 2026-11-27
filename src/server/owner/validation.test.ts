import {describe,it,expect} from 'vitest';
import {validateSave} from './validation';
const id='77777777-7777-4777-8777-777777777770',base='https://example.supabase.co';
const save=(section:string,values:Record<string,unknown>,extra={})=>validateSave({section,values,revision:1,...extra},id,base);
describe('owner field authorization and validation',()=>{
 it('rejects every admin control',()=>{for(const key of ['is_premium','paid_until','brand_id','owner_id','plaza_id','bot_phone','is_active'])expect(()=>save('info',{[key]:true})).toThrow()});
 it('accepts owner information',()=>expect(save('info',{name:' Cafe ',tags:['Café']})).toMatchObject({values:{name:'Cafe'}}));
 it('rejects foreign or arbitrary media URLs',()=>{for(const url of ['https://evil.invalid/a.webp',`${base}/storage/v1/object/public/venue-media/owners/77777777-7777-4777-8777-777777777771/77777777-7777-4777-8777-777777777772/77777777-7777-4777-8777-777777777773.webp`])expect(()=>save('branding',{logo_url:url})).toThrow()});
 it('keeps empty menu category compatible with the database',()=>expect(save('menu',{category:null},{item_id:id})).toMatchObject({values:{category:'General'}}));
 it('allows null to remove media',()=>expect(save('branding',{logo_url:null})).toBeTruthy());
 it('rejects invalid coordinates and numeric values',()=>{for(const value of [NaN,Infinity,91,'20.5'])expect(()=>save('location',{lat:value})).toThrow()});
 it('rejects invalid dates and reversed range',()=>{expect(()=>save('promotions',{starts_at:'2026-11-30',ends_at:'2026-11-01'})).toThrow();expect(()=>save('catalog',{catalog_updated_on:'bad'})).toThrow()});
 it('enforces daily text limit',()=>expect(()=>save('daily',{daily_text:'a'.repeat(1001)})).toThrow());
 it('rejects deletes without item id',()=>expect(()=>save('menu',{}, {delete:true})).toThrow());
 it('accepts a complete weekly schedule with split hours',()=>expect(save('hours',{opening_hours:Array.from({length:7},()=>({closed:false,open:'09:00',close:'13:00',intervals:[{open:'09:00',close:'13:00'},{open:'16:00',close:'20:00'}]}))})).toBeTruthy());
 it('rejects malformed and excessive intervals',()=>expect(()=>save('hours',{opening_hours:[{closed:false,open:'25:00',close:'00:00'}]})).toThrow());
});
