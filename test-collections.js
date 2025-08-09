const { scanCollectionFiles, shouldFilterFile, parseCollectionFile } = require('./update-product-collections.js');
const path = require('path');

// 测试文件过滤逻辑
function testFileFiltering() {
  console.log('🧪 Testing file filtering logic...\n');
  
  const testFiles = [
    'agate-bracelet-urls.json',
    'tigers-eye-bracelet-urls.json',
    'under-25-urls.json',
    '25-35-urls.json',
    '70-off-sale-urls.json',
    'sale30-urls.json',
    'promotion-urls.json',
    'test-urls.json',
    'crystals-for-car-protection-urls.json',
    'chakra-healing-crystals-urls.json'
  ];
  
  console.log('File filtering results:');
  testFiles.forEach(filename => {
    const shouldFilter = shouldFilterFile(filename);
    const status = shouldFilter ? '❌ FILTERED' : '✅ KEPT';
    console.log(`${status} ${filename}`);
  });
}

// 测试集合文件解析
function testCollectionParsing() {
  console.log('\n🧪 Testing collection file parsing...\n');
  
  const testFile = path.join(__dirname, 'data', 'collections', 'en', 'agate-bracelet-urls.json');
  
  try {
    const collectionData = parseCollectionFile(testFile);
    if (collectionData) {
      console.log('Collection Data:');
      console.log(`- Collection Name: ${collectionData.collectionName}`);
      console.log(`- Language: ${collectionData.language}`);
      console.log(`- Products Count: ${collectionData.products.length}`);
      console.log('\nSample Products:');
      collectionData.products.slice(0, 3).forEach((product, index) => {
        console.log(`  ${index + 1}. ${product.slug} (${product.language})`);
      });
    } else {
      console.log('❌ Failed to parse collection file');
    }
  } catch (error) {
    console.error('Error testing collection parsing:', error);
  }
}

// 测试文件扫描
function testFileScanning() {
  console.log('\n🧪 Testing file scanning...\n');
  
  const validFiles = scanCollectionFiles();
  console.log(`Found ${validFiles.length} valid collection files`);
  
  if (validFiles.length > 0) {
    console.log('\nSample files:');
    validFiles.slice(0, 10).forEach((filePath, index) => {
      const relativePath = path.relative(__dirname, filePath);
      console.log(`  ${index + 1}. ${relativePath}`);
    });
    
    if (validFiles.length > 10) {
      console.log(`  ... and ${validFiles.length - 10} more files`);
    }
  }
}

// 运行所有测试
function runTests() {
  console.log('🚀 Starting collection processing tests...\n');
  
  testFileFiltering();
  testCollectionParsing();
  testFileScanning();
  
  console.log('\n✅ All tests completed!');
}

if (require.main === module) {
  runTests();
} 