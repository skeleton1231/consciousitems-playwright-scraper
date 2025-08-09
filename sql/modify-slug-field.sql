-- 修改 slug 字段为 NOT NULL UNIQUE
-- 适用于已存在的表结构

-- 1. 首先为现有的 NULL slug 记录填充值（如果需要）
-- 这里用产品名称生成 slug，您可以根据需要修改
UPDATE public.all_products 
SET slug = lower(replace(name, ' ', '-')) 
WHERE slug IS NULL;

-- 2. 添加唯一约束
ALTER TABLE public.all_products 
ADD CONSTRAINT all_products_slug_unique UNIQUE (slug);

-- 3. 修改字段为 NOT NULL
ALTER TABLE public.all_products 
ALTER COLUMN slug SET NOT NULL;

-- 4. 验证修改结果
-- SELECT column_name, is_nullable, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'all_products' AND column_name = 'slug'; 