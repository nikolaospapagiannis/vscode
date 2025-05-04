# Recursive Chain-of-Thought System (CRCT) Implementation

## Overview

The Recursive Chain-of-Thought System (CRCT) enhances VS Code's AI capabilities by providing robust context management, dependency tracking, and recursive reasoning. This implementation transforms the original Python-based CRCT system into a TypeScript solution integrated with VS Code's architecture and the Multi-Provider Framework.

## Architecture

The CRCT system consists of several key components:

```
┌─────────────────────────────────────────────────────────────┐
│                      CRCT System                            │
├───────────┬───────────────────────────┬─────────────────────┤
│           │                           │                     │
│  Core     │     Service Layer         │  Integration        │
│Components │                           │  Components         │
│           │                           │                     │
├───────────┼───────────────────────────┼─────────────────────┤
│KeyManager │                           │                     │
│           │                           │                     │
│Dependency │     CRCTService           │ CRCTProvider        │
│Grid       │                           │                     │
│           │                           │                     │
│TrackerIO  │                           │ CRCTContribution    │
│           │                           │                     │
├───────────┼───────────────────────────┼─────────────────────┤
│           │                           │                     │
│ Utility   │     Cache System          │ Multi-Provider      │
│Components │                           │ Integration         │
│           │                           │                     │
└───────────┴───────────────────────────┴─────────────────────┘
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

### Performance Optimizations

- **Caching**: TTL-based caching with dependency invalidation
- **Batch Processing**: Parallel execution for file analysis
- **Lazy Loading**: Load components only when needed

## Integration with VS Code

### VS Code Services

The implementation integrates with these VS Code services:

- **File System API**: For reading and writing tracker files
- **Progress API**: For displaying progress during long operations
- **Configuration Service**: For storing and retrieving settings
- **Storage Service**: For persisting phase information

### AI Provider Framework

The CRCT provider implements the `IAIProvider` interface:

- **Streaming Responses**: Provides streaming output for long-running operations
- **Context Management**: Enhances context for other providers
- **Dependency Information**: Makes dependency data available to AI models

## Usage Scenarios

1. **Initial Project Setup**:
   ```
   > Start.
   ```
   Initializes the CRCT system in the current workspace

2. **Workspace Analysis**:
   ```
   > Analyze workspace
   ```
   Analyzes the workspace to build dependency information

3. **Phase Transitions**:
   ```
   > Change phase to strategy
   ```
   Transitions the system to the strategy phase

4. **Dependency Queries**:
   ```
   > Show dependencies for 1Aa
   ```
   Displays dependencies for a specific key

## Future Enhancements

1. **UI Visualization**: Graphical representation of dependencies
2. **Enhanced Reasoning**: Improved recursive reasoning algorithms
3. **Integration with Language Servers**: For more accurate dependency analysis
4. **VS Code Commands**: Direct command integration with VS Code UI
5. **Real-time Updates**: Live updates to dependency information during editing