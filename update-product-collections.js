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

// 需要过滤的价格相关文件模式
const PRICE_FILTER_PATTERNS = [
  /0-25-urls\.json$/,
  /25-35-urls\.json$/,
  /35-50-urls\.json$/,
  /50-75-urls\.json$/,
  /70-off-sale-urls\.json$/,
  /75-off-urls\.json$/,
  /under-25-urls\.json$/,
  /under-15-urls\.json$/,
  /under-35-urls\.json$/,
  /sale\d+-urls\.json$/,
  /mom\d+-urls\.json$/,
  /venta-urls\.json$/,
  /promotion-urls\.json$/,
  /promocion-urls\.json$/,
  /bundle-sale-urls\.json$/,
  /last-chance-urls\.json$/,
  /back-soon-urls\.json$/,
  /back-aug.*-urls\.json$/,
  /almost-out-of-stock-urls\.json$/,
  /favorites-under-.*-urls\.json$/,
  /shop-favorites-under-.*-urls\.json$/,
  /black-friday-collection-urls\.json$/,
  /coleccion-del-viernes-negro-urls\.json$/,
  /regalos-.*-urls\.json$/,
  /gifts-.*-urls\.json$/,
  /giveaway-gifts-urls\.json$/,
  /free-items-urls\.json$/,
  /regalo-.*-urls\.json$/,
  /test-urls\.json$/,
  /prueba-urls\.json$/
];

// 检查文件是否应该被过滤
function shouldFilterFile(filename) {
  return PRICE_FILTER_PATTERNS.some(pattern => pattern.test(filename));
}

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
  // 移除 -urls.json 后缀
  return filename.replace('-urls.json', '');
}

// 从文件路径中提取语言
function extractLanguageFromPath(filePath) {
  const pathParts = filePath.split(path.sep);
  const collectionsIndex = pathParts.indexOf('collections');
  if (collectionsIndex !== -1 && collectionsIndex + 1 < pathParts.length) {
    return pathParts[collectionsIndex + 1];
  }
  return 'en'; // 默认语言
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
    
    const language = extractLanguageFromPath(filePath);
    const collectionName = extractCollectionName(path.basename(filePath));
    
    return {
      collectionName,
      language,
      products: data.map(item => ({
        url: item.url,
        slug: extractProductSlug(item.url),
        collection: item.collection,
        language: item.language || language
      })).filter(item => item.slug) // 过滤掉无法提取slug的项目
    };
  } catch (error) {
    console.error(`Error parsing file ${filePath}:`, error);
    return null;
  }
}

// 扫描所有集合文件
function scanCollectionFiles() {
  const collectionsDir = path.join(__dirname, 'data', 'collections');
  const validFiles = [];
  
  if (!fs.existsSync(collectionsDir)) {
    console.error('Collections directory not found:', collectionsDir);
    return validFiles;
  }
  
  const languageDirs = fs.readdirSync(collectionsDir);
  
  for (const langDir of languageDirs) {
    const langPath = path.join(collectionsDir, langDir);
    if (!fs.statSync(langPath).isDirectory()) continue;
    
    const files = fs.readdirSync(langPath);
    
    for (const file of files) {
      if (!shouldFilterFile(file)) {
        const filePath = path.join(langPath, file);
        validFiles.push(filePath);
      }
    }
  }
  
  return validFiles;
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
        return { success: false, reason: 'not_found' };
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
      
      return { success: true, reason: 'updated' };
    } else {
      return { success: false, reason: 'already_exists' };
    }
  } catch (error) {
    console.error(`Error updating product ${productSlug} (${locale}):`, error);
    return { success: false, reason: 'error' };
  }
}

// 处理单个集合文件
async function processCollectionFile(filePath, fileIndex, totalFiles) {
  const fileName = path.basename(filePath);
  console.log(`\n[${fileIndex + 1}/${totalFiles}] Processing: ${fileName}`);
  
  const collectionData = parseCollectionFile(filePath);
  if (!collectionData) {
    console.warn(`Failed to parse collection file: ${filePath}`);
    return { updated: 0, skipped: 0, notFound: 0, errors: 0 };
  }
  
  console.log(`Collection: ${collectionData.collectionName} (${collectionData.language})`);
  console.log(`Products found: ${collectionData.products.length}`);
  
  let updatedCount = 0;
  let skippedCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < collectionData.products.length; i++) {
    const product = collectionData.products[i];
    const result = await updateProductCollections(
      product.slug,
      product.language,
      collectionData.collectionName
    );
    
    switch (result.reason) {
      case 'updated':
        updatedCount++;
        break;
      case 'already_exists':
        skippedCount++;
        break;
      case 'not_found':
        notFoundCount++;
        break;
      case 'error':
        errorCount++;
        break;
    }
  }
  
  console.log(`Results: ${updatedCount} updated, ${skippedCount} skipped, ${notFoundCount} not found, ${errorCount} errors`);
  
  return { updated: updatedCount, skipped: skippedCount, notFound: notFoundCount, errors: errorCount };
}

// 主函数
async function main() {
  console.log('🚀 Starting product collections update...');
  
  // 扫描所有有效的集合文件
  const validFiles = scanCollectionFiles();
  console.log(`Found ${validFiles.length} valid collection files to process`);
  
  if (validFiles.length === 0) {
    console.log('No valid collection files found.');
    return;
  }
  
  // 处理每个文件
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNotFound = 0;
  let totalErrors = 0;
  
  for (let i = 0; i < validFiles.length; i++) {
    try {
      const result = await processCollectionFile(validFiles[i], i, validFiles.length);
      totalUpdated += result.updated;
      totalSkipped += result.skipped;
      totalNotFound += result.notFound;
      totalErrors += result.errors;
    } catch (error) {
      console.error(`Error processing file ${validFiles[i]}:`, error);
      totalErrors++;
    }
  }
  
  console.log('\n✅ Product collections update completed!');
  console.log(`Total files processed: ${validFiles.length}`);
  console.log(`Total products updated: ${totalUpdated}`);
  console.log(`Total products skipped: ${totalSkipped}`);
  console.log(`Total products not found: ${totalNotFound}`);
  console.log(`Total errors: ${totalErrors}`);
}

// 运行脚本
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  scanCollectionFiles,
  processCollectionFile,
  updateProductCollections,
  shouldFilterFile,
  parseCollectionFile
}; 