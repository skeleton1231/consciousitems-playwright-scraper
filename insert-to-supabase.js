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

// Helper function to extract price as integer
function extractPrice(priceString) {
  if (!priceString) return 0;
  // Remove currency symbols and convert to integer (in cents)
  const cleanPrice = priceString.replace(/[$,]/g, '');
  const price = parseFloat(cleanPrice);
  return Math.round(price * 100); // Convert to cents
}

// Helper function to clean HTML tags from text
function cleanHtml(text) {
  if (!text) return '';
  return text.trim();
}

// Helper function to get first image URL
function getFirstImageUrl(images) {
  if (!images || images.length === 0) return null;
  return images[0].url.startsWith('//') ? `https:${images[0].url}` : images[0].url;
}

// Helper function to determine category from product data
function determineCategory(product) {
  // You can customize this logic based on your product categorization needs
  const title = product.title?.toLowerCase() || '';
  const description = product.description?.toLowerCase() || '';
  
  if (title.includes('anklet') || description.includes('anklet')) return 'Jewelry';
  if (title.includes('bracelet') || description.includes('bracelet')) return 'Jewelry';
  if (title.includes('necklace') || description.includes('necklace')) return 'Jewelry';
  if (title.includes('ring') || description.includes('ring')) return 'Jewelry';
  if (title.includes('crystal') || description.includes('crystal')) return 'Crystals';
  if (title.includes('candle') || description.includes('candle')) return 'Home & Living';
  if (title.includes('incense') || description.includes('incense')) return 'Home & Living';
  
  return 'Jewelry'; // Default category
}

// Helper function to determine sub-category
function determineSubCategory(product) {
  const title = product.title?.toLowerCase() || '';
  const description = product.description?.toLowerCase() || '';
  
  if (title.includes('anklet') || description.includes('anklet')) return 'Anklets';
  if (title.includes('bracelet') || description.includes('bracelet')) return 'Bracelets';
  if (title.includes('necklace') || description.includes('necklace')) return 'Necklaces';
  if (title.includes('ring') || description.includes('ring')) return 'Rings';
  if (title.includes('crystal') || description.includes('crystal')) return 'Crystal Stones';
  
  return 'Accessories'; // Default sub-category
}

// Function to transform product data to database schema
function transformProductData(product, locale = 'en') {
  const price = extractPrice(product.price);
  
  return {
    slug: product.id,
    name: product.title,
    description: cleanHtml(product.description),
    category: determineCategory(product),
    sub_category: determineSubCategory(product),
    price: price,
    currency: 'USD',
    image_url: getFirstImageUrl(product.images),
    affiliate_url: product.url,
    semantic_keywords: product.features ? cleanHtml(product.features) : null,
    locale: locale,
    features: product.features ? cleanHtml(product.features) : null,
    dimensions: product.dimensions ? cleanHtml(product.dimensions) : null,
    rating: product.rating ? parseFloat(product.rating) : null,
    review_count: product.reviewCount || null
  };
}

// Function to insert a single product
async function insertProduct(productData) {
  try {
    const { data, error } = await supabase
      .from('all_products')
      .upsert([productData], { 
        onConflict: 'slug',
        ignoreDuplicates: false 
      })
      .select();

    if (error) {
      console.error('Error upserting product:', error);
      return false;
    }

    console.log(`✅ Successfully upserted product: ${productData.name}`);
    return true;
  } catch (error) {
    console.error('Error upserting product:', error);
    return false;
  }
}

// Function to process all JSON files in the data directory
async function processAllProducts(locale = 'en') {
  const dataDir = path.join(__dirname, 'data', 'products', locale);
  
  if (!fs.existsSync(dataDir)) {
    console.error(`Error: Directory ${dataDir} does not exist`);
    return;
  }

  const files = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));
  
  if (files.length === 0) {
    console.log(`No JSON files found in the ${locale} directory`);
    return;
  }

  console.log(`Found ${files.length} product files to process in ${locale} locale`);
  
  let successCount = 0;
  let errorCount = 0;

  for (const file of files) {
    try {
      const filePath = path.join(dataDir, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const product = JSON.parse(fileContent);
      
      const transformedData = transformProductData(product, locale);
      const success = await insertProduct(transformedData);
      
      if (success) {
        successCount++;
      } else {
        errorCount++;
      }
      
      // Add a small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`Error processing file ${file}:`, error);
      errorCount++;
    }
  }

  console.log(`\n📊 Summary for ${locale} locale:`);
  console.log(`✅ Successfully inserted: ${successCount} products`);
  console.log(`❌ Failed to insert: ${errorCount} products`);
}

// Function to insert a specific product file
async function insertSpecificProduct(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const product = JSON.parse(fileContent);
    
    const transformedData = transformProductData(product);
    const success = await insertProduct(transformedData);
    
    if (success) {
      console.log('✅ Product inserted successfully');
    } else {
      console.log('❌ Failed to insert product');
    }
  } catch (error) {
    console.error('Error processing product file:', error);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // Check if first argument is a locale (2-3 character code)
    const firstArg = args[0];
    if (firstArg.length <= 3 && /^[a-z]{2,3}$/.test(firstArg)) {
      // Process all products for specific locale
      const locale = firstArg;
      console.log(`Processing all product files for locale: ${locale}`);
      await processAllProducts(locale);
    } else {
      // Insert specific product file
      const filePath = firstArg;
      if (fs.existsSync(filePath)) {
        console.log(`Processing specific file: ${filePath}`);
        await insertSpecificProduct(filePath);
      } else {
        console.error(`File not found: ${filePath}`);
      }
    }
  } else {
    // Process all products with default locale (en)
    console.log('Processing all product files for default locale (en)...');
    await processAllProducts('en');
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  transformProductData,
  insertProduct,
  processAllProducts
}; 