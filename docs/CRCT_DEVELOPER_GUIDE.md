# CRCT Developer Guide

This guide provides detailed information for developers working with the Recursive Chain-of-Thought (CRCT) system in VS Code.

## Getting Started

### Prerequisites

- VS Code codebase
- TypeScript knowledge
- Understanding of VS Code extensions

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
  readonly onDidChangePhase: Event<CRCTPhase>;
  readonly onDidChangeDependencies: Event<void>;
  
  initialize(workspaceRoot: URI): Promise<void>;
  changePhase(phase: CRCTPhase): Promise<void>;
  analyzeWorkspace(forceAnalysis?: boolean, forceEmbeddings?: boolean): Promise<void>;
  getDependencies(key: string): Promise<DependencyInfo>;
  addDependency(tracker: URI | string, sourceKey: string, targetKeys: string[], dependencyType: DependencyType): Promise<void>;
  removeKey(tracker: URI | string, key: string): Promise<void>;
  executeMUP(): Promise<void>;
  getActiveContext(): Promise<string>;
  updateActiveContext(content: string): Promise<void>;
}
```

### IKeyManager

Interface for the key management system:

```typescript
interface IKeyManager {
  generateKeys(rootPaths: string[], excludedDirs?: Set<string>, excludedExtensions?: Set<string>, precomputedExcludedPaths?: Set<string>): Promise<{ pathToKeyInfo: Map<string, KeyInfo>; newKeys: KeyInfo[] }>;
  getKeyFromPath(path: string): Promise<string | undefined>;
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