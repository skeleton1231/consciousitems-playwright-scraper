const Utils = require('./utils');

async function testDelay() {
  console.log('测试延迟功能...');
  
  // 测试固定延迟
  console.log('测试固定延迟 3 秒...');
  const start1 = Date.now();
  await Utils.delay(3000);
  const end1 = Date.now();
  console.log(`实际延迟: ${end1 - start1}ms`);
  
  // 测试随机延迟
  console.log('\n测试随机延迟 (2-5秒)...');
  for (let i = 0; i < 5; i++) {
    const randomDelay = Math.floor(Math.random() * 3000) + 2000; // 2000-5000ms
    console.log(`随机延迟 ${i + 1}: ${randomDelay}ms`);
    
    const start = Date.now();
    await Utils.delay(randomDelay);
    const end = Date.now();
    console.log(`实际延迟: ${end - start}ms`);
  }
  
  console.log('\n延迟测试完成！');
}

testDelay();
