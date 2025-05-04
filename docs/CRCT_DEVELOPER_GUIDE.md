# CRCT Developer Guide

This guide provides detailed information for developers working with the Recursive Chain-of-Thought (CRCT) system in VS Code.

## Getting Started

### Prerequisites

- VS Code codebase
- TypeScript knowledge
- Understanding of VS Code extensions
- Familiarity with VS Code UI components (WebViews, commands, etc.)

### Code Organization

```
/vs/workbench/contrib/exai/common/crct/
├── types.ts                  # Core interfaces and types
├── crctService.ts            # Main service implementation
├── crctProvider.ts           # Provider implementation
├── crctContribution.ts       # Workbench contribution
├── crctRegistration.ts       # Registration functions
├── core/
│   ├── keyManager.ts         # Hierarchical key system
│   └── dependencyGrid.ts     # Dependency grid implementation
├── io/
│   └── trackerIO.ts          # Tracker file I/O
└── utils/
    ├── cacheManager.ts       # Caching system
    └── batchProcessor.ts     # Parallel processing

/vs/workbench/contrib/exai/browser/crct/
├── commands/
│   ├── commandConstants.ts   # Command IDs and constants
│   ├── crctCommands.ts       # Command registration and handlers
│   └── menus.ts              # Menu contributions
├── statusBar/
│   ├── crctStatusBar.ts      # Status bar contribution
│   └── progressReporter.ts   # Progress reporting
├── visualization/
│   ├── dependencyGraph.ts    # Dependency graph view
│   ├── graphRenderer.ts      # WebView graph rendering
│   └── nodeTypes.ts          # Node and edge type definitions
└── crctUIRegistration.ts     # UI component registration
```

## Core Concepts

### Contextual Keys

The CRCT system uses a hierarchical key system to track files and directories:

```typescript
interface KeyInfo {
  keyString: string;      // e.g., "1Aa1"
  normPath: string;       // Normalized absolute path
  parentPath: string | null; // Parent directory path
  tier: number;           // Tier level (1, 2, etc.)
  isDirectory: boolean;   // Whether this is a directory
}
```

Keys follow the pattern:
- **Tier**: The initial number indicates nesting level (1, 2, ...)
- **DirLetter**: Uppercase letter ('A', 'B', ...) for directories
- **SubdirLetter**: Lowercase letter ('a', 'b', ...) for subdirectories
- **FileNumber**: Number for files (1, 2, ...)

Example patterns:
- `1A` - Top-level directory A
- `1Aa` - Subdirectory a within directory A
- `1Aa1` - File 1 within subdirectory a
- `2A` - Promoted subdirectory (new tier)

### Dependency Grid

Dependencies are represented using a grid where rows and columns are keys:

```
X  1A  1Aa  1Aa1
1A = o   p    p
1Aa = .   o    >
1Aa1 = .   <    o
```

Dependency characters:
- `o`: Self dependency (diagonal elements)
- `>`: Column depends on row
- `<`: Row depends on column
- `x`: Mutual dependency
- `d`: Documentation dependency
- `s`: Weak semantic
- `S`: Strong semantic
- `p`: Placeholder
- `n`: No dependency (verified)

The grid is stored with Run-Length Encoding (RLE) compression to save space.

### Tracker Files

Tracker files store dependency information in Markdown format:

1. **Main Tracker**: `module_relationship_tracker.md` - High-level dependencies
2. **Doc Tracker**: `doc_tracker.md` - Documentation file dependencies
3. **Mini-Trackers**: `{module_name}_module.md` - Module-specific dependencies

Structure:
```markdown
---KEY_DEFINITIONS_START---
1A: /path/to/dirA
1Aa: /path/to/dirA/subdirA
1Aa1: /path/to/dirA/subdirA/file1
---KEY_DEFINITIONS_END---

Last Key Edit: 2023-09-15T12:00:00Z
Last Grid Edit: Added dependency 1Aa > 1Aa1

---DEPENDENCY_GRID_START---
1A = o2p
1Aa = .o>
1Aa1 = .<o
---DEPENDENCY_GRID_END---
```

## API Reference

### ICRCTService

Main service interface for the CRCT system:

```typescript
interface ICRCTService {
  readonly currentPhase: CRCTPhase;
  readonly onPhaseChanged: Event<CRCTPhase>;
  readonly onDependenciesChanged: Event<void>;
  readonly onAnalysisStarted: Event<void>;
  readonly onAnalysisCompleted: Event<void>;
  readonly onKeyGenerationStarted: Event<void>;
  readonly onKeyGenerationCompleted: Event<{ total: number }>;
  readonly onGridUpdateStarted: Event<void>;
  readonly onGridUpdateCompleted: Event<void>;
  readonly onActiveContextChanged: Event<string | undefined>;

  readonly keyManager: IKeyManager;
  readonly dependencyGridManager: IDependencyGridManager;
  readonly trackerIO: ITrackerIO;
  readonly cacheManager: ICacheManager;
  readonly batchProcessor: IBatchProcessor;
  
  initialize(workspaceRoot: URI): Promise<void>;
  changePhase(phase: CRCTPhase): Promise<void>;
  analyzeWorkspace(forceAnalysis?: boolean, forceEmbeddings?: boolean): Promise<void>;
  getDependencies(key: string): Promise<DependencyInfo>;
  addDependency(tracker: URI | string, sourceKey: string, targetKeys: string[], dependencyType: DependencyType): Promise<void>;
  removeKey(tracker: URI | string, key: string): Promise<void>;
  executeMUP(): Promise<void>;
  getActiveContext(): Promise<string | undefined>;
  setActiveContext(contextName: string): Promise<void>;
  clearActiveContext(): Promise<void>;
}
```

### IKeyManager

Interface for the key management system:

```typescript
interface IKeyManager {
  generateKeys(rootPaths: string[] | URI[], excludedDirs?: Set<string>, excludedExtensions?: Set<string>, precomputedExcludedPaths?: Set<string>): Promise<{ pathToKeyInfo: Map<string, KeyInfo>; newKeys: KeyInfo[] }>;
  getKeyForPath(path: string | URI): Promise<KeyInfo | undefined>;
  getKeyForString(key: string): Promise<KeyInfo | undefined>;
  getPathFromKey(key: string, contextPath?: string): Promise<string | undefined>;
  validateKey(key: string): boolean;
  sortKeyStringsHierarchically(keys: string[]): string[];
}
```

### IDependencyGridManager

Interface for the dependency grid:

```typescript
interface IDependencyGridManager {
  createInitialGrid(keys: string[]): Record<string, string>;
  addDependencyToGrid(grid: Record<string, string>, sourceKey: string, targetKey: string, keys: string[], depType?: DependencyType): Record<string, string>;
  removeDependencyFromGrid(grid: Record<string, string>, sourceKey: string, targetKey: string, keys: string[]): Record<string, string>;
  getDependenciesFromGrid(grid: Record<string, string>, key: string, keys: string[]): Record<DependencyType, string[]>;
  validateGrid(grid: Record<string, string>, keys: string[]): boolean;
  formatGridForDisplay(grid: Record<string, string>, keys: string[]): string;
  updateGrid(): Promise<void>;
}
```

### IDependencyGraphView

Interface for the dependency graph visualization:

```typescript
interface IDependencyGraphView {
  showDependenciesForKey(key: KeyInfo): Promise<void>;
  showFullDependencyGraph(): Promise<void>;
  highlightNode(nodeId: string): void;
  centerOnNode(nodeId: string): void;
  readonly onNodeSelected: Event<string>;
  readonly onNodeNavigateTo: Event<string>;
}
```

## Extension Points

### Adding a New Dependency Type

1. Update the `DependencyType` union in `types.ts`:
   ```typescript
   export type DependencyType = '>' | '<' | 'x' | 'd' | 'o' | 'n' | 'p' | 's' | 'S' | 'new_type';
   ```

2. Add the new type to `DEFAULT_CHARACTER_PRIORITIES` in `crctService.ts`:
   ```typescript
   const DEFAULT_CHARACTER_PRIORITIES: Record<DependencyType, number> = {
     // ... existing types
     'new_type': 45, // Assign appropriate priority
   };
   ```

3. Update dependency processing in `getDependenciesFromGrid` in `dependencyGrid.ts`.

4. Add visualization support in `nodeTypes.ts`:
   ```typescript
   export const edgeColors = {
     // ... existing types
     [DependencyType.NewType]: new ThemeColor('crct.newTypeEdge')
   };
   
   export const dependencyIcons = {
     // ... existing types
     [DependencyType.NewType]: 'codicon-symbol-misc' // Choose appropriate icon
   };
   ```

### Adding a New Phase

1. Update the `CRCTPhase` enum in `types.ts`:
   ```typescript
   export enum CRCTPhase {
     SETUP = 'setup',
     STRATEGY = 'strategy',
     EXECUTION = 'execution',
     NEW_PHASE = 'new_phase'
   }
   ```

2. Update phase transition logic in `changePhase` in `crctService.ts`.

3. Implement phase-specific functionality in `crctProvider.ts`.

4. Update status bar phase indicator in `crctStatusBar.ts`:
   ```typescript
   private getPhaseStatusEntry(): IStatusbarEntry {
     // ... existing phases
     case CRCTPhase.NEW_PHASE:
       text = '$(symbol-misc) CRCT: New Phase';
       tooltip = 'CRCT is in new phase. Click to view dependency graph.';
       color = new ThemeColor('statusBarItem.infoBackground');
       break;
     // ...
   }
   ```

### Adding a New Command

1. Add command constants in `commandConstants.ts`:
   ```typescript
   export const NEW_COMMAND_ID = 'crct.newCommand';
   export const NEW_COMMAND_TITLE = 'Execute New Operation';
   ```

2. Implement command handler in `crctCommands.ts`:
   ```typescript
   CommandsRegistry.registerCommand(CommandConstants.NEW_COMMAND_ID, async () => {
     // Command implementation
   });
   ```

3. Register command in menu system in `menus.ts`:
   ```typescript
   MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
     command: {
       id: CommandConstants.NEW_COMMAND_ID,
       title: {
         value: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.NEW_COMMAND_TITLE}`,
         original: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.NEW_COMMAND_TITLE}`
       },
       category: CommandConstants.CRCT_COMMAND_CATEGORY
     }
   });
   ```

## Performance Considerations

### Caching Strategy

The system uses TTL-based caching:
- Default TTL: 600 seconds (10 minutes)
- Cache entries expire automatically
- Dependencies between cache entries are tracked

Customize cache behavior in `cacheManager.ts`:
```typescript
const DEFAULT_TTL = 600;  // Adjust default TTL
const DEFAULT_MAX_SIZE = 1000; // Adjust max cache size
const CACHE_SIZES = {
  "embeddings_generation": 100,  // Specific cache sizes
  "key_generation": 5000,
};
```

### Batch Processing

Large workspaces use parallel processing:
- Adapts to CPU count
- Adjusts batch size based on workload
- Reports progress to the user

## Troubleshooting

### Common Issues

1. **Key generation failures**:
   - Usually due to more than 26 subdirectories in a single directory
   - Solution: Use exclusion patterns to ignore problematic directories

2. **Cache invalidation issues**:
   - If data seems stale, call `clear_all_caches()`
   - Check file modification timestamps

3. **Performance issues**:
   - Large workspaces may cause slowdowns
   - Adjust batch size and cache settings
   - Consider adding exclusion patterns

### Debugging

Enable debug logging by configuring the log level:
```typescript
// In extension.ts
logService.setLevel(LogLevel.Debug);
```

## UI Development

### Adding WebView Components

1. Create HTML template in the WebView renderer:
   ```typescript
   private getHtmlForWebview(): string {
     return `<!DOCTYPE html>
     <html lang="en">
     <head>
       <meta charset="UTF-8">
       <title>CRCT Visualization</title>
       <style>
         /* CSS styles here */
       </style>
     </head>
     <body>
       <div id="container"></div>
       <script>
         // WebView JavaScript here
       </script>
     </body>
     </html>`;
   }
   ```

2. Handle messages between extension and WebView:
   ```typescript
   // In extension
   this.webview.postMessage({ type: 'updateData', data: someData });
   
   // In WebView
   window.addEventListener('message', event => {
     const message = event.data;
     if (message.type === 'updateData') {
       // Handle the data
     }
   });
   ```

3. Register the WebView with VS Code:
   ```typescript
   const viewContainer = Registry.as<IViewContainerRegistry>(ViewContainerExtensions.ViewContainersRegistry)
     .registerViewContainer({
       id: 'crct.dependencyGraph',
       title: localize('crct.graph.title', "Dependency Graph"),
       icon: 'codicon-references',
       ctorDescriptor: new SyncDescriptor(YourViewContainerClass)
     }, ViewContainerLocation.Sidebar);
   ```

### Styling UI Components

1. Follow VS Code theme colors:
   ```typescript
   const nodeColor = new ThemeColor('crct.nodeColor');
   ```

2. Use VS Code's CSS variables in WebViews:
   ```css
   body {
     background-color: var(--vscode-editor-background);
     color: var(--vscode-editor-foreground);
   }
   ```

3. Use codicons for consistent iconography:
   ```typescript
   const icon = '$(references)'; // References icon
   ```

## Contributing

### Adding New Features

1. Create a detailed design document
2. Update relevant interfaces in `types.ts`
3. Implement functionality while preserving existing patterns
4. Add unit tests
5. Update documentation

### Documentation

When adding new features, update:
1. Interface documentation in code
2. This developer guide
3. `CRCT_IMPLEMENTATION.md` for high-level changes
4. `CRCT_VISUALIZATION_DESIGN.md` for UI changes