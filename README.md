# Supabase Feature Manager

A powerful VS Code extension for managing and executing project features stored in Supabase, with AI-powered prompt improvements and Claude Code integration.

## Features

### 📊 Dual-Tab Interface
- **Feature Tab**: Browse and execute features from your Supabase database
- **Prompt Tab**: Improve prompts using AI with conversation history

### 🚀 Core Capabilities
- **Supabase Integration**: Connect to your Supabase database to manage projects and features
- **AI-Powered Improvements**: Use the Requirements Management API to enhance prompts
- **Claude Code Integration**: Execute prompts directly with Claude Code CLI
- **Project Management**: Switch between multiple projects seamlessly
- **Template System**: Use instruction and prompt templates for consistent improvements
- **Responsive Design**: Fully responsive interface that adapts to any sidebar size

## Installation

### From VSIX Package
1. Download the `.vsix` file from the releases
2. Open VS Code
3. Go to Extensions view (Ctrl+Shift+X / Cmd+Shift+X)
4. Click on the "..." menu at the top of the Extensions view
5. Select "Install from VSIX..."
6. Choose the downloaded `.vsix` file

### From Source
1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Press F5 in VS Code to run the extension in development mode

## Setup

### 1. Supabase Configuration
The extension connects to a Supabase database with the following schema:

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

### 2. API Token Configuration (Optional)
For AI-powered prompt improvements:
1. Click on the extension icon in the sidebar
2. Switch to the Prompt tab
3. Click "Configure now" in the API token warning
4. Enter your Requirements Management API token (format: `rqm_your_token_here`)

## Usage

### Feature Tab
1. **Login**: Click login to connect to your Supabase account
2. **Select Project**: Choose a project from the dropdown
3. **Browse Features**: Click on any feature to view its prompt
4. **Edit Prompt**: Modify the prompt in the text area
5. **Execute**: Click "Execute on code" to run with Claude Code

### Prompt Tab
1. **Select Project**: Choose a project for context
2. **Choose Templates**: Select instruction and prompt templates
3. **Start Conversation**: Type a message to improve a prompt
4. **Review Output**: See the AI-improved prompt in the output area
5. **Add to Features**: Save improved prompts back to your database
6. **Execute**: Run the improved prompt with Claude Code

## Building from Source

### Prerequisites
- Node.js 16.x or higher
- npm 8.x or higher
- VS Code 1.74.0 or higher

### Build Steps
```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes (development)
npm run watch

# Package as VSIX
npm install -g @vscode/vsce
vsce package
```

## Development

### Project Structure
```
├── src/
│   ├── extension.ts              # Extension entry point
│   ├── enhancedSidebarProvider.ts # Main sidebar UI provider
│   ├── supabaseService.ts        # Supabase integration
│   ├── promptApiClient.ts        # API client for AI features
│   └── authWebview.ts            # Authentication webview
├── out/                          # Compiled JavaScript files
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # This file
```

### Testing
```bash
# Run tests
npm test

# Run in development mode
# Press F5 in VS Code
```

## Configuration

The extension stores credentials securely using VS Code's secrets API:
- Supabase credentials are stored encrypted
- API tokens are stored securely
- No sensitive data is stored in plain text

## Requirements
- VS Code 1.74.0 or higher
- Supabase account and database
- (Optional) Requirements Management API token for AI features
- (Optional) Claude Code CLI for prompt execution

## Known Issues
- API connection requires proper CORS configuration on your API server
- Claude Code CLI must be installed separately for execution features
- Logout functionality requires clearing stored credentials

## Release Notes

### 1.0.0
- Initial release with full feature set
- Dual-tab interface with Feature and Prompt views
- Complete Supabase integration
- AI-powered prompt improvements via API
- Claude Code CLI integration
- Fully responsive design
- Template system for prompts and instructions
- Project-specific context management

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## License
MIT License - see LICENSE file for details

## Support
For issues, questions, or feature requests, please create an issue in the GitHub repository.

## Acknowledgments
- Built with the VS Code Extension API
- Uses Supabase for backend services
- Integrates with Claude Code for AI assistance