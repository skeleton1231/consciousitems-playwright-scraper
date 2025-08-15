const { transformProductData } = require('./insert-to-supabase');

// Test cases for availability field transformation
function testAvailabilityTransform() {
  console.log('=== Testing Availability Field Transformation ===\n');
  
  // Test case 1: Boolean true
  const product1 = {
    id: 'test-product-1',
    title: 'Test Product 1',
    description: 'Test description',
    price: '$29.99',
    images: [{ url: 'https://example.com/image.jpg' }],
    url: 'https://example.com/product',
    availability: true,
    rating: 4.5,
    reviewCount: 10
  };
  
  const result1 = transformProductData(product1);
  console.log('Test 1: Boolean true');
  console.log(`Input: ${product1.availability} (${typeof product1.availability})`);
  console.log(`Output: ${result1.availability} (${typeof result1.availability})`);
  console.log(`Expected: true\n`);
  
  // Test case 2: Boolean false
  const product2 = {
    id: 'test-product-2',
    title: 'Test Product 2',
    description: 'Test description',
    price: '$39.99',
    images: [{ url: 'https://example.com/image.jpg' }],
    url: 'https://example.com/product',
    availability: false,
    rating: 4.0,
    reviewCount: 5
  };
  
  const result2 = transformProductData(product2);
  console.log('Test 2: Boolean false');
  console.log(`Input: ${product2.availability} (${typeof product2.availability})`);
  console.log(`Output: ${result2.availability} (${typeof result2.availability})`);
  console.log(`Expected: false\n`);
  
  // Test case 3: String "In Stock"
  const product3 = {
    id: 'test-product-3',
    title: 'Test Product 3',
    description: 'Test description',
    price: '$49.99',
    images: [{ url: 'https://example.com/image.jpg' }],
    url: 'https://example.com/product',
    availability: 'In Stock',
    rating: 4.8,
    reviewCount: 20
  };
  
  const result3 = transformProductData(product3);
  console.log('Test 3: String "In Stock"');
  console.log(`Input: "${product3.availability}" (${typeof product3.availability})`);
  console.log(`Output: ${result3.availability} (${typeof result3.availability})`);
  console.log(`Expected: true\n`);
  
  // Test case 4: String "Out of Stock"
  const product4 = {
    id: 'test-product-4',
    title: 'Test Product 4',
    description: 'Test description',
    price: '$59.99',
    images: [{ url: 'https://example.com/image.jpg' }],
    url: 'https://example.com/product',
    availability: 'Out of Stock',
    rating: 4.2,
    reviewCount: 15
  };
  
  const result4 = transformProductData(product4);
  console.log('Test 4: String "Out of Stock"');
  console.log(`Input: "${product4.availability}" (${typeof product4.availability})`);
  console.log(`Output: ${result4.availability} (${typeof result4.availability})`);
  console.log(`Expected: false\n`);
  
  // Test case 5: String "false"
  const product5 = {
    id: 'test-product-5',
    title: 'Test Product 5',
    description: 'Test description',
    price: '$69.99',
    images: [{ url: 'https://example.com/image.jpg' }],
    url: 'https://example.com/product',
    availability: 'false',
    rating: 4.6,
    reviewCount: 8
  };
  
  const result5 = transformProductData(product5);
  console.log('Test 5: String "false"');
  console.log(`Input: "${product5.availability}" (${typeof product5.availability})`);
  console.log(`Output: ${result5.availability} (${typeof result5.availability})`);
  console.log(`Expected: false\n`);
  
  // Test case 6: null/undefined
  const product6 = {
    id: 'test-product-6',
    title: 'Test Product 6',
    description: 'Test description',
    price: '$79.99',
    images: [{ url: 'https://example.com/image.jpg' }],
    url: 'https://example.com/product',
    availability: null,
    rating: 4.3,
    reviewCount: 12
  };
  
  const result6 = transformProductData(product6);
  console.log('Test 6: null');
  console.log(`Input: ${product6.availability} (${typeof product6.availability})`);
  console.log(`Output: ${result6.availability} (${typeof result6.availability})`);
  console.log(`Expected: false\n`);
  
  // Test case 7: Real product data from abundance-pens.json
  const realProduct = {
    id: 'abundance-pens',
    title: 'Unlimited Abundance - Manifestation Pen Set',
    description: 'Test description',
    price: '$49.00',
    images: [{ url: 'https://example.com/image.jpg' }],
    url: 'https://consciousitems.com/products/abundance-pens',
    availability: true, // This should be true based on our updated logic
    rating: 4.9,
    reviewCount: 38,
    variants: [
      { available: true },
      { available: false },
      { available: false }
    ]
  };
  
  const realResult = transformProductData(realProduct);
  console.log('Test 7: Real product data (abundance-pens)');
  console.log(`Input: ${realProduct.availability} (${typeof realProduct.availability})`);
  console.log(`Output: ${realResult.availability} (${typeof realResult.availability})`);
  console.log(`Expected: true (because first variant is available)\n`);
  
  console.log('=== All tests completed ===');
}

testAvailabilityTransform();
