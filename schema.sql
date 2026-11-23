-- Run ONCE in Neon: Console > SQL Editor > paste all > Run
-- (Neon Auth keeps users, passwords and codes in its own "neon_auth" schema automatically.)
create extension if not exists pgcrypto;
create table if not exists app_users(id text primary key, email text, profile jsonb not null default '{}', survey jsonb, created_at timestamptz not null default now(), deleted_at timestamptz);
create table if not exists user_data(user_id text primary key, blob jsonb not null default '{}', updated_at timestamptz not null default now());
create table if not exists media(id uuid primary key default gen_random_uuid(), user_id text, name text, mime text not null, data bytea not null, created_at timestamptz not null default now());
create index if not exists media_user on media(user_id);
create table if not exists support_messages(id bigserial primary key, user_id text, email text not null, kind text, message text not null, created_at timestamptz not null default now());
