-- Add availability column to all_products table
-- This column will store boolean values indicating if the product is in stock

-- Add the availability column
ALTER TABLE all_products 
ADD COLUMN availability BOOLEAN DEFAULT false;

-- Add a comment to describe the column
COMMENT ON COLUMN all_products.availability IS 'Boolean indicating if the product is available/in stock (true = in stock, false = out of stock)';

-- Create an index on availability for better query performance
CREATE INDEX idx_all_products_availability ON all_products(availability);

-- Optional: Create a composite index for filtering by availability and locale
CREATE INDEX idx_all_products_availability_locale ON all_products(availability, locale);

-- Optional: Create a composite index for filtering by availability and category
CREATE INDEX idx_all_products_availability_category ON all_products(availability, category);

-- Update existing records to set availability based on existing data (if needed)
-- This is optional and depends on your existing data structure
-- UPDATE all_products SET availability = true WHERE availability IS NULL;

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'all_products' AND column_name = 'availability';
