require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCollectionsStatus() {
  console.log('🔍 Checking collections field status...\n');
  
  try {
    // 检查总产品数量
    const { data: totalProducts, error: totalError } = await supabase
      .from('all_products')
      .select('id', { count: 'exact' });
    
    if (totalError) throw totalError;
    
    console.log(`Total products: ${totalProducts.length}`);
    
    // 检查有collections字段的产品数量
    const { data: productsWithCollections, error: collectionsError } = await supabase
      .from('all_products')
      .select('id, slug, locale, collections')
      .not('collections', 'is', null);
    
    if (collectionsError) throw collectionsError;
    
    console.log(`Products with collections field: ${productsWithCollections.length}`);
    
    // 检查collections字段不为空的产品数量
    const productsWithNonEmptyCollections = productsWithCollections.filter(p => 
      p.collections && Array.isArray(p.collections) && p.collections.length > 0
    );
    
    console.log(`Products with non-empty collections: ${productsWithNonEmptyCollections.length}`);
    
    // 显示一些示例
    if (productsWithNonEmptyCollections.length > 0) {
      console.log('\nSample products with collections:');
      productsWithNonEmptyCollections.slice(0, 5).forEach(product => {
        console.log(`- ${product.slug} (${product.locale}): [${product.collections.join(', ')}]`);
      });
    }
    
    // 检查没有collections字段的产品
    const { data: productsWithoutCollections, error: noCollectionsError } = await supabase
      .from('all_products')
      .select('id, slug, locale')
      .or('collections.is.null,collections.eq.[]');
    
    if (noCollectionsError) throw noCollectionsError;
    
    console.log(`\nProducts without collections: ${productsWithoutCollections.length}`);
    
    if (productsWithoutCollections.length > 0) {
      console.log('\nSample products without collections:');
      productsWithoutCollections.slice(0, 5).forEach(product => {
        console.log(`- ${product.slug} (${product.locale})`);
      });
    }
    
    // 统计不同语言的collections状态
    const languageStats = {};
    productsWithNonEmptyCollections.forEach(product => {
      const lang = product.locale || 'unknown';
      languageStats[lang] = (languageStats[lang] || 0) + 1;
    });
    
    console.log('\nCollections by language:');
    Object.entries(languageStats).forEach(([lang, count]) => {
      console.log(`- ${lang}: ${count} products`);
    });
    
  } catch (error) {
    console.error('Error checking collections status:', error);
  }
}

if (require.main === module) {
  checkCollectionsStatus().catch(console.error);
} 