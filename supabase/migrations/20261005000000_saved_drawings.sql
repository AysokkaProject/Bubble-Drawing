create table if not exists public.bubble_drawing_saved_drawings (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 255),
  storage_path text not null unique,
  annotations jsonb not null default '[]'::jsonb,
  rotations jsonb not null default '{}'::jsonb,
  page_count integer not null check (page_count between 1 and 300),
  marker_count integer not null default 0 check (marker_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bubble_drawing_saved_drawings enable row level security;
grant select, insert, update, delete on public.bubble_drawing_saved_drawings to authenticated;

drop policy if exists "bubble_drawing_own_saved_rows" on public.bubble_drawing_saved_drawings;
create policy "bubble_drawing_own_saved_rows"
  on public.bubble_drawing_saved_drawings
  for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bubble-drawing-private-pdfs', 'bubble-drawing-private-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'bubble-drawing-private-pdfs'
      and public = false
      and file_size_limit = 52428800
      and 'application/pdf' = any(allowed_mime_types)
  ) then
    raise exception 'The bubble-drawing-private-pdfs bucket already exists with incompatible settings.';
  end if;
end $$;

drop policy if exists "bubble_drawing_own_pdf_objects" on storage.objects;
create policy "bubble_drawing_own_pdf_objects"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'bubble-drawing-private-pdfs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'bubble-drawing-private-pdfs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
