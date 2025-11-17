# My First VS Code Extension

This is your first VS Code extension following the [official tutorial](https://code.visualstudio.com/api/get-started/your-first-extension).

## Features

This extension contributes the following:

* Command: `Hello World` - Shows a Hello World message

## Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (includes npm)
* [Visual Studio Code](https://code.visualstudio.com/)

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile the extension:
   ```bash
   npm run compile
   ```

### Running the Extension

1. Open this project in VS Code
2. Press `F5` to open a new VS Code window with your extension loaded
3. Run your command from the command palette by pressing (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) and typing `Hello World`

### Development

* Run `npm run watch` to automatically recompile the extension when you make changes
* You can relaunch the extension from the debug toolbar after making changes
* You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load your changes

### Testing

Run the test suite with:
```bash
npm test
```

### Packaging

To package your extension as a `.vsix` file:

1. Install vsce:
   ```bash
   npm install -g @vscode/vsce
   ```

2. Package the extension:
   ```bash
   vsce package
   ```

## Project Structure

```
my-first-extension/
├── .vscode/
│   ├── launch.json       # Launch configurations for debugging
│   ├── settings.json      # Workspace settings
│   └── tasks.json        # Build task definitions
├── src/
│   ├── extension.ts      # Extension entry point
│   └── test/            # Test files
│       ├── runTest.ts
│       └── suite/
│           ├── extension.test.ts
│           └── index.ts
├── .eslintrc.json       # ESLint configuration
├── .gitignore          # Git ignore rules
├── .vscodeignore       # Files to exclude from extension package
├── package.json        # Extension manifest
├── tsconfig.json       # TypeScript configuration
└── README.md          # This file
```

## Next Steps

* [VS Code Extension API](https://code.visualstudio.com/api)
* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
* [Extension Examples](https://github.com/microsoft/vscode-extension-samples)

## License

This project is open source and available under the [MIT License](LICENSE).