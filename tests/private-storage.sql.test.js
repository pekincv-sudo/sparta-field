"use strict";
// Optional real PostgreSQL-compatible migration validation. Runtime dependency
// is supplied by the release environment; it is never shipped to browsers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runPrivateStorageSqlTests(PGlite, projectDirectory = path.resolve(__dirname, "..")) {
  const db = new PGlite();
  let passed = 0;
  const ids = { owner: "11111111-1111-4111-8111-111111111111", other: "22222222-2222-4222-8222-222222222222", viewer: "33333333-3333-4333-8333-333333333333", company: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", second: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", project: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", secondProject: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth; create schema storage;
      create type public.member_role as enum ('owner','admin','engineer','brigadier','installer','warehouse','viewer');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.company_members(company_id uuid, user_id uuid, role public.member_role, is_active boolean default true);
      create function public.is_company_member(company uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.company_members where company_id=company and user_id=auth.uid() and is_active)$$;
      create function public.has_company_role(company uuid, roles public.member_role[]) returns boolean language sql stable security definer as $$select exists(select 1 from public.company_members where company_id=company and user_id=auth.uid() and is_active and role=any(roles))$$;
      create table public.projects(id uuid primary key, company_id uuid not null);
      create table public.project_photos(id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id), category text, caption text, file_name text, storage_path text not null, created_by uuid, created_at timestamptz default now());
      create table public.project_files(id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id), category text, note text, file_name text, mime_type text, file_size bigint, storage_path text not null, created_by uuid, created_at timestamptz default now());
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security; alter table public.project_photos enable row level security; alter table public.project_files enable row level security;
      create policy "old broad storage" on storage.objects for all to authenticated using(true) with check(true);
      create policy "old broad photos" on public.project_photos for all to authenticated using(true) with check(true);
      create policy "old broad files" on public.project_files for all to authenticated using(true) with check(true);
      grant usage on schema public, storage, auth to authenticated, anon;
      grant select on public.projects to authenticated, anon;
      grant select,insert,update,delete on storage.objects,public.project_photos,public.project_files to authenticated,anon;
      insert into public.company_members values('${ids.company}','${ids.owner}','owner',true),('${ids.second}','${ids.other}','owner',true),('${ids.company}','${ids.viewer}','viewer',true);
      insert into public.projects values('${ids.project}','${ids.company}'),('${ids.secondProject}','${ids.second}');
      insert into public.project_photos(project_id,storage_path,file_name) values('${ids.project}','legacy/own.jpg','own.jpg'),('${ids.secondProject}','legacy/foreign.jpg','foreign.jpg');
      insert into storage.objects(bucket_id,name) values('project-photos','${ids.company}/p/a.jpg'),('project-photos','${ids.second}/p/b.jpg'),('project-photos','legacy/own.jpg'),('project-photos','legacy/foreign.jpg');
    `);
    const migration = fs.readFileSync(path.join(projectDirectory, "database/private-storage.sql"), "utf8");
    await db.exec(migration); await db.exec(migration); passed += 1;
    assert.equal((await db.query("select count(*)::int as count from storage.buckets where public")).rows[0].count, 0); passed += 1;
    const login = async (user) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]); await db.exec("set role authenticated"); };
    await login(ids.owner);
    assert.deepEqual((await db.query("select name from storage.objects order by name")).rows.map((row) => row.name), [`${ids.company}/p/a.jpg`, "legacy/own.jpg"].sort()); passed += 1;
    await assert.rejects(db.query("insert into public.project_photos(project_id,storage_path) values($1,'legacy/foreign.jpg')",[ids.project]), /row-level security/); passed += 1;
    await login(ids.viewer);
    assert.equal((await db.query("select count(*)::int as count from storage.objects")).rows[0].count, 2);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('project-files',$1)",[`${ids.company}/p/no.pdf`]), /row-level security/);
    assert.equal((await db.query("delete from storage.objects returning id")).rows.length,0); passed += 1;
    await login(ids.owner);
    const photo = { category: "Монтаж", caption: "Монтаж фото", file_name: "photo.jpg", storage_path: `${ids.company}/p/new.jpg`, app_data: { stage: "installation", crmTaskId: "task-1" } };
    const file = { category: "receipt", file_name: "receipt.pdf", storage_path: `${ids.company}/p/receipt.pdf`, file_size: 150, app_data: { cashEntryId: "cash-1", documentNumber: "D-1" } };
    const save = (revision, photos = [photo], files = [file], project = ids.project) => db.query("select public.replace_project_media($1,$2,$3::jsonb,$4::jsonb) as revision", [project,revision,JSON.stringify(photos),JSON.stringify(files)]);
    assert.equal((await save(0)).rows[0].revision,1); passed += 1;
    await assert.rejects(save(0,[]), /changed on another device/);
    assert.equal((await db.query("select count(*)::int as count from public.project_photos where project_id=$1",[ids.project])).rows[0].count,1); passed += 1;
    await assert.rejects(save(1,[],[{ ...file,file_size:"invalid" }]), /invalid input syntax/);
    assert.equal((await db.query("select media_revision from public.projects where id=$1",[ids.project])).rows[0].media_revision,1);
    assert.equal((await db.query("select count(*)::int as count from public.project_photos where project_id=$1",[ids.project])).rows[0].count,1); passed += 1;
    await assert.rejects(save(0,[],[],ids.secondProject), /No permission/); passed += 1;
    await assert.rejects(save(1,[{ ...photo,storage_path:`${ids.second}/p/foreign.jpg` }]), /does not belong/); passed += 1;
    const row = (await db.query("select app_data from public.project_files where project_id=$1",[ids.project])).rows[0];
    assert.equal(row.app_data.cashEntryId,"cash-1"); assert.equal(row.app_data.documentNumber,"D-1"); passed += 1;
    await login(ids.viewer); await assert.rejects(save(1), /No permission/); passed += 1;
    return { passed };
  } finally { await db.close(); }
}
module.exports = runPrivateStorageSqlTests;
if (require.main === module) runPrivateStorageSqlTests(require(process.argv[2]).PGlite,process.argv[3]).then(console.log).catch((error) => { console.error(error); process.exitCode = 1; });
