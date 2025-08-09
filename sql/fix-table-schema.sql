-- 修复表结构：将 slug 字段设为 NOT NULL 并添加唯一约束

-- 1. 如果表已存在，先删除旧表（如果数据不重要）
-- DROP TABLE IF EXISTS public.all_products;

-- 2. 创建正确的表结构
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

-- 3. 创建索引
create index IF not exists idx_all_products_slug on public.all_products using btree (slug) TABLESPACE pg_default;
create index IF not exists idx_all_products_category on public.all_products using btree (category) TABLESPACE pg_default;
create index IF not exists idx_all_products_embedding on public.all_products using ivfflat (embedding vector_cosine_ops) TABLESPACE pg_default; 