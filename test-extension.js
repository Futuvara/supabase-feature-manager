#!/usr/bin/env node

// Test script to verify extension can be loaded
const path = require('path');

console.log('Testing Supabase Feature Manager Extension...\n');

// Check if the compiled output exists
const fs = require('fs');
const extensionPath = path.join(__dirname, 'out', 'extension.js');

if (!fs.existsSync(extensionPath)) {
    console.error('❌ Extension not compiled. Run: npm run compile');
    process.exit(1);
}

console.log('✅ Extension compiled at:', extensionPath);

// Check if all required files exist
const requiredFiles = [
    'out/extension.js',
    'out/enhancedSidebarProvider.js',
    'out/supabaseService.js',
    'out/authWebview.js',
    'out/promptApiClient.js',
    'package.json',
    'media/database-icon.svg'
];

let allFilesExist = true;
requiredFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        console.log(`✅ ${file}`);
    } else {
        console.error(`❌ Missing: ${file}`);
        allFilesExist = false;
    }
});

if (!allFilesExist) {
    console.error('\n❌ Some required files are missing');
    process.exit(1);
}

// Check if dependencies are installed
const packageJson = require('./package.json');
const dependencies = Object.keys(packageJson.dependencies || {});

console.log('\n📦 Checking dependencies...');
dependencies.forEach(dep => {
    const depPath = path.join(__dirname, 'node_modules', dep);
    if (fs.existsSync(depPath)) {
        console.log(`✅ ${dep}`);
    } else {
        console.error(`❌ Missing dependency: ${dep}`);
        allFilesExist = false;
    }
});

// Try to load the extension
try {
    const extension = require('./out/extension');
    console.log('\n✅ Extension can be loaded');
    console.log('   activate:', typeof extension.activate);
    console.log('   deactivate:', typeof extension.deactivate);
} catch (error) {
    console.error('\n❌ Failed to load extension:', error.message);
    process.exit(1);
}

console.log('\n✅ All checks passed!');
console.log('\nTo debug the extension:');
console.log('1. Open this folder in VS Code');
console.log('2. Press F5 to launch the debugger');
console.log('3. In the new VS Code window, click the database icon in the sidebar');