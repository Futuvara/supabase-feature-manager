#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

console.log('Testing Prompt Improvement with Production API\n');

const supabaseUrl = 'https://tkuwflfjajejswvliroc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrdXdmbGZqYWplanN3dmxpcm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NzQxNDQsImV4cCI6MjA3ODU1MDE0NH0.0Nf6BQjH9Z2PAcwN--ANEwMxvp8oReKHjO8d8y6Ab08';
const email = 'guy.duncan@futuvara.com';
const password = 'Roccolola2013!';

const API_BASE_URL = 'https://requ.futuvara.com/api';

async function test() {
    // 1. Login to Supabase to get access token
    console.log('Step 1: Logging into Supabase...');
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error || !data.session) {
        console.error('❌ Login failed:', error?.message);
        return;
    }

    const accessToken = data.session.access_token;
    console.log('✅ Login successful');
    console.log('   Access token:', accessToken.substring(0, 30) + '...');
    console.log();

    // 2. Test /prompts/improve endpoint
    console.log('Step 2: Testing /prompts/improve endpoint...');
    console.log('   URL:', `${API_BASE_URL}/prompts/improve`);
    console.log('   Auth: Bearer <supabase_token>');
    console.log();

    try {
        const response = await axios.post(`${API_BASE_URL}/prompts/improve`, {
            input_text: 'Add a login button to the homepage',
            instruction_template: 'Make this more detailed and professional',
            save_to_history: false
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        console.log('✅ Response Status:', response.status);
        console.log('   Response Data:', JSON.stringify(response.data, null, 2));

        if (response.data.success) {
            console.log('\n✅ Prompt Improvement Successful!');
            console.log('   Input:', response.data.data.input_text);
            console.log('   Output:', response.data.data.output_text.substring(0, 150) + '...');
            console.log('   Model:', response.data.data.model_used);
            console.log('   Tokens:', response.data.data.tokens_used);
            console.log('   Time:', response.data.data.processing_time_ms, 'ms');
        } else {
            console.log('⚠️ API returned success=false');
        }

    } catch (error) {
        console.error('❌ Request failed:');
        console.error('   Status:', error.response?.status);
        console.error('   Status Text:', error.response?.statusText);
        console.error('   Error Data:', JSON.stringify(error.response?.data, null, 2));
        console.error('   Message:', error.message);
    }

    // Cleanup
    await supabase.auth.signOut();
}

test().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});