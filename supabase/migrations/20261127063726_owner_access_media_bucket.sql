-- Staging starts without buckets; preserve an existing production bucket unchanged.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('venue-media','venue-media',true,83886080,array['image/jpeg','image/png','image/webp','image/gif','application/pdf']) on conflict(id) do nothing;
create policy owner_media_select on storage.objects for select to authenticated using (
 bucket_id='venue-media' and (storage.foldername(name))[1]='owners' and (storage.foldername(name))[2]=(select private.current_brand_id())::text
);
create policy owner_media_delete on storage.objects for delete to authenticated using (
 bucket_id='venue-media' and (storage.foldername(name))[1]='owners' and (storage.foldername(name))[2]=(select private.current_brand_id())::text
);
