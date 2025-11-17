# Installation and Troubleshooting Guide

## Installation Steps

### Method 1: Install from VSIX file
1. Download `supabase-feature-manager-1.0.0.vsix`
2. Open VS Code
3. Open Command Palette (Cmd+Shift+P on Mac, Ctrl+Shift+P on Windows/Linux)
4. Type "Extensions: Install from VSIX..."
5. Select the downloaded VSIX file
6. Reload VS Code when prompted

### Method 2: Install via command line
```bash
code --install-extension supabase-feature-manager-1.0.0.vsix
```

## Activation

The extension will activate when you:
1. Click on the Supabase Features icon in the Activity Bar (left sidebar)
2. The icon looks like a database

## Troubleshooting

### Extension not showing in Activity Bar
1. Make sure VS Code version is 1.74.0 or higher
2. Check View → Extensions to see if it's installed
3. Try reloading VS Code (Cmd+R or Ctrl+R in the window)

### Extension installed but not working
1. Open Command Palette (Cmd+Shift+P)
2. Run "Developer: Reload Window"
3. Check the Output panel (View → Output)
4. Select "Extension Host" from the dropdown to see any errors

### "Nothing" appears when clicking the icon
1. The extension needs to connect to Supabase
2. Click "Login to Supabase" when it appears
3. Enter your Supabase credentials

### Dependencies issues
1. The VSIX package includes all necessary dependencies
2. If you're building from source:
   ```bash
   npm install
   npm run compile
   ```

### Manual activation
If the extension doesn't activate automatically:
1. Open Command Palette (Cmd+Shift+P)
2. Type "Supabase: Login"
3. This will force the extension to activate

## Required Configuration

### Supabase Database
Your Supabase database needs these tables:

```sql
-- Projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT
);

-- Features table
CREATE TABLE features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT, -- This contains the actual prompt/instruction
    is_used BOOLEAN DEFAULT false,
    auto_generated_name TEXT
);
```

### API Token (Optional)
For AI-powered prompt improvements:
1. Click on the Prompt tab
2. Click "Configure now" in the warning message
3. Enter your Requirements Management API token

## Verification

To verify the extension is working:
1. Open VS Code
2. Click on the database icon in the Activity Bar
3. You should see either:
   - A login button (if not logged in)
   - Two tabs: "Feature" and "Prompt" (if logged in)

## Getting Help

If you're still having issues:
1. Check the extension logs:
   - View → Output → Extension Host
2. Check for JavaScript errors:
   - Help → Toggle Developer Tools → Console
3. Report issues at: https://github.com/Futuvara/supabase-feature-manager/issues