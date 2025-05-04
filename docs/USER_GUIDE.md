# ExAI: Enhanced Context-Aware Programming Assistant

## User Guide

This guide provides comprehensive information on using the ExAI extension for VS Code, which features the Recursive Chain-of-Thought (CRCT) system for enhanced code understanding and visualization.

## Table of Contents

1. [Installation](#installation)
2. [Getting Started](#getting-started)
3. [Core Features](#core-features)
4. [Dependency Visualization](#dependency-visualization)
5. [Configuration](#configuration)
6. [Command Reference](#command-reference)
7. [Tips and Best Practices](#tips-and-best-practices)
8. [Troubleshooting](#troubleshooting)
9. [FAQ](#faq)

## Installation

### Requirements

- Visual Studio Code version 1.60.0 or higher
- Workspace with file system access (local or remote)
- 4GB+ of RAM recommended for large workspaces

### Installation Steps

1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X or Cmd+Shift+X)
3. Search for "ExAI"
4. Click "Install"
5. Reload VS Code when prompted

Alternatively, you can install from the VSIX file:
1. Download the latest `.vsix` file from the [releases page](https://github.com/organization/exai/releases)
2. In VS Code, go to Extensions view
3. Click the "..." menu at the top and select "Install from VSIX..."
4. Select the downloaded file

## Getting Started

### First-Time Setup

When you first open a workspace with ExAI installed, the extension will:

1. Ask for permission to analyze your workspace
2. Create a `.exai` directory for tracking files (you may want to add this to `.gitignore`)
3. Show the welcome page with quick start information

### Initial Workspace Analysis

To begin using ExAI's features, you need to analyze your workspace:

1. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
2. Type "ExAI: Analyze Workspace" and press Enter
3. Wait for the analysis to complete (progress will be shown in the status bar)

> **Note**: For large workspaces, the initial analysis might take several minutes. Subsequent analyses will be much faster.

## Core Features

### Recursive Chain-of-Thought (CRCT) System

The CRCT system provides structured context management and dependency tracking:

- **Hierarchical Key System**: Each file and directory is assigned a unique key (e.g., "1A", "1Aa1")
- **Dependency Grid**: Tracks relationships between files and directories
- **Tracker Files**: Stores dependency information in readable Markdown format
- **Phase Management**: Controls the system's operational mode (Setup, Strategy, Execution)

### Dependency Tracking

ExAI tracks various types of dependencies:

- **Import Dependencies**: Direct code imports between files
- **Reference Dependencies**: Code references across files
- **Type Dependencies**: Relationships between types defined in different files
- **Inclusion Dependencies**: Files included by others
- **Semantic Dependencies**: Conceptual relationships between components

### File Navigation

ExAI enhances code navigation through dependencies:

1. Right-click on a file in the Explorer
2. Select "ExAI: View Dependencies"
3. Choose a dependency to navigate to that file

## Dependency Visualization

### Dependency Graph

The Dependency Graph provides a visual representation of code dependencies:

1. Run "ExAI: Show Dependency Graph" from the Command Palette
2. The graph will open in a new editor tab
3. Nodes represent files or directories
4. Edges represent dependencies between nodes
5. Colors indicate the type of file and dependency

### Graph Interactions

You can interact with the Dependency Graph in several ways:

- **Click** on a node to select it and see its details
- **Double-click** on a node to focus on its dependencies
- **Drag** nodes to rearrange the graph
- **Scroll** to zoom in and out
- **Hover** over nodes or edges to see details
- **Use the controls** at the top of the graph for additional options

### Graph Controls

The Dependency Graph includes several controls:

- **Zoom In/Out**: Adjust the zoom level
- **Reset View**: Return to the default view
- **Layout**: Choose between different layouts (Force-directed, Circular, Hierarchical, Radial)
- **Search**: Find nodes by name or path
- **Toggle Labels**: Show or hide node labels
- **Toggle Legend**: Show or hide the color legend
- **Export**: Save the graph as an SVG file

### Dependency Explorer

The Dependency Explorer provides a tree view of dependencies:

1. Click the ExAI icon in the Activity Bar
2. The Explorer will show all files with their dependencies
3. Expand files to see their dependencies
4. Click on dependencies to navigate to those files

## Configuration

### Extension Settings

ExAI can be configured through VS Code settings:

1. Open Settings (Ctrl+, or Cmd+,)
2. Search for "ExAI"
3. Adjust settings as needed

Key settings include:

- `exai.crct.autoAnalyze`: Automatically analyze workspace on startup
- `exai.crct.maxDependencies`: Maximum number of dependencies to display in graph
- `exai.crct.excludedDirectories`: Directories to exclude from analysis
- `exai.crct.excludedExtensions`: File extensions to exclude from analysis
- `exai.visualizer.defaultLayout`: Default layout for dependency graph

### Workspace-Specific Configuration

You can create workspace-specific settings in `.vscode/settings.json`:

```json
{
  "exai.crct.excludedDirectories": [
    "node_modules",
    "dist",
    ".git",
    "build"
  ],
  "exai.crct.excludedExtensions": [
    ".png",
    ".jpg",
    ".svg",
    ".min.js"
  ]
}
```

## Command Reference

ExAI adds several commands to VS Code:

| Command | Description | Keyboard Shortcut |
|---------|-------------|------------------|
| `ExAI: Analyze Workspace` | Analyze workspace dependencies | - |
| `ExAI: Show Dependency Graph` | Open the dependency graph visualization | - |
| `ExAI: Generate Keys` | Generate keys for workspace files | - |
| `ExAI: Update Dependency Grid` | Update the dependency grid | - |
| `ExAI: View Dependencies` | View dependencies for selected file | - |
| `ExAI: Generate Mini-Tracker` | Create a mini-tracker for a directory | - |
| `ExAI: Manage Trackers` | Manage tracker files | - |
| `ExAI: Change Phase` | Change the CRCT phase | - |
| `ExAI: Show Help` | Show ExAI help and documentation | - |

> **Tip**: You can assign custom keyboard shortcuts to any of these commands through VS Code's keyboard shortcuts editor.

## Tips and Best Practices

### Optimizing Performance

For large workspaces:

1. Exclude unnecessary directories (node_modules, build output, etc.)
2. Use mini-trackers for focused analysis of specific directories
3. Consider increasing the memory limit for VS Code

### Effective Dependency Management

To get the most out of dependency tracking:

1. Analyze the workspace after significant structural changes
2. Use the Dependency Graph to identify high-coupling areas
3. Explore dependencies when working on unfamiliar code
4. Generate mini-trackers for the areas you're working on

### Tracker Files

Tracker files store dependency information:

- `module_relationship_tracker.md`: Main tracker for high-level dependencies
- `doc_tracker.md`: Tracker for documentation files
- Mini-trackers: Directory-specific trackers (e.g., `frontend_module.md`)

These files are stored in the `.exai` directory and can be viewed directly.

## Troubleshooting

### Common Issues

**Extension doesn't activate**
- Ensure you have VS Code 1.60.0 or higher
- Check the VS Code logs for error messages
- Try reinstalling the extension

**Workspace analysis fails**
- Check if your workspace has unusual file structures
- Ensure you have read/write permissions for the workspace
- Try excluding problematic directories

**Dependency Graph doesn't show all files**
- Increase the `exai.crct.maxDependencies` setting
- Ensure the files aren't in excluded directories
- Check if the files were added after analysis (re-analyze if needed)

**High CPU or memory usage**
- Exclude large directories from analysis
- Reduce the maximum dependencies setting
- Close other extensions while analyzing large workspaces

### Resetting the Extension

If you encounter persistent issues:

1. Close VS Code
2. Delete the `.exai` directory from your workspace
3. Restart VS Code
4. Re-analyze your workspace

### Logs

ExAI logs can help diagnose issues:

1. Open the Output panel (Ctrl+Shift+U or Cmd+Shift+U)
2. Select "ExAI" from the dropdown

## FAQ

**Q: How often should I analyze my workspace?**
A: Analyze after significant structural changes, or when you start working on a new feature that involves multiple files.

**Q: Can I share tracker files with my team?**
A: Yes, tracker files use Markdown format and can be committed to version control for team sharing.

**Q: Does ExAI work with remote repositories?**
A: Yes, ExAI works with any workspace that VS Code can access, including remote repositories.

**Q: How does ExAI handle large monorepos?**
A: ExAI is designed to scale with configurable limits and exclusions. For very large monorepos, consider using mini-trackers for specific areas.

**Q: Can I use ExAI with languages other than TypeScript/JavaScript?**
A: Yes, ExAI works with any text-based files. Dependency detection quality may vary by language, but structural analysis works for all files.

## Getting Help

If you need further assistance:

- Check the [online documentation](https://github.com/organization/exai/wiki)
- Open an issue on [GitHub](https://github.com/organization/exai/issues)
- Join the [Discord community](https://discord.gg/exai)