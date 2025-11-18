#!/usr/bin/env node

const axios = require('axios');

console.log('='.repeat(60));
console.log('Testing Production Requirements Management API');
console.log('='.repeat(60));
console.log();

const API_BASE_URL = 'https://requ.futuvara.com/api/v1';
const API_TOKEN = 'rqm_d5dd70ea4acd27322ec99cf9f05042a8f03cc152da20f122ad8af69337440167';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`
    },
    timeout: 15000
});

async function testAPI() {
    console.log('API Base URL:', API_BASE_URL);
    console.log('Token:', API_TOKEN.substring(0, 20) + '...');
    console.log();

    // Test 1: Fetch Instruction Templates
    console.log('📋 Test 1: Fetching Instruction Templates');
    console.log('-'.repeat(60));
    try {
        const response = await api.get('/templates/instructions');
        console.log('✅ Status:', response.status);
        console.log('Response:', JSON.stringify(response.data, null, 2));

        if (response.data && response.data.success) {
            const templates = response.data.data || [];
            console.log(`✅ Found ${templates.length} instruction template(s)`);
            templates.forEach(t => console.log(`   - ${t.name}`));
        } else {
            console.log('⚠️ No templates in response');
        }
    } catch (error) {
        console.error('❌ Failed:', error.response?.status, error.response?.data || error.message);
    }
    console.log();

    // Test 2: Fetch Prompt Templates
    console.log('📋 Test 2: Fetching Prompt Templates');
    console.log('-'.repeat(60));
    try {
        const response = await api.get('/templates/prompts');
        console.log('✅ Status:', response.status);
        console.log('Response:', JSON.stringify(response.data, null, 2));

        if (response.data && response.data.success) {
            const templates = response.data.data || [];
            console.log(`✅ Found ${templates.length} prompt template(s)`);
            templates.forEach(t => console.log(`   - ${t.name}`));
        } else {
            console.log('⚠️ No templates in response');
        }
    } catch (error) {
        console.error('❌ Failed:', error.response?.status, error.response?.data || error.message);
    }
    console.log();

    // Test 3: Fetch Projects
    console.log('📋 Test 3: Fetching Projects');
    console.log('-'.repeat(60));
    try {
        const response = await api.get('/projects');
        console.log('✅ Status:', response.status);
        console.log('Response:', JSON.stringify(response.data, null, 2));

        if (response.data && response.data.success) {
            const projects = response.data.data || [];
            console.log(`✅ Found ${projects.length} project(s)`);
            projects.forEach(p => console.log(`   - ${p.name} (${p.id})`));
        } else {
            console.log('⚠️ No projects in response');
        }
    } catch (error) {
        console.error('❌ Failed:', error.response?.status, error.response?.data || error.message);
    }
    console.log();

    // Test 4: Improve Prompt
    console.log('📋 Test 4: Testing Prompt Improvement');
    console.log('-'.repeat(60));
    try {
        const response = await api.post('/prompts/improve', {
            input_text: 'Add a login button',
            instruction_template: 'Make this more detailed',
            save_to_history: false
        });
        console.log('✅ Status:', response.status);
        console.log('Response:', JSON.stringify(response.data, null, 2));

        if (response.data && response.data.success) {
            console.log('✅ Prompt improvement successful!');
            console.log('Input:', response.data.data.input_text);
            console.log('Output:', response.data.data.output_text.substring(0, 100) + '...');
        } else {
            console.log('⚠️ Improvement failed');
        }
    } catch (error) {
        console.error('❌ Failed:', error.response?.status, error.response?.data || error.message);
    }
    console.log();

    console.log('='.repeat(60));
    console.log('API Test Complete');
    console.log('='.repeat(60));
}

testAPI().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});