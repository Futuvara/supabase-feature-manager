#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

console.log('Testing Supabase Login Credentials...\n');

const supabaseUrl = 'https://tkuwflfjajejswvliroc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrdXdmbGZqYWplanN3dmxpcm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NzQxNDQsImV4cCI6MjA3ODU1MDE0NH0.0Nf6BQjH9Z2PAcwN--ANEwMxvp8oReKHjO8d8y6Ab08';

const email = 'guy.duncan@futuvara.com';
const password = 'Roccolola2013!';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testLogin() {
    try {
        console.log('Attempting to sign in with:');
        console.log('Email:', email);
        console.log('Password:', '*'.repeat(password.length));
        console.log();

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.error('❌ Login failed:', error.message);
            console.error('Error details:', error);
            return;
        }

        console.log('✅ Login successful!');
        console.log('\nUser Details:');
        console.log('- ID:', data.user.id);
        console.log('- Email:', data.user.email);
        console.log('- Created:', data.user.created_at);
        console.log();

        // Test fetching projects
        console.log('Fetching projects...');
        const { data: projects, error: projectsError } = await supabase
            .from('projects')
            .select('*')
            .order('name');

        if (projectsError) {
            console.error('❌ Failed to fetch projects:', projectsError.message);
        } else {
            console.log(`✅ Found ${projects.length} project(s):`);
            projects.forEach(project => {
                console.log(`   - ${project.name} (${project.id})`);
            });
        }

        // Test fetching features from first project if available
        if (projects && projects.length > 0) {
            const firstProject = projects[0];
            console.log(`\nFetching features for "${firstProject.name}"...`);

            const { data: features, error: featuresError } = await supabase
                .from('features')
                .select('*')
                .eq('project_id', firstProject.id)
                .order('title');

            if (featuresError) {
                console.error('❌ Failed to fetch features:', featuresError.message);
            } else {
                console.log(`✅ Found ${features.length} feature(s):`);
                features.forEach(feature => {
                    console.log(`   - ${feature.title}`);
                    if (feature.description) {
                        const preview = feature.description.substring(0, 50);
                        console.log(`     Description: ${preview}${feature.description.length > 50 ? '...' : ''}`);
                    }
                });
            }
        }

        // Sign out
        console.log('\nSigning out...');
        await supabase.auth.signOut();
        console.log('✅ Signed out successfully');

    } catch (error) {
        console.error('❌ Unexpected error:', error.message);
        console.error(error);
    }
}

testLogin();