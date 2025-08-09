-- 安全地修改 slug 字段为 NOT NULL UNIQUE
-- 包含检查和错误处理

-- 1. 检查当前 slug 字段的状态
SELECT 
    column_name, 
    is_nullable, 
    data_type,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'all_products' AND column_name = 'slug';

-- 2. 检查是否有 NULL 值的 slug
SELECT COUNT(*) as null_slugs
FROM public.all_products 
WHERE slug IS NULL;

-- 3. 检查是否有重复的 slug（非 NULL）
SELECT slug, COUNT(*) as count
FROM public.all_products 
WHERE slug IS NOT NULL
GROUP BY slug 
HAVING COUNT(*) > 1;

-- 4. 为 NULL slug 记录填充值（使用产品名称生成）
UPDATE public.all_products 
SET slug = lower(replace(replace(name, ' ', '-'), '''', '')) 
WHERE slug IS NULL;

-- 5. 处理可能的重复 slug（添加后缀）
WITH duplicates AS (
    SELECT slug, COUNT(*) as count
    FROM public.all_products 
    WHERE slug IS NOT NULL
    GROUP BY slug 
    HAVING COUNT(*) > 1
)
UPDATE public.all_products 
SET slug = slug || '-' || id::text
WHERE slug IN (SELECT slug FROM duplicates);

-- 6. 添加唯一约束
ALTER TABLE public.all_products 
ADD CONSTRAINT all_products_slug_unique UNIQUE (slug);

-- 7. 修改字段为 NOT NULL
ALTER TABLE public.all_products 
ALTER COLUMN slug SET NOT NULL;

-- 8. 验证最终结果
SELECT 
    column_name, 
    is_nullable, 
    data_type
FROM information_schema.columns 
WHERE table_name = 'all_products' AND column_name = 'slug';

-- 9. 验证没有重复的 slug
SELECT COUNT(*) as total_slugs, COUNT(DISTINCT slug) as unique_slugs
FROM public.all_products; 