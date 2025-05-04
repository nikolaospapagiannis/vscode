# Recursive Chain-of-Thought System (CRCT) Implementation

## Overview

The Recursive Chain-of-Thought System (CRCT) enhances VS Code's AI capabilities by providing robust context management, dependency tracking, and recursive reasoning. This implementation transforms the original Python-based CRCT system into a TypeScript solution integrated with VS Code's architecture and the Multi-Provider Framework.

## Architecture

The CRCT system consists of several key components:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CRCT System                                   │
├───────────┬───────────────────────────┬─────────────────┬──────────────┤
│           │                           │                 │              │
│  Core     │     Service Layer         │  Integration    │ Visualization│
│Components │                           │  Components     │  & UI        │
│           │                           │                 │              │
├───────────┼───────────────────────────┼─────────────────┼──────────────┤
│KeyManager │                           │                 │ Command      │
│           │                           │                 │ Integration  │
│Dependency │     CRCTService           │ CRCTProvider    │              │
│Grid       │                           │                 │ Status Bar   │
│           │                           │                 │ Integration  │
│TrackerIO  │                           │ CRCTContribution│              │
│           │                           │                 │ Dependency   │
├───────────┼───────────────────────────┼─────────────────┤ Visualization│
│           │                           │                 │              │
│ Utility   │     Cache System          │ Multi-Provider  │ Context      │
│Components │                           │ Integration     │ Menus        │
│           │                           │                 │              │
└───────────┴───────────────────────────┴─────────────────┴──────────────┘
```

### Core Components

1. **Key Manager**: Implements hierarchical contextual key generation and management
2. **Dependency Grid**: Manages the grid representation of dependencies between keys
3. **Tracker IO**: Handles reading and writing of tracker files in Markdown format

### Service Layer

1. **CRCT Service**: Main service that orchestrates the CRCT system
2. **Phase Management**: Handles transitions between setup, strategy, and execution phases
3. **MUP (Mandatory Update Protocol)**: Ensures system state consistency

### Integration Components

1. **CRCT Provider**: Implements the IAIProvider interface to expose CRCT to VS Code
2. **CRCT Contribution**: Workbench contribution for initialization
3. **Multi-Provider Integration**: Integration with the existing AI provider framework

### Visualization and UI Components

1. **Command Integration**: Exposes CRCT operations through VS Code commands
2. **Status Bar Integration**: Shows CRCT phase and context information in the status bar
3. **Dependency Visualization**: Interactive graph for visualizing file dependencies
4. **Context Menus**: Direct access to CRCT functionality through explorer and editor context menus

### Utility Components

1. **Cache Manager**: Implements caching with TTL and dependency tracking
2. **Batch Processor**: Enables parallel processing for large workspaces

## Implementation Details

### Contextual Keys System

The CRCT system uses a hierarchical key system to uniquely identify files and directories:

- **Format**: `Tier + DirLetter + [SubdirLetter] + [FileNumber]` (e.g., `1A`, `1Aa`, `1Aa1`)
- **Tier Promotion**: Sub-subdirectories start a new tier (e.g., `2A`) to prevent excessively long keys
- **Path Mapping**: Each key maps to a normalized file path

### Dependency Tracking

Dependencies are tracked using a grid system with the following characteristics:

- **Grid Structure**: Keys are rows and columns in a matrix
- **Dependency Types**: Various relationships (`>`, `<`, `x`, `d`, `s`, `S`, `p`, `o`, `n`)
- **RLE Compression**: Run-Length Encoding for efficient storage
- **Tracker Files**: Main tracker, doc tracker, and mini-trackers

### Phase Management

The CRCT system operates in three distinct phases:

1. **Setup/Maintenance**: For initial setup and system configuration
2. **Strategy**: For planning and task decomposition
3. **Execution**: For task execution and code generation

### Command Integration

The CRCT system exposes commands to VS Code for user interaction:

- **Command Registration**: Commands registered through VS Code's command system
- **Command Palette Integration**: CRCT commands available through the command palette
- **Command Handlers**: Implementations that connect commands to CRCT functionality

### Status Bar Integration

Status indicators provide at-a-glance information about CRCT:

- **Phase Indicator**: Shows the current CRCT phase (Setup, Strategy, Execution)
- **Context Indicator**: Shows the active context being used
- **Processing Status**: Indicates when CRCT is processing operations

### Dependency Visualization

Interactive visualization of file and directory dependencies:

- **Graph View**: WebView-based visualization of the dependency graph
- **Node Types**: Different visualizations for files, directories, and groups
- **Edge Types**: Visual distinctions for different dependency types
- **Interaction**: Selection, navigation, and filtering of dependencies

### Performance Optimizations

- **Caching**: TTL-based caching with dependency invalidation
- **Batch Processing**: Parallel execution for file analysis
- **Lazy Loading**: Load components only when needed
- **Virtualized Rendering**: Efficient rendering of large dependency graphs

## Integration with VS Code

### VS Code Services

The implementation integrates with these VS Code services:

- **File System API**: For reading and writing tracker files
- **Progress API**: For displaying progress during long operations
- **Configuration Service**: For storing and retrieving settings
- **Storage Service**: For persisting phase information
- **Command API**: For registering and invoking commands
- **Status Bar API**: For showing CRCT status
- **WebView API**: For dependency graph visualization
- **Menu API**: For context menu integration

### AI Provider Framework

The CRCT provider implements the `IAIProvider` interface:

- **Streaming Responses**: Provides streaming output for long-running operations
- **Context Management**: Enhances context for other providers
- **Dependency Information**: Makes dependency data available to AI models

## Usage Scenarios

1. **Initial Project Setup**:
   ```
   > Start CRCT
   ```
   Initializes the CRCT system in the current workspace

2. **Workspace Analysis**:
   ```
   > CRCT: Analyze Workspace Dependencies
   ```
   Analyzes the workspace to build dependency information

3. **Phase Transitions**:
   ```
   > CRCT: Change Phase to Strategy
   ```
   Transitions the system to the strategy phase

4. **Dependency Queries**:
   ```
   > CRCT: View Dependencies for Current File
   ```
   Displays dependencies for the current file

5. **Tracker Management**:
   ```
   > CRCT: Manage Trackers
   ```
   Opens a menu for managing tracker files

6. **Visual Exploration**:
   ```
   > CRCT: Show Dependency Graph
   ```
   Opens the interactive dependency graph visualization

## Future Enhancements

1. **Enhanced Graph Visualization**: 3D visualization for complex dependency structures
2. **Real-time Dependency Updates**: Live updates to dependency information during editing
3. **Integration with Language Servers**: For more accurate dependency analysis
4. **ML-based Dependency Prediction**: Using machine learning to predict potential dependencies
5. **Collaborative Dependency Annotation**: Team-based annotation of dependencies