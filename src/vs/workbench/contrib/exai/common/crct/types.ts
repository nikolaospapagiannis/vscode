/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';

/**
 * Information about a key in the contextual key system
 */
export interface KeyInfo {
	keyString: string;
	normPath: string;
	parentPath: string | null;
	tier: number;
	isDirectory: boolean;
}

/**
 * Represents a dependency relationship between two keys
 */
export type DependencyType = '>' | '<' | 'x' | 'd' | 'o' | 'n' | 'p' | 's' | 'S';

/**
 * CRCT System phases
 */
export enum CRCTPhase {
	SETUP = 'setup',
	STRATEGY = 'strategy',
	EXECUTION = 'execution'
}

/**
 * Represents a dependency relationship with origin information
 */
export interface DependencyRelationship {
	targetKey: string;
	targetPath: string;
	dependencyType: DependencyType;
	origins: string[];
}

/**
 * Comprehensive dependency information for a key
 */
export interface DependencyInfo {
	key: string;
	path: string;
	dependencies: {
		mutualDependencies: DependencyRelationship[];
		dependsOn: DependencyRelationship[];
		dependedOnBy: DependencyRelationship[];
		documentationDependencies: DependencyRelationship[];
		semanticDependencies: DependencyRelationship[];
		placeholders: DependencyRelationship[];
	};
}

/**
 * Tracker type definitions
 */
export enum TrackerType {
	MAIN = 'main',
	DOC = 'doc',
	MINI = 'mini'
}

/**
 * Tracker file structure
 */
export interface TrackerData {
	keys: Record<string, string>; // keyString -> path
	grid: Record<string, string>; // keyString -> compressed row
	lastKeyEdit?: string;
	lastGridEdit?: string;
}

/**
 * CRCT Configuration options
 */
export interface CRCTConfiguration {
	embeddingDevice: 'cpu' | 'cuda' | 'mps';
	excludedDirs: string[];
	excludedExtensions: string[];
	excludedPaths: string[];
	excludedFilePatterns: string[];
	codeRootDirectories: string[];
	docDirectories: string[];
	memoryDir: string;
	embeddingsDir: string;
	backupsDir: string;
	characterDefinitions: Record<DependencyType, number>; // Character -> priority
}

/**
 * Interface for CRCT system service
 */
export interface ICRCTService extends IDisposable {
	/**
	 * Current phase of the CRCT system
	 */
	readonly currentPhase: CRCTPhase;

	/**
	 * Event that fires when the phase changes
	 */
	readonly onDidChangePhase: Event<CRCTPhase>;

	/**
	 * Event that fires when dependencies change
	 */
	readonly onDidChangeDependencies: Event<void>;

	/**
	 * Initialize or bootstrap the CRCT system
	 */
	initialize(workspaceRoot: URI): Promise<void>;

	/**
	 * Change the current phase
	 */
	changePhase(phase: CRCTPhase): Promise<void>;

	/**
	 * Analyze the workspace to build dependency information
	 */
	analyzeWorkspace(
		forceAnalysis?: boolean,
		forceEmbeddings?: boolean
	): Promise<void>;

	/**
	 * Get all dependencies for a key
	 */
	getDependencies(key: string): Promise<DependencyInfo>;

	/**
	 * Add a dependency between keys
	 */
	addDependency(
		tracker: URI | string,
		sourceKey: string,
		targetKeys: string[],
		dependencyType: DependencyType
	): Promise<void>;

	/**
	 * Remove a key from a tracker
	 */
	removeKey(tracker: URI | string, key: string): Promise<void>;

	/**
	 * Execute the Mandatory Update Protocol
	 */
	executeMUP(): Promise<void>;

	/**
	 * Get the current active context
	 */
	getActiveContext(): Promise<string>;

	/**
	 * Update the active context
	 */
	updateActiveContext(content: string): Promise<void>;
}

/**
 * Interface for the contextual key manager
 */
export interface IKeyManager {
	/**
	 * Generate keys for a set of paths
	 */
	generateKeys(
		rootPaths: string[],
		excludedDirs?: Set<string>,
		excludedExtensions?: Set<string>,
		precomputedExcludedPaths?: Set<string>
	): Promise<{ pathToKeyInfo: Map<string, KeyInfo>; newKeys: KeyInfo[] }>;

	/**
	 * Get the key for a path
	 */
	getKeyFromPath(path: string): Promise<string | undefined>;

	/**
	 * Get the path for a key
	 */
	getPathFromKey(key: string, contextPath?: string): Promise<string | undefined>;

	/**
	 * Validate if a key is in the correct format
	 */
	validateKey(key: string): boolean;

	/**
	 * Sort keys hierarchically
	 */
	sortKeyStringsHierarchically(keys: string[]): string[];
}

/**
 * Interface for the dependency grid manager
 */
export interface IDependencyGridManager {
	/**
	 * Create an initial grid for a set of keys
	 */
	createInitialGrid(keys: string[]): Record<string, string>;

	/**
	 * Add a dependency to a grid
	 */
	addDependencyToGrid(
		grid: Record<string, string>,
		sourceKey: string,
		targetKey: string,
		keys: string[],
		depType?: DependencyType
	): Record<string, string>;

	/**
	 * Remove a dependency from a grid
	 */
	removeDependencyFromGrid(
		grid: Record<string, string>,
		sourceKey: string,
		targetKey: string,
		keys: string[]
	): Record<string, string>;

	/**
	 * Get dependencies from a grid for a key
	 */
	getDependenciesFromGrid(
		grid: Record<string, string>,
		key: string,
		keys: string[]
	): Record<DependencyType, string[]>;

	/**
	 * Validate a grid for consistency
	 */
	validateGrid(grid: Record<string, string>, keys: string[]): boolean;

	/**
	 * Format a grid for display
	 */
	formatGridForDisplay(grid: Record<string, string>, keys: string[]): string;
}

/**
 * Interface for tracker IO operations
 */
export interface ITrackerIO {
	/**
	 * Read a tracker file
	 */
	readTrackerFile(path: string | URI): Promise<TrackerData | null>;

	/**
	 * Write a tracker file
	 */
	writeTrackerFile(
		path: string | URI,
		keys: Record<string, string>,
		grid: Record<string, string>,
		lastKeyEdit?: string,
		lastGridEdit?: string
	): Promise<boolean>;

	/**
	 * Update a tracker with new dependencies
	 */
	updateTracker(
		outputFile: string | URI,
		pathToKeyInfo: Map<string, KeyInfo>,
		trackerType: TrackerType,
		suggestions: Record<string, Array<[string, DependencyType]>>,
		fileToModule: Record<string, string>,
		newKeys?: KeyInfo[],
		forceApplySuggestions?: boolean
	): Promise<void>;

	/**
	 * Merge two trackers
	 */
	mergeTrackers(
		primaryTrackerPath: string | URI,
		secondaryTrackerPath: string | URI,
		outputPath?: string | URI
	): Promise<TrackerData | null>;

	/**
	 * Export a tracker to another format
	 */
	exportTracker(
		trackerPath: string | URI,
		format: 'json' | 'csv' | 'dot',
		outputPath?: string | URI
	): Promise<string | null>;
}

/**
 * Interface for cache management
 */
export interface ICacheManager {
	/**
	 * Get a cached value
	 */
	get<T>(cacheName: string, key: string): T | undefined;

	/**
	 * Set a cached value
	 */
	set<T>(cacheName: string, key: string, value: T, dependencies?: string[], ttl?: number): void;

	/**
	 * Clear all caches
	 */
	clearAll(): void;

	/**
	 * Invalidate cache entries by key pattern
	 */
	invalidateDependentEntries(cacheName: string, keyPattern: string): void;

	/**
	 * Invalidate caches when a file is modified
	 */
	fileModified(filePath: string, projectRoot: string, cacheType?: string): void;

	/**
	 * Get cache stats
	 */
	getStats(cacheName: string): { hits: number; misses: number; size: number };
}

/**
 * Interface for batch processing
 */
export interface IBatchProcessor {
	/**
	 * Process a list of items in batches
	 */
	processItems<T, R>(
		items: T[],
		processorFunc: (item: T, ...args: any[]) => Promise<R>,
		...args: any[]
	): Promise<R[]>;

	/**
	 * Process items and collect results
	 */
	processWithCollector<T, R, C>(
		items: T[],
		processorFunc: (item: T, ...args: any[]) => Promise<R>,
		collectorFunc: (results: R[]) => C,
		...args: any[]
	): Promise<C>;
}