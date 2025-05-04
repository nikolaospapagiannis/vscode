/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { VS_CRCT_ID } from 'vs/platform/extensions/common/fileBasedExtensions';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { ICacheManager } from './types';
import { Emitter } from 'vs/base/common/event';
import { CRCTPhase, DependencyInfo, DependencyType, ICRCTService, IKeyManager, TrackerType } from './types';
import { getExtUri } from '../utils/uriUtils';
import { localize } from 'vs/nls';
import { IBatchProcessor } from './types';
import { ITrackerIO } from './types';
import { IDependencyGridManager } from './types';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { CacheManager } from './utils/cacheManager';
import { KeyManager } from './core/keyManager';
import { DependencyGrid } from './core/dependencyGrid';
import { TrackerIO } from './io/trackerIO';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';

// Configuration keys
const CONFIG_EMBEDDING_DEVICE = 'exai.crct.embeddingDevice';
const CONFIG_EXCLUDED_DIRS = 'exai.crct.excludedDirs';
const CONFIG_EXCLUDED_EXTENSIONS = 'exai.crct.excludedExtensions';
const CONFIG_EXCLUDED_PATHS = 'exai.crct.excludedPaths';
const CONFIG_EXCLUDED_FILE_PATTERNS = 'exai.crct.excludedFilePatterns';
const CONFIG_CODE_ROOT_DIRECTORIES = 'exai.crct.codeRootDirectories';
const CONFIG_DOC_DIRECTORIES = 'exai.crct.docDirectories';
const CONFIG_MEMORY_DIR = 'exai.crct.memoryDir';
const CONFIG_EMBEDDINGS_DIR = 'exai.crct.embeddingsDir';
const CONFIG_BACKUPS_DIR = 'exai.crct.backupsDir';

// Default character priorities
const DEFAULT_CHARACTER_PRIORITIES: Record<DependencyType, number> = {
	'x': 100, // Mutual dependency (highest)
	'd': 90,  // Documentation
	'S': 80,  // Strong semantic
	'>': 70,  // Outbound dependency
	'<': 70,  // Inbound dependency
	's': 60,  // Weak semantic
	'o': 50,  // Self (diagonal)
	'n': 40,  // No dependency (verified)
	'p': 30   // Placeholder (lowest)
};

// Storage keys
const STORAGE_CURRENT_PHASE = 'exai.crct.currentPhase';

/**
 * Implementation of the CRCT service
 */
export class CRCTService extends Disposable implements ICRCTService {
	private static readonly DEFAULT_STORAGE_DIR = '.crct';
	
	private _currentPhase: CRCTPhase = CRCTPhase.SETUP;
	private _onDidChangePhase = new Emitter<CRCTPhase>();
	readonly onDidChangePhase = this._onDidChangePhase.event;
	
	private _onDidChangeDependencies = new Emitter<void>();
	readonly onDidChangeDependencies = this._onDidChangeDependencies.event;
	
	private workspaceRoot: URI | undefined;
	private memoryDir: URI | undefined;
	private embeddingsDir: URI | undefined;
	private backupsDir: URI | undefined;
	private clinerulesPath: URI | undefined;
	private clinerulesConfigPath: URI | undefined;
	
	// Core components
	private cacheManager: ICacheManager;
	private keyManager: IKeyManager;
	private dependencyGrid: IDependencyGridManager;
	private trackerIO: ITrackerIO;
	private batchProcessor: IBatchProcessor;
	
	// Tracker paths
	private mainTrackerPath: URI | undefined;
	private docTrackerPath: URI | undefined;
	
	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProgressService private readonly progressService: IProgressService
	) {
		super();
		
		// Initialize core components
		this.cacheManager = new CacheManager(false /* No persistence yet */);
		this.keyManager = new KeyManager(this.fileService, this.logService, this.cacheManager);
		this.dependencyGrid = new DependencyGrid(this.logService, this.cacheManager);
		this.trackerIO = new TrackerIO(
			this.fileService, 
			this.logService, 
			this.cacheManager,
			this.dependencyGrid,
			this.keyManager
		);
		
		// Load the current phase from storage
		const savedPhase = this.storageService.get(STORAGE_CURRENT_PHASE, StorageScope.WORKSPACE);
		if (savedPhase && Object.values(CRCTPhase).includes(savedPhase as CRCTPhase)) {
			this._currentPhase = savedPhase as CRCTPhase;
		}
		
		// Listen to configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('exai.crct')) {
				this.logService.info('CRCTService: Configuration changed');
				// Optionally reload config
			}
		}));
	}

	/**
	 * Current phase of the CRCT system
	 */
	get currentPhase(): CRCTPhase {
		return this._currentPhase;
	}

	/**
	 * Initialize the CRCT system with workspace paths
	 */
	async initialize(workspaceRoot: URI): Promise<void> {
		this.workspaceRoot = workspaceRoot;
		
		// Create or initialize storage directories
		try {
			await this.initializeFileStructure();
			
			// Initialize components that need paths
			await (this.keyManager as KeyManager).initialize(this.memoryDir!);
			
			this.logService.info('CRCTService: Initialized successfully');
		} catch (error) {
			this.logService.error(`CRCTService: Initialization failed: ${error}`);
			throw error;
		}
	}

	/**
	 * Create necessary directories and initialize file structure
	 */
	private async initializeFileStructure(): Promise<void> {
		if (!this.workspaceRoot) {
			throw new Error(localize('crctService.noWorkspaceRoot', "Workspace root not set"));
		}
		
		// Get configuration values
		const memoryDirConfig = this.configurationService.getValue<string>(CONFIG_MEMORY_DIR) || 'cline_docs';
		const embeddingsDirConfig = this.configurationService.getValue<string>(CONFIG_EMBEDDINGS_DIR) || '.embeddings';
		const backupsDirConfig = this.configurationService.getValue<string>(CONFIG_BACKUPS_DIR) || 'backups';
		
		// Create main directories
		this.memoryDir = URI.joinPath(this.workspaceRoot, memoryDirConfig);
		this.embeddingsDir = URI.joinPath(this.workspaceRoot, embeddingsDirConfig);
		this.backupsDir = URI.joinPath(this.memoryDir, backupsDirConfig);
		
		// Create .clinerules and .clinerules.config.json paths
		this.clinerulesPath = URI.joinPath(this.workspaceRoot, '.clinerules');
		this.clinerulesConfigPath = URI.joinPath(this.workspaceRoot, '.clinerules.config.json');
		
		// Define tracker paths
		this.mainTrackerPath = URI.joinPath(this.memoryDir, 'module_relationship_tracker.md');
		this.docTrackerPath = URI.joinPath(this.memoryDir, 'doc_tracker.md');
		
		// Ensure all directories exist
		await this.createDirectoryIfNotExists(this.memoryDir);
		await this.createDirectoryIfNotExists(this.embeddingsDir);
		await this.createDirectoryIfNotExists(this.backupsDir);
		
		this.logService.info('CRCTService: File structure initialized');
	}

	/**
	 * Create a directory if it doesn't exist
	 */
	private async createDirectoryIfNotExists(uri: URI): Promise<void> {
		try {
			const exists = await this.fileService.exists(uri);
			if (!exists) {
				await this.fileService.createFolder(uri);
				this.logService.info(`CRCTService: Created directory: ${uri.toString()}`);
			}
		} catch (error) {
			this.logService.error(`CRCTService: Failed to create directory ${uri.toString()}: ${error}`);
			throw error;
		}
	}

	/**
	 * Change the current phase
	 */
	async changePhase(phase: CRCTPhase): Promise<void> {
		// Only allow valid phases
		if (!Object.values(CRCTPhase).includes(phase)) {
			throw new Error(localize('crctService.invalidPhase', "Invalid phase: {0}", phase));
		}
		
		// Update phase
		this._currentPhase = phase;
		
		// Persist to storage
		this.storageService.store(STORAGE_CURRENT_PHASE, phase, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		
		// Update .clinerules file
		if (this.clinerulesPath) {
			await this.updateClinerules(phase);
		}
		
		// Notify listeners
		this._onDidChangePhase.fire(phase);
		
		this.logService.info(`CRCTService: Changed to phase: ${phase}`);
	}

	/**
	 * Update the .clinerules file with the new phase
	 */
	private async updateClinerules(phase: CRCTPhase): Promise<void> {
		try {
			const exists = await this.fileService.exists(this.clinerulesPath!);
			let content = '';
			
			if (exists) {
				// Read existing file
				const fileContent = await this.fileService.readFile(this.clinerulesPath!);
				content = fileContent.value.toString();
				
				// Update the phase
				const phaseRegex = /current_phase\s*=\s*(\w+)/;
				if (phaseRegex.test(content)) {
					content = content.replace(phaseRegex, `current_phase = ${phase}`);
				} else {
					// Add phase if not found
					content += `\ncurrent_phase = ${phase}\n`;
				}
			} else {
				// Create new file with default content
				content = `# CRCT Configuration\n\ncurrent_phase = ${phase}\n\n`;
				content += '[CODE_ROOT_DIRECTORIES]\nsrc\n\n';
				content += '[DOC_DIRECTORIES]\ndocs\n\n';
				content += '[Character_Definitions]\n';
				
				for (const [char, priority] of Object.entries(DEFAULT_CHARACTER_PRIORITIES)) {
					content += `${char} = ${priority}\n`;
				}
				
				content += '\n[LEARNING_JOURNAL]\n';
				content += 'Use this section to record insights, lessons learned, and key points about this project.\n';
			}
			
			// Write the updated file
			await this.fileService.writeFile(this.clinerulesPath!, new TextEncoder().encode(content));
		} catch (error) {
			this.logService.error(`CRCTService: Failed to update .clinerules: ${error}`);
			throw error;
		}
	}

	/**
	 * Analyze the workspace to build dependency information
	 */
	async analyzeWorkspace(
		forceAnalysis: boolean = false,
		forceEmbeddings: boolean = false
	): Promise<void> {
		if (!this.workspaceRoot) {
			throw new Error(localize('crctService.noWorkspaceRoot', "Workspace root not set"));
		}
		
		// Show progress notification
		return this.progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: localize('crctService.analyzingWorkspace', "Analyzing workspace for CRCT"),
				cancellable: true
			},
			async (progress, token) => {
				try {
					progress.report({ message: localize('crctService.scanningFiles', "Scanning files..."), increment: 10 });
					
					// Get configuration
					const codeRootDirs = this.configurationService.getValue<string[]>(CONFIG_CODE_ROOT_DIRECTORIES) || ['src'];
					const docDirs = this.configurationService.getValue<string[]>(CONFIG_DOC_DIRECTORIES) || ['docs'];
					const excludedDirs = new Set(this.configurationService.getValue<string[]>(CONFIG_EXCLUDED_DIRS) || []);
					const excludedExtensions = new Set(this.configurationService.getValue<string[]>(CONFIG_EXCLUDED_EXTENSIONS) || []);
					
					// Convert paths to full URIs
					const codeRootPaths = codeRootDirs.map(dir => URI.joinPath(this.workspaceRoot!, dir));
					const docRootPaths = docDirs.map(dir => URI.joinPath(this.workspaceRoot!, dir));
					
					// Check if paths exist
					for (const path of [...codeRootPaths, ...docRootPaths]) {
						const exists = await this.fileService.exists(path);
						if (!exists) {
							this.logService.warning(`CRCTService: Path does not exist: ${path.toString()}`);
						}
					}
					
					// Step 1: Generate keys for all files
					progress.report({ message: localize('crctService.generatingKeys', "Generating keys..."), increment: 20 });
					
					if (token.isCancellationRequested) {
						return;
					}
					
					const { pathToKeyInfo, newKeys } = await this.keyManager.generateKeys(
						[...codeRootPaths, ...docRootPaths],
						excludedDirs,
						excludedExtensions
					);
					
					this.logService.info(`CRCTService: Generated ${newKeys.length} new keys for ${pathToKeyInfo.size} paths`);
					
					// Step 2: Update main tracker
					progress.report({ message: localize('crctService.updatingMainTracker', "Updating main tracker..."), increment: 30 });
					
					if (token.isCancellationRequested) {
						return;
					}
					
					// TODO: Implement dependency suggestions based on file analysis
					// For now, just create empty trackers
					
					// Build file-to-module mapping (placeholder implementation)
					const fileToModule: Record<string, string> = {};
					for (const pathInfo of pathToKeyInfo.values()) {
						if (!pathInfo.isDirectory && pathInfo.parentPath) {
							fileToModule[pathInfo.normPath] = pathInfo.parentPath;
						}
					}
					
					// Update trackers with empty suggestions for now
					await this.trackerIO.updateTracker(
						this.mainTrackerPath!,
						pathToKeyInfo,
						TrackerType.MAIN,
						{}, // No suggestions yet
						fileToModule,
						newKeys
					);
					
					// Step 3: Update doc tracker
					progress.report({ message: localize('crctService.updatingDocTracker', "Updating doc tracker..."), increment: 20 });
					
					if (token.isCancellationRequested) {
						return;
					}
					
					await this.trackerIO.updateTracker(
						this.docTrackerPath!,
						pathToKeyInfo,
						TrackerType.DOC,
						{}, // No suggestions yet
						fileToModule,
						newKeys
					);
					
					// Step 4: Create mini-trackers
					progress.report({ message: localize('crctService.creatingMiniTrackers', "Creating mini-trackers..."), increment: 20 });
					
					if (token.isCancellationRequested) {
						return;
					}
					
					// Find all directories that should have mini-trackers
					const miniTrackerDirs = Array.from(pathToKeyInfo.values())
						.filter(info => info.isDirectory && info.parentPath !== null)
						.map(info => info.normPath);
					
					// Create/update mini-trackers
					for (const dirPath of miniTrackerDirs) {
						const dirUri = URI.parse(dirPath);
						const dirName = dirUri.path.split('/').pop() || 'unknown';
						const miniTrackerPath = URI.joinPath(dirUri, `${dirName}_module.md`);
						
						await this.trackerIO.updateTracker(
							miniTrackerPath,
							pathToKeyInfo,
							TrackerType.MINI,
							{}, // No suggestions yet
							fileToModule,
							newKeys
						);
					}
					
					progress.report({ message: localize('crctService.analysisComplete', "Analysis complete"), increment: 20 });
					
					// Notify listeners that dependencies have changed
					this._onDidChangeDependencies.fire();
					
					this.logService.info('CRCTService: Workspace analysis complete');
				} catch (error) {
					this.logService.error(`CRCTService: Workspace analysis failed: ${error}`);
					throw error;
				}
			}
		);
	}

	/**
	 * Get all dependencies for a key
	 */
	async getDependencies(key: string): Promise<DependencyInfo> {
		if (!this.workspaceRoot) {
			throw new Error(localize('crctService.noWorkspaceRoot', "Workspace root not set"));
		}
		
		try {
			// Get the path for this key
			const keyPath = await this.keyManager.getPathFromKey(key);
			if (!keyPath) {
				throw new Error(localize('crctService.keyNotFound', "Key not found: {0}", key));
			}
			
			// Find all tracker files
			const allTrackerPaths = await this.findAllTrackerFiles();
			
			if (allTrackerPaths.length === 0) {
				throw new Error(localize('crctService.noTrackers', "No tracker files found"));
			}
			
			// Track dependencies by type
			const dependencyMap: Record<DependencyType, Map<string, { path: string; origins: Set<string> }>> = {
				'>': new Map(),
				'<': new Map(),
				'x': new Map(),
				'd': new Map(),
				'o': new Map(),
				'n': new Map(),
				'p': new Map(),
				's': new Map(),
				'S': new Map()
			};
			
			// Process each tracker file
			for (const trackerPath of allTrackerPaths) {
				const data = await this.trackerIO.readTrackerFile(trackerPath);
				if (!data || !data.keys || !data.grid) {
					continue;
				}
				
				// Skip if key isn't in this tracker
				if (!data.keys[key]) {
					continue;
				}
				
				const sortedKeys = Object.keys(data.keys);
				
				// Get both outgoing and incoming dependencies
				// Outgoing (key -> targetKey)
				const deps = this.dependencyGrid.getDependenciesFromGrid(data.grid, key, sortedKeys);
				
				// Process each type of dependency
				for (const [depType, targets] of Object.entries(deps)) {
					for (const targetKey of targets) {
						// Find path for target key
						const targetPath = data.keys[targetKey];
						if (!targetPath) {
							continue;
						}
						
						// Skip invalid dependency types
						if (!(depType in dependencyMap)) {
							continue;
						}
						
						// Add to dependency map
						const existing = dependencyMap[depType as DependencyType].get(targetKey);
						if (existing) {
							existing.origins.add(getExtUri(trackerPath).toString());
						} else {
							dependencyMap[depType as DependencyType].set(targetKey, {
								path: targetPath,
								origins: new Set([getExtUri(trackerPath).toString()])
							});
						}
					}
				}
				
				// Find incoming dependencies (targetKey -> key)
				for (const sourceKey of sortedKeys) {
					if (sourceKey === key) {
						continue;
					}
					
					try {
						const targetIdx = sortedKeys.indexOf(key);
						const sourceRow = data.grid[sourceKey];
						if (!sourceRow) {
							continue;
						}
						
						const depChar = this.dependencyGrid.getCharAt(sourceRow, targetIdx);
						if (depChar === 'p' || depChar === '.') {
							continue;
						}
						
						// For incoming deps, convert character based on direction
						let adjustedChar = depChar;
						if (depChar === '>') {
							adjustedChar = '<'; // Convert to opposite for incoming
						} else if (depChar === '<') {
							adjustedChar = '>'; // Convert to opposite for incoming
						}
						
						// Add to dependency map, but in the appropriate direction
						const sourcePath = data.keys[sourceKey];
						const existing = dependencyMap[adjustedChar as DependencyType].get(sourceKey);
						if (existing) {
							existing.origins.add(getExtUri(trackerPath).toString());
						} else {
							dependencyMap[adjustedChar as DependencyType].set(sourceKey, {
								path: sourcePath,
								origins: new Set([getExtUri(trackerPath).toString()])
							});
						}
					} catch (error) {
						// Skip problematic entries
						this.logService.warning(
							`CRCTService: Error processing incoming dependencies for ${sourceKey} -> ${key}: ${error}`
						);
					}
				}
			}
			
			// Convert to the expected format
			const result: DependencyInfo = {
				key,
				path: keyPath,
				dependencies: {
					mutualDependencies: [],
					dependsOn: [],
					dependedOnBy: [],
					documentationDependencies: [],
					semanticDependencies: [],
					placeholders: []
				}
			};
			
			// Helper to convert dependency maps to arrays
			const mapToArray = (map: Map<string, { path: string; origins: Set<string> }>): Array<{ targetKey: string; targetPath: string; dependencyType: DependencyType; origins: string[] }> => {
				return Array.from(map.entries()).map(([targetKey, info]) => ({
					targetKey,
					targetPath: info.path,
					dependencyType: depType as DependencyType,
					origins: Array.from(info.origins)
				}));
			};
			
			// Populate result object
			for (const [depType, depMap] of Object.entries(dependencyMap)) {
				const relationshipArray = mapToArray(depMap);
				
				// Categorize dependencies
				switch (depType) {
					case 'x':
						result.dependencies.mutualDependencies.push(...relationshipArray);
						break;
					case '<':
						result.dependencies.dependsOn.push(...relationshipArray);
						break;
					case '>':
						result.dependencies.dependedOnBy.push(...relationshipArray);
						break;
					case 'd':
						result.dependencies.documentationDependencies.push(...relationshipArray);
						break;
					case 's':
					case 'S':
						result.dependencies.semanticDependencies.push(...relationshipArray);
						break;
					case 'p':
						result.dependencies.placeholders.push(...relationshipArray);
						break;
					// 'o' and 'n' are not included in the result
				}
			}
			
			return result;
		} catch (error) {
			this.logService.error(`CRCTService: Failed to get dependencies for key ${key}: ${error}`);
			throw error;
		}
	}

	/**
	 * Find all tracker files in the workspace
	 */
	private async findAllTrackerFiles(): Promise<URI[]> {
		if (!this.workspaceRoot || !this.memoryDir) {
			return [];
		}
		
		const result: URI[] = [];
		
		// Add main trackers if they exist
		if (this.mainTrackerPath) {
			const mainExists = await this.fileService.exists(this.mainTrackerPath);
			if (mainExists) {
				result.push(this.mainTrackerPath);
			}
		}
		
		if (this.docTrackerPath) {
			const docExists = await this.fileService.exists(this.docTrackerPath);
			if (docExists) {
				result.push(this.docTrackerPath);
			}
		}
		
		// Find mini trackers
		// Get code root directories
		const codeRootDirs = this.configurationService.getValue<string[]>(CONFIG_CODE_ROOT_DIRECTORIES) || ['src'];
		
		for (const dir of codeRootDirs) {
			const rootDir = URI.joinPath(this.workspaceRoot, dir);
			try {
				// This is a simplification - actual implementation would need recursive directory traversal
				await this.findMiniTrackers(rootDir, result);
			} catch (error) {
				this.logService.warning(`CRCTService: Error finding mini-trackers in ${rootDir.toString()}: ${error}`);
			}
		}
		
		return result;
	}

	/**
	 * Recursively find mini-tracker files
	 */
	private async findMiniTrackers(dirUri: URI, result: URI[]): Promise<void> {
		try {
			const entries = await this.fileService.resolve(dirUri, { resolveMetadata: true });
			if (!entries.children) {
				return;
			}
			
			for (const entry of entries.children) {
				if (entry.isDirectory) {
					// Recursive call for subdirectories
					await this.findMiniTrackers(entry.resource, result);
				} else if (entry.name.endsWith('_module.md')) {
					// Found a mini-tracker
					result.push(entry.resource);
				}
			}
		} catch (error) {
			this.logService.warning(`CRCTService: Failed to read directory ${dirUri.toString()}: ${error}`);
		}
	}

	/**
	 * Add a dependency between keys
	 */
	async addDependency(
		tracker: URI | string,
		sourceKey: string,
		targetKeys: string[],
		dependencyType: DependencyType
	): Promise<void> {
		const trackerUri = typeof tracker === 'string' ? URI.file(tracker) : tracker;
		
		try {
			// Read tracker file
			const trackerData = await this.trackerIO.readTrackerFile(trackerUri);
			if (!trackerData) {
				throw new Error(localize('crctService.trackerNotFound', "Tracker file not found: {0}", trackerUri.toString()));
			}
			
			// Check if source key exists
			if (!trackerData.keys[sourceKey]) {
				throw new Error(localize('crctService.sourceKeyNotFound', "Source key not found in tracker: {0}", sourceKey));
			}
			
			// Create suggestions in expected format
			const suggestions: Record<string, Array<[string, string]>> = {};
			suggestions[sourceKey] = targetKeys.map(targetKey => [targetKey, dependencyType]);
			
			// Determine if this is a mini-tracker
			const isMiniTracker = trackerUri.path.endsWith('_module.md');
			const trackerType = isMiniTracker ? TrackerType.MINI :
				(trackerUri.path.includes('doc_tracker') ? TrackerType.DOC : TrackerType.MAIN);
			
			// Gather all KeyInfo objects
			const allKeyInfos = new Map<string, KeyInfo>();
			
			// Create file-to-module mapping (placeholder implementation)
			const fileToModule: Record<string, string> = {};
			
			// Update the tracker
			await this.trackerIO.updateTracker(
				trackerUri,
				allKeyInfos,
				trackerType,
				suggestions,
				fileToModule,
				undefined,
				true // Force apply suggestions
			);
			
			// Notify listeners
			this._onDidChangeDependencies.fire();
			
			this.logService.info(
				`CRCTService: Added dependency from ${sourceKey} -> [${targetKeys.join(', ')}] (${dependencyType}) in ${trackerUri.toString()}`
			);
		} catch (error) {
			this.logService.error(`CRCTService: Failed to add dependency: ${error}`);
			throw error;
		}
	}

	/**
	 * Remove a key from a tracker
	 */
	async removeKey(tracker: URI | string, key: string): Promise<void> {
		const trackerUri = typeof tracker === 'string' ? URI.file(tracker) : tracker;
		
		try {
			await this.trackerIO.removeKeyFromTracker(trackerUri, key);
			
			// Notify listeners
			this._onDidChangeDependencies.fire();
			
			this.logService.info(`CRCTService: Removed key ${key} from tracker ${trackerUri.toString()}`);
		} catch (error) {
			this.logService.error(`CRCTService: Failed to remove key: ${error}`);
			throw error;
		}
	}

	/**
	 * Execute the Mandatory Update Protocol
	 */
	async executeMUP(): Promise<void> {
		try {
			// Step 1: Update activeContext.md
			await this.updateActiveContext('');
			
			// Step 2: Update changelog.md
			await this.updateChangelog('Mandatory Update Protocol execution');
			
			// Step 3: Update .clinerules with current phase
			await this.updateClinerules(this._currentPhase);
			
			this.logService.info('CRCTService: MUP completed successfully');
		} catch (error) {
			this.logService.error(`CRCTService: MUP failed: ${error}`);
			throw error;
		}
	}

	/**
	 * Get the current active context
	 */
	async getActiveContext(): Promise<string> {
		if (!this.memoryDir) {
			throw new Error(localize('crctService.noMemoryDir', "Memory directory not set"));
		}
		
		const activeContextPath = URI.joinPath(this.memoryDir, 'activeContext.md');
		
		try {
			const exists = await this.fileService.exists(activeContextPath);
			if (!exists) {
				// Create a default active context
				const defaultContent = `# Active Context\n\n` +
					`## Current Focus\n\n` +
					`- Phase: ${this._currentPhase}\n` +
					`- Task: Initial setup\n\n` +
					`## Recent Activities\n\n` +
					`- System initialization\n\n` +
					`## Next Steps\n\n` +
					`- Complete workspace analysis\n`;
				
				await this.fileService.writeFile(activeContextPath, new TextEncoder().encode(defaultContent));
				return defaultContent;
			}
			
			const content = await this.fileService.readFile(activeContextPath);
			return content.value.toString();
		} catch (error) {
			this.logService.error(`CRCTService: Failed to get active context: ${error}`);
			throw error;
		}
	}

	/**
	 * Update the active context
	 */
	async updateActiveContext(content: string): Promise<void> {
		if (!this.memoryDir) {
			throw new Error(localize('crctService.noMemoryDir', "Memory directory not set"));
		}
		
		const activeContextPath = URI.joinPath(this.memoryDir, 'activeContext.md');
		
		try {
			if (!content) {
				// Generate a default update if no content provided
				const currentContext = await this.getActiveContext();
				
				// Extract sections
				const focusSection = currentContext.match(/## Current Focus\n\n(.*?)(?=##|$)/s)?.[1] || '';
				const activitiesSection = currentContext.match(/## Recent Activities\n\n(.*?)(?=##|$)/s)?.[1] || '';
				const nextStepsSection = currentContext.match(/## Next Steps\n\n(.*?)(?=##|$)/s)?.[1] || '';
				
				// Update sections
				const updatedFocus = `## Current Focus\n\n` +
					`- Phase: ${this._currentPhase}\n` +
					`- Task: Mandatory Update Protocol\n\n`;
				
				const timestamp = new Date().toISOString();
				const updatedActivities = `## Recent Activities\n\n` +
					`- Executed MUP (${timestamp})\n` +
					activitiesSection;
				
				const updatedNextSteps = `## Next Steps\n\n` +
					`- Continue with current tasks\n` +
					nextStepsSection;
				
				// Combine updated sections
				content = `# Active Context\n\n${updatedFocus}${updatedActivities}${updatedNextSteps}`;
			}
			
			// Write updated content
			await this.fileService.writeFile(activeContextPath, new TextEncoder().encode(content));
			
			this.logService.info('CRCTService: Active context updated');
		} catch (error) {
			this.logService.error(`CRCTService: Failed to update active context: ${error}`);
			throw error;
		}
	}

	/**
	 * Update the changelog
	 */
	private async updateChangelog(changeDescription: string): Promise<void> {
		if (!this.memoryDir) {
			throw new Error(localize('crctService.noMemoryDir', "Memory directory not set"));
		}
		
		const changelogPath = URI.joinPath(this.memoryDir, 'changelog.md');
		
		try {
			let content = '';
			const exists = await this.fileService.exists(changelogPath);
			
			if (exists) {
				const fileContent = await this.fileService.readFile(changelogPath);
				content = fileContent.value.toString();
			} else {
				content = `# Changelog\n\n`;
			}
			
			// Add new entry at the top
			const timestamp = new Date().toISOString();
			content = `# Changelog\n\n## ${timestamp}\n\n- ${changeDescription}\n\n` + content.substring(12);
			
			// Write updated content
			await this.fileService.writeFile(changelogPath, new TextEncoder().encode(content));
			
			this.logService.info('CRCTService: Changelog updated');
		} catch (error) {
			this.logService.error(`CRCTService: Failed to update changelog: ${error}`);
			throw error;
		}
	}
}