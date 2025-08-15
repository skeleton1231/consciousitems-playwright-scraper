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

// ---------------- Collections helpers (aligned with update-collections-optimized.js) ----------------
// Patterns of collection files we should ignore (price/sale/test buckets etc.)
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

function shouldFilterFile(filename) {
  return PRICE_FILTER_PATTERNS.some((pattern) => pattern.test(filename));
}

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
    return null;
  }
}

function extractCollectionName(filename) {
  return filename.replace('-urls.json', '');
}

// Build a mapping of productSlug -> array of collection names for a given locale
function buildCollectionsMap(locale) {
  const collectionsDir = path.join(__dirname, 'data', 'collections', locale);
  const map = new Map();

  if (!fs.existsSync(collectionsDir)) {
    return map;
  }

  const files = fs
    .readdirSync(collectionsDir)
    .filter((file) => file.endsWith('-urls.json') && !shouldFilterFile(file));

  for (const file of files) {
    const filePath = path.join(collectionsDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      if (!Array.isArray(data)) continue;

      const collectionName = extractCollectionName(path.basename(filePath));

      for (const item of data) {
        const slug = extractProductSlug(item.url);
        if (!slug) continue;
        const itemLanguage = item.language || locale;
        if (itemLanguage !== locale) continue;

        if (!map.has(slug)) map.set(slug, new Set());
        map.get(slug).add(collectionName);
      }
    } catch (_) {
      // Ignore malformed files
      continue;
    }
  }

  // Convert Sets to arrays for easier consumption later
  const result = new Map();
  for (const [slug, set] of map.entries()) {
    result.set(slug, Array.from(set));
  }
  return result;
}

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
  // Remove all HTML tags and decode HTML entities
  return text
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
    .replace(/&amp;/g, '&') // Replace &amp; with &
    .replace(/&lt;/g, '<') // Replace &lt; with <
    .replace(/&gt;/g, '>') // Replace &gt; with >
    .replace(/&quot;/g, '"') // Replace &quot; with "
    .replace(/&#39;/g, "'") // Replace &#39; with '
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim();
}

// Helper function to get first image URL
function getFirstImageUrl(images) {
  if (!images || images.length === 0) return null;
  return images[0].url.startsWith('//') ? `https:${images[0].url}` : images[0].url;
}



// Function to transform product data to database schema
function transformProductData(product, locale = 'en', collectionsMap = null) {
  const price = extractPrice(product.price);
  const slug = product.id;
  const collections = Array.isArray(collectionsMap?.get(slug))
    ? collectionsMap.get(slug)
    : [];
  
  // Handle availability field - convert to boolean
  let availability = false;
  if (product.availability !== null && product.availability !== undefined) {
    if (typeof product.availability === 'boolean') {
      availability = product.availability;
    } else if (typeof product.availability === 'string') {
      const lowerText = product.availability.toLowerCase();
      availability = !(lowerText.includes('out of stock') || lowerText.includes('unavailable') || lowerText.includes('sold out') || lowerText === 'false');
    }
  }
  
  return {
    slug,
    name: product.title,
    description: cleanHtml(product.description),
    category: 'Jewelry', // Default category since it's required
    price: price,
    currency: 'USD',
    image_url: getFirstImageUrl(product.images),
    affiliate_url: product.url,
    locale: locale,
    features: product.features,
    dimensions: product.dimensions,
    rating: product.rating ? parseFloat(product.rating) : null,
    review_count: product.reviewCount || null,
    availability: availability,
    collections: collections,
    clean_description: cleanHtml(product.description),
    clean_features: product.features ? cleanHtml(product.features) : null
  };
}

// Function to insert or update a single product
async function insertProduct(productData) {
  try {
    // First check if product exists
    const { data: existingProduct, error: fetchError } = await supabase
      .from('all_products')
      .select('id')
      .eq('slug', productData.slug)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error checking existing product:', fetchError);
      return false;
    }

    let result;
    if (existingProduct) {
      // Update existing product
      const { data, error } = await supabase
        .from('all_products')
        .update(productData)
        .eq('slug', productData.slug)
        .select();

      if (error) {
        console.error('Error updating product:', error);
        return false;
      }

      console.log(`✅ Successfully updated product: ${productData.name}`);
      result = data;
    } else {
      // Insert new product
      const { data, error } = await supabase
        .from('all_products')
        .insert([productData])
        .select();

      if (error) {
        console.error('Error inserting product:', error);
        return false;
      }

      console.log(`✅ Successfully inserted new product: ${productData.name}`);
      result = data;
    }

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
  const collectionsMap = buildCollectionsMap(locale);
  
  let successCount = 0;
  let errorCount = 0;

  for (const file of files) {
    try {
      const filePath = path.join(dataDir, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const product = JSON.parse(fileContent);
      
      const transformedData = transformProductData(product, locale, collectionsMap);
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
    const localeFromPath = (() => {
      try {
        const parts = filePath.split(path.sep);
        const idx = parts.lastIndexOf('products');
        if (idx !== -1 && idx + 1 < parts.length) return parts[idx + 1];
      } catch (_) {}
      return product.language || 'en';
    })();

    const collectionsMap = buildCollectionsMap(localeFromPath);
    const transformedData = transformProductData(product, localeFromPath, collectionsMap);
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