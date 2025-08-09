require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verifyUpdate() {
  try {
    const { data, error } = await supabase
      .from('all_products')
      .select('id, slug, locale, collections')
      .eq('slug', 'stability-bracelet')
      .eq('locale', 'en')
      .single();
    
    if (error) {
      console.error('Error:', error);
      return;
    }
    
    console.log('Updated product:', data);
    console.log('Collections:', data.collections);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

verifyUpdate(); 