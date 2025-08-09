-- Supabase Database Schema for Products
-- This includes the slug field to match JSON file IDs

create table public.all_products (
  id uuid not null default gen_random_uuid (),
  slug character varying(100) not null unique,
  name text not null,
  description text not null,
  category character varying(50) not null,
  sub_category character varying(50) null,
  price integer not null,
  currency character varying(3) not null default 'USD'::character varying,
  image_url text null,
  affiliate_url text null,
  embedding public.vector null,
  semantic_keywords text null,
  created_at timestamp without time zone null default now(),
  locale character varying(10) null,
  features text null,
  dimensions text null,
  rating numeric(3, 2) null,
  review_count integer null,
  constraint all_products_pkey primary key (id)
) TABLESPACE pg_default;

-- Indexes for better performance
create index IF not exists idx_all_products_category on public.all_products using btree (category) TABLESPACE pg_default;
create index IF not exists idx_all_products_slug on public.all_products using btree (slug) TABLESPACE pg_default;
create index IF not exists idx_all_products_embedding on public.all_products using ivfflat (embedding vector_cosine_ops) TABLESPACE pg_default;

-- Add unique constraint on slug
alter table public.all_products add constraint all_products_slug_unique unique (slug); 