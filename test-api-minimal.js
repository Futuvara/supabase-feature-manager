const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

async function test() {
    const supabase = createClient(
        'https://tkuwflfjajejswvliroc.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrdXdmbGZqYWplanN3dmxpcm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NzQxNDQsImV4cCI6MjA3ODU1MDE0NH0.0Nf6BQjH9Z2PAcwN--ANEwMxvp8oReKHjO8d8y6Ab08'
    );

    const { data } = await supabase.auth.signInWithPassword({
        email: 'guy.duncan@futuvara.com',
        password: 'Roccolola2013!'
    });

    const token = data.session.access_token;

    // Test with just text field
    console.log('Testing /api/prompts/improve with Supabase token...\n');

    try {
        const response = await axios.post('https://requ.futuvara.com/api/prompts/improve', {
            text: 'Add a login button'
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ SUCCESS:', response.data);
    } catch (error) {
        console.log('❌ Error:', error.response?.status, error.response?.data);
    }

    await supabase.auth.signOut();
}

test();
