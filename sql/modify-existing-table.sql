-- 方式2：修改现有表
-- 如果表已经存在，使用这些语句添加 slug 字段

-- 1. 添加 slug 字段
alter table public.all_products 
add column slug character varying(100);

-- 2. 创建 slug 索引
create index IF not exists idx_all_products_slug 
on public.all_products using btree (slug) TABLESPACE pg_default;

-- 3. 添加唯一约束（可选，如果需要确保 slug 唯一）
-- alter table public.all_products add constraint all_products_slug_unique unique (slug);

-- 4. 如果需要将 slug 设为 NOT NULL，先填充数据，然后修改约束
-- 例如，可以用产品名称生成 slug：
-- update public.all_products set slug = lower(replace(name, ' ', '-')) where slug is null;
-- alter table public.all_products alter column slug set not null; 