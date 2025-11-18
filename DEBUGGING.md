# Debugging Guide for Supabase Feature Manager

## Quick Start Debugging

### Method 1: Using VS Code Debugger (Recommended)

1. **Open the project in VS Code:**
   ```bash
   cd /Users/guyduncan/my-first-vscode-extension
   code .
   ```

2. **Start the TypeScript compiler in watch mode:**
   - Open Terminal in VS Code (View → Terminal)
   - Run: `npm run watch`
   - Keep this terminal open

3. **Launch the debugger:**
   - Press `F5` (or Run → Start Debugging)
   - This will open a new VS Code window titled "[Extension Development Host]"
   - The extension will be loaded in this new window

4. **Test the extension:**
   - In the new VS Code window, look for the database icon in the Activity Bar (left sidebar)
   - Click on it to activate the extension
   - You should see either a login screen or the Feature/Prompt tabs

### Method 2: Command Line Launch

1. **Ensure TypeScript is compiled:**
   ```bash
   npm run compile
   ```

2. **Start watch mode in background:**
   ```bash
   npm run watch &
   ```

3. **Launch VS Code with extension:**
   ```bash
   /Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code \
     --new-window \
     --extensionDevelopmentPath=/Users/guyduncan/my-first-vscode-extension \
     --log trace
   ```

## Setting Breakpoints

1. **In the main VS Code window (not the Extension Development Host):**
   - Open any TypeScript file in `src/` folder
   - Click in the gutter to the left of line numbers to set breakpoints
   - Common files to debug:
     - `src/extension.ts` - Main activation logic
     - `src/enhancedSidebarProvider.ts` - UI logic
     - `src/supabaseService.ts` - Database connections
     - `src/authWebview.ts` - Login flow

2. **Breakpoints will be hit when:**
   - The extension activates (clicking the sidebar icon)
   - User interactions occur (clicking buttons, entering data)
   - API calls are made

## Viewing Debug Output

### Console Logs
- In the Extension Development Host window
- Open: Help → Toggle Developer Tools
- Go to Console tab
- Filter by "extension" to see your logs

### Extension Host Output
- In the Extension Development Host window
- View → Output
- Select "Extension Host" from dropdown
- Shows all console.log() statements from your extension

### Trace Logs (detailed)
- Launch with `--log trace` flag
- View → Output
- Select "Log (Extension Host)" from dropdown

## Common Issues and Solutions

### Extension Not Appearing
1. **Check activation events:**
   ```json
   "activationEvents": [
     "onView:supabaseFeatures.enhancedSidebar"
   ]
   ```

2. **Verify icon exists:**
   - Check `media/database-icon.svg` exists
   - Permissions should be readable (644)

3. **Force reload:**
   - In Extension Development Host: Cmd+R (Mac) or Ctrl+R (Windows/Linux)

### Debugger Not Stopping at Breakpoints
1. **Ensure watch mode is running:**
   ```bash
   npm run watch
   ```

2. **Check sourcemaps are enabled in tsconfig.json:**
   ```json
   "sourceMap": true
   ```

3. **Verify outFiles in launch.json:**
   ```json
   "outFiles": ["${workspaceFolder}/out/**/*.js"]
   ```

### Extension Crashes on Load
1. **Check Developer Tools Console:**
   - Help → Toggle Developer Tools → Console
   - Look for red error messages

2. **Check Extension Host Output:**
   - View → Output → Extension Host
   - Look for stack traces

3. **Enable verbose logging:**
   ```typescript
   console.log('Detailed state:', JSON.stringify(state, null, 2));
   ```

## Testing Specific Features

### Test Login Flow
1. Set breakpoint in `src/authWebview.ts` at line with `signIn`
2. Click "Login to Supabase" button
3. Step through authentication process

### Test Database Connection
1. Set breakpoint in `src/supabaseService.ts` at `getProjects()`
2. After login, check if projects load
3. Verify Supabase URL and credentials

### Test API Integration
1. Set breakpoint in `src/promptApiClient.ts`
2. Switch to Prompt tab
3. Verify API calls and responses

## Debug Commands

Add these to your code for debugging:

```typescript
// Log current state
console.log('Extension activated at:', new Date().toISOString());
console.log('Context:', context.extensionPath);

// Check if running in debug mode
const isDebugMode = process.env.VSCODE_DEBUG_MODE === 'true';
if (isDebugMode) {
    console.log('Running in debug mode');
}

// Log all commands
vscode.commands.getCommands().then(commands => {
    console.log('Available commands:', commands.filter(c => c.includes('my-first')));
});

// Log when view becomes visible
if (this._view) {
    console.log('View is visible:', this._view.visible);
}
```

## Production vs Development

### Development (Debugging)
- Uses source files from `src/`
- Sourcemaps enabled for breakpoints
- Console logs visible
- Hot reload with watch mode

### Production (Installed VSIX)
- Uses compiled files from `out/`
- Minified and optimized
- Limited console output
- No sourcemaps

## Quick Debug Checklist

- [ ] TypeScript compiled (`npm run compile`)
- [ ] Watch mode running (`npm run watch`)
- [ ] VS Code restarted after changes
- [ ] Extension appears in sidebar
- [ ] Console checked for errors
- [ ] Breakpoints set in TypeScript files (not JavaScript)
- [ ] Using F5 to launch debugger (not manual installation)