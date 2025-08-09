-- 添加 collections 字段到 all_products 表
ALTER TABLE public.all_products 
ADD COLUMN IF NOT EXISTS collections jsonb DEFAULT '[]'::jsonb;

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_all_products_collections_gin 
ON public.all_products USING gin (collections);

-- 验证字段已添加
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'all_products' 
AND column_name = 'collections'; 