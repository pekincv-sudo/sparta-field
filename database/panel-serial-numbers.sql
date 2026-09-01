alter table public.project_technical
add column if not exists panel_serial_numbers text default '';

alter table public.project_technical
add column if not exists equipment_details jsonb default '{"inverters":[],"batteries":[],"panelGroups":[]}';

alter table public.project_photos
add column if not exists equipment_type text default '',
add column if not exists equipment_id text default '';
