// Simple test for availability field
function testAvailability() {
  console.log('Testing availability field logic...');
  
  // Test boolean conversion
  const testCases = [
    { input: true, expected: true },
    { input: false, expected: false },
    { input: 'In Stock', expected: true },
    { input: 'Out of Stock', expected: false },
    { input: 'false', expected: false },
    { input: null, expected: false },
    { input: undefined, expected: false }
  ];
  
  testCases.forEach((testCase, index) => {
    let availability = false;
    if (testCase.input !== null && testCase.input !== undefined) {
      if (typeof testCase.input === 'boolean') {
        availability = testCase.input;
      } else if (typeof testCase.input === 'string') {
        const lowerText = testCase.input.toLowerCase();
        availability = !(lowerText.includes('out of stock') || lowerText.includes('unavailable') || lowerText.includes('sold out') || lowerText === 'false');
      }
    }
    
    console.log(`Test ${index + 1}: Input "${testCase.input}" -> Output ${availability} (Expected: ${testCase.expected})`);
  });
  
  console.log('\nTest completed!');
}

testAvailability();
