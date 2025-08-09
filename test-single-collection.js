require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 从URL中提取产品slug
function extractProductSlug(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const productsIndex = pathParts.indexOf('products');
    if (productsIndex !== -1 && productsIndex + 1 < pathParts.length) {
      return pathParts[productsIndex + 1];
    }
    return null;
  } catch (error) {
    console.error('Error parsing URL:', url, error);
    return null;
  }
}

// 从文件名中提取集合名
function extractCollectionName(filename) {
  return filename.replace('-urls.json', '');
}

// 读取并解析集合文件
function parseCollectionFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    
    if (!Array.isArray(data)) {
      console.warn(`Invalid data format in ${filePath}`);
      return null;
    }
    
    const language = path.basename(path.dirname(filePath));
    const collectionName = extractCollectionName(path.basename(filePath));
    
    return {
      collectionName,
      language,
      products: data.map(item => ({
        url: item.url,
        slug: extractProductSlug(item.url),
        collection: item.collection,
        language: item.language || language
      })).filter(item => item.slug)
    };
  } catch (error) {
    console.error(`Error parsing file ${filePath}:`, error);
    return null;
  }
}

// 更新产品的集合信息
async function updateProductCollections(productSlug, locale, collectionName) {
  try {
    // 首先获取当前产品的collections字段
    const { data: existingProduct, error: fetchError } = await supabase
      .from('all_products')
      .select('collections')
      .eq('slug', productSlug)
      .eq('locale', locale)
      .single();
    
    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        console.warn(`Product not found: ${productSlug} (${locale})`);
        return false;
      }
      throw fetchError;
    }
    
    // 解析现有的collections数组
    let collections = existingProduct.collections || [];
    if (typeof collections === 'string') {
      collections = JSON.parse(collections);
    }
    
    // 检查集合是否已存在
    if (!collections.includes(collectionName)) {
      collections.push(collectionName);
      
      // 更新数据库
      const { error: updateError } = await supabase
        .from('all_products')
        .update({ collections })
        .eq('slug', productSlug)
        .eq('locale', locale);
      
      if (updateError) {
        throw updateError;
      }
      
      console.log(`✓ Updated ${productSlug} (${locale}) with collection: ${collectionName}`);
      return true;
    } else {
      console.log(`- ${productSlug} (${locale}) already has collection: ${collectionName}`);
      return false;
    }
  } catch (error) {
    console.error(`Error updating product ${productSlug} (${locale}):`, error);
    return false;
  }
}

// 测试单个集合文件
async function testSingleCollection() {
  const testFile = path.join(__dirname, 'data', 'collections', 'en', 'agate-bracelet-urls.json');
  
  console.log(`🧪 Testing single collection: ${path.basename(testFile)}`);
  
  const collectionData = parseCollectionFile(testFile);
  if (!collectionData) {
    console.warn(`Failed to parse collection file: ${testFile}`);
    return;
  }
  
  console.log(`Collection: ${collectionData.collectionName} (${collectionData.language})`);
  console.log(`Products found: ${collectionData.products.length}`);
  
  let updatedCount = 0;
  let skippedCount = 0;
  let notFoundCount = 0;
  
  for (const product of collectionData.products) {
    console.log(`\nProcessing: ${product.slug} (${product.language})`);
    
    // 检查产品是否存在
    const { data: existingProduct, error: fetchError } = await supabase
      .from('all_products')
      .select('id, slug, locale, collections')
      .eq('slug', product.slug)
      .eq('locale', product.language)
      .single();
    
    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        console.log(`❌ Product not found: ${product.slug} (${product.language})`);
        notFoundCount++;
        continue;
      }
      console.error(`Error fetching product: ${fetchError}`);
      continue;
    }
    
    console.log(`Found product: ${existingProduct.slug} (${existingProduct.locale})`);
    console.log(`Current collections: ${JSON.stringify(existingProduct.collections || [])}`);
    
    const success = await updateProductCollections(
      product.slug,
      product.language,
      collectionData.collectionName
    );
    
    if (success) {
      updatedCount++;
    } else {
      skippedCount++;
    }
  }
  
  console.log(`\n📊 Results:`);
  console.log(`- Updated: ${updatedCount}`);
  console.log(`- Skipped: ${skippedCount}`);
  console.log(`- Not found: ${notFoundCount}`);
}

if (require.main === module) {
  testSingleCollection().catch(console.error);
} 