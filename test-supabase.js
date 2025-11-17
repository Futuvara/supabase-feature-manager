const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://tkuwflfjajejswvliroc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrdXdmbGZqYWplanN3dmxpcm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NzQxNDQsImV4cCI6MjA3ODU1MDE0NH0.0Nf6BQjH9Z2PAcwN--ANEwMxvp8oReKHjO8d8y6Ab08';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testConnection() {
    console.log('Testing Supabase connection...\n');

    // Test fetching projects
    console.log('Fetching projects...');
    const { data: projects, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .limit(1);

    if (projectError) {
        console.error('Error fetching projects:', projectError.message);
    } else if (projects && projects.length > 0) {
        console.log('Project columns:', Object.keys(projects[0]));
        console.log('Sample project:', projects[0]);
    } else {
        console.log('No projects found');
    }

    console.log('\n---\n');

    // Test fetching features
    console.log('Fetching features...');
    const { data: features, error: featureError } = await supabase
        .from('features')
        .select('*')
        .limit(1);

    if (featureError) {
        console.error('Error fetching features:', featureError.message);
    } else if (features && features.length > 0) {
        console.log('Feature columns:', Object.keys(features[0]));
        console.log('Sample feature:', features[0]);
    } else {
        console.log('No features found');
    }

    console.log('\n---\n');

    // List all tables
    console.log('Listing all tables in the database...');
    const { data: tables, error: tableError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public');

    if (tableError) {
        // Try alternative method - query pg_tables
        const { data: pgTables, error: pgError } = await supabase
            .from('pg_tables')
            .select('tablename')
            .eq('schemaname', 'public');

        if (pgError) {
            console.error('Could not list tables');
        } else if (pgTables) {
            console.log('Available tables:', pgTables.map(t => t.tablename));
        }
    } else if (tables) {
        console.log('Available tables:', tables.map(t => t.table_name));
    }
}

testConnection().then(() => {
    console.log('\nTest complete!');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});