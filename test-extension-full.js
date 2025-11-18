#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

console.log('='.repeat(60));
console.log('Supabase Feature Manager Extension - Full Test Suite');
console.log('='.repeat(60));
console.log();

// Configuration
const supabaseUrl = 'https://tkuwflfjajejswvliroc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrdXdmbGZqYWplanN3dmxpcm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NzQxNDQsImV4cCI6MjA3ODU1MDE0NH0.0Nf6BQjH9Z2PAcwN--ANEwMxvp8oReKHjO8d8y6Ab08';
const testEmail = 'guy.duncan@futuvara.com';
const testPassword = 'Roccolola2013!';

let testsPassed = 0;
let testsFailed = 0;

function logTest(name, passed, details = '') {
    if (passed) {
        console.log(`✅ PASS: ${name}`);
        if (details) console.log(`   ${details}`);
        testsPassed++;
    } else {
        console.log(`❌ FAIL: ${name}`);
        if (details) console.log(`   ${details}`);
        testsFailed++;
    }
}

async function runTests() {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Test 1: Supabase Connection
    console.log('\n📋 Test Suite 1: Supabase Connection');
    console.log('-'.repeat(60));

    try {
        const { data, error } = await supabase.auth.getSession();
        logTest('Supabase client initialization', !error, 'Client created successfully');
    } catch (error) {
        logTest('Supabase client initialization', false, error.message);
    }

    // Test 2: Authentication
    console.log('\n📋 Test Suite 2: Authentication');
    console.log('-'.repeat(60));

    let authData = null;
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: testEmail,
            password: testPassword
        });

        if (error) throw error;

        authData = data;
        logTest('User login', true, `User: ${data.user.email}`);
        logTest('Session creation', !!data.session, `Token present: ${!!data.session?.access_token}`);
        logTest('User ID retrieval', !!data.user.id, `User ID: ${data.user.id}`);
    } catch (error) {
        logTest('User login', false, error.message);
    }

    // Test 3: Projects Retrieval
    console.log('\n📋 Test Suite 3: Projects Management');
    console.log('-'.repeat(60));

    let projects = [];
    try {
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('name');

        if (error) throw error;

        projects = data;
        logTest('Fetch projects', true, `Found ${data.length} project(s)`);

        if (data.length > 0) {
            logTest('Project structure validation',
                data[0].hasOwnProperty('id') &&
                data[0].hasOwnProperty('name'),
                `First project: "${data[0].name}"`
            );

            data.forEach(project => {
                console.log(`   📁 ${project.name} (${project.id})`);
            });
        } else {
            logTest('Projects exist', false, 'No projects found in database');
        }
    } catch (error) {
        logTest('Fetch projects', false, error.message);
    }

    // Test 4: Features Retrieval
    console.log('\n📋 Test Suite 4: Features Management');
    console.log('-'.repeat(60));

    if (projects.length > 0) {
        for (const project of projects) {
            try {
                const { data, error } = await supabase
                    .from('features')
                    .select('*')
                    .eq('project_id', project.id)
                    .order('title');

                if (error) throw error;

                logTest(`Fetch features for "${project.name}"`, true,
                    `Found ${data.length} feature(s)`);

                if (data.length > 0) {
                    logTest(`Feature structure validation for "${project.name}"`,
                        data[0].hasOwnProperty('id') &&
                        data[0].hasOwnProperty('title') &&
                        data[0].hasOwnProperty('description'),
                        `First feature: "${data[0].title}"`
                    );

                    data.forEach(feature => {
                        console.log(`      📄 ${feature.title}`);
                        if (feature.description) {
                            const preview = feature.description.substring(0, 40);
                            console.log(`         ${preview}${feature.description.length > 40 ? '...' : ''}`);
                        }
                    });
                }
            } catch (error) {
                logTest(`Fetch features for "${project.name}"`, false, error.message);
            }
        }
    } else {
        console.log('   ⚠️  Skipping - No projects available');
    }

    // Test 5: Database Schema Validation
    console.log('\n📋 Test Suite 5: Database Schema Validation');
    console.log('-'.repeat(60));

    try {
        // Check if projects table exists and has correct columns
        const { data: projectTest, error: projectError } = await supabase
            .from('projects')
            .select('id, name, description')
            .limit(1);

        logTest('Projects table schema', !projectError,
            'Columns: id, name, description');
    } catch (error) {
        logTest('Projects table schema', false, error.message);
    }

    try {
        // Check if features table exists and has correct columns
        const { data: featureTest, error: featureError } = await supabase
            .from('features')
            .select('id, project_id, title, description, is_used, auto_generated_name')
            .limit(1);

        logTest('Features table schema', !featureError,
            'Columns: id, project_id, title, description, is_used, auto_generated_name');
    } catch (error) {
        logTest('Features table schema', false, error.message);
    }

    // Test 6: Create Test Feature
    console.log('\n📋 Test Suite 6: Feature Creation (CRUD)');
    console.log('-'.repeat(60));

    if (projects.length > 0) {
        const testProject = projects[0];
        const testFeature = {
            project_id: testProject.id,
            title: 'Test Feature - Auto Generated',
            description: 'This is a test feature created by the test suite. It can be safely deleted.',
            is_used: false,
            auto_generated_name: 'test_feature_' + Date.now()
        };

        try {
            // Create feature
            const { data: created, error: createError } = await supabase
                .from('features')
                .insert(testFeature)
                .select();

            if (createError) throw createError;

            logTest('Create test feature', true, `Created: "${created[0].title}"`);

            const createdId = created[0].id;

            // Read feature
            const { data: read, error: readError } = await supabase
                .from('features')
                .select('*')
                .eq('id', createdId)
                .single();

            if (readError) throw readError;

            logTest('Read test feature', true, `Retrieved: "${read.title}"`);

            // Update feature
            const { data: updated, error: updateError } = await supabase
                .from('features')
                .update({ description: 'Updated description - Test complete' })
                .eq('id', createdId)
                .select();

            if (updateError) throw updateError;

            logTest('Update test feature', true, 'Description updated');

            // Delete feature
            const { error: deleteError } = await supabase
                .from('features')
                .delete()
                .eq('id', createdId);

            if (deleteError) throw deleteError;

            logTest('Delete test feature', true, 'Test feature cleaned up');

        } catch (error) {
            logTest('CRUD operations', false, error.message);
        }
    } else {
        console.log('   ⚠️  Skipping - No projects available for testing');
    }

    // Test 7: Logout
    console.log('\n📋 Test Suite 7: Session Management');
    console.log('-'.repeat(60));

    try {
        await supabase.auth.signOut();

        const { data } = await supabase.auth.getSession();
        logTest('User logout', !data.session, 'Session cleared successfully');
    } catch (error) {
        logTest('User logout', false, error.message);
    }

    // Test 8: Extension Files Check
    console.log('\n📋 Test Suite 8: Extension Files');
    console.log('-'.repeat(60));

    const fs = require('fs');
    const path = require('path');

    const requiredFiles = [
        'package.json',
        'out/extension.js',
        'out/enhancedSidebarProvider.js',
        'out/supabaseService.js',
        'out/authWebview.js',
        'out/promptApiClient.js',
        'media/database-icon.svg'
    ];

    requiredFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        const exists = fs.existsSync(filePath);
        logTest(`File exists: ${file}`, exists,
            exists ? `Size: ${fs.statSync(filePath).size} bytes` : 'File not found');
    });

    // Test 9: Package Validation
    console.log('\n📋 Test Suite 9: Package Configuration');
    console.log('-'.repeat(60));

    try {
        const packageJson = require('./package.json');

        logTest('Package name', packageJson.name === 'supabase-feature-manager',
            `Name: ${packageJson.name}`);
        logTest('Package version', !!packageJson.version,
            `Version: ${packageJson.version}`);
        logTest('Main entry point', packageJson.main === './out/extension.js',
            `Main: ${packageJson.main}`);
        logTest('Activation events', Array.isArray(packageJson.activationEvents) &&
            packageJson.activationEvents.length > 0,
            `Events: ${packageJson.activationEvents?.length || 0}`);
        logTest('Dependencies',
            packageJson.dependencies?.['@supabase/supabase-js'] &&
            packageJson.dependencies?.['axios'],
            'Supabase & Axios present');
    } catch (error) {
        logTest('Package.json validation', false, error.message);
    }

    // Final Summary
    console.log('\n' + '='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    console.log(`✅ Tests Passed: ${testsPassed}`);
    console.log(`❌ Tests Failed: ${testsFailed}`);
    console.log(`📊 Total Tests: ${testsPassed + testsFailed}`);
    console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);
    console.log('='.repeat(60));

    if (testsFailed === 0) {
        console.log('\n🎉 All tests passed! Extension is ready to use.');
        console.log('\nNext steps:');
        console.log('1. Press F5 in VS Code to launch the extension');
        console.log('2. Click the database icon in the sidebar');
        console.log('3. Login with your credentials');
        console.log('4. Start managing your features!');
    } else {
        console.log('\n⚠️  Some tests failed. Please review the errors above.');
        process.exit(1);
    }
}

runTests().catch(error => {
    console.error('\n💥 Fatal error running tests:', error);
    process.exit(1);
});