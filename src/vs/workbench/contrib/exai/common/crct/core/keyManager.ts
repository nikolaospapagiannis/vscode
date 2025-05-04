/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IKeyManager, KeyInfo } from '../types';
import { Disposable } from 'vs/base/common/lifecycle';
import { VSBuffer } from 'vs/base/common/buffer';
import { localize } from 'vs/nls';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { getExtUri } from 'vs/workbench/contrib/exai/common/utils/uriUtils';
import { isWindows } from 'vs/base/common/platform';
import { ICacheManager } from '../types';

/**
 * Unicode code points for character operations
 */
const ASCII = {
	A_UPPER: 65,   // ASCII value for 'A'
	Z_UPPER: 90,   // ASCII value for 'Z'
	A_LOWER: 97,   // ASCII value for 'a'
	Z_LOWER: 122,  // ASCII value for 'z'
};

/**
 * RegExp pattern for hierarchical keys
 */
const HIERARCHICAL_KEY_PATTERN = /^[1-9]\d*[A-Z](?:[a-z](?:[1-9]\d*)?|[1-9]\d*)?$/;

/**
 * Pattern for splitting keys into sortable parts (numbers and non-numbers)
 */
const KEY_PATTERN = /\d+|\D+/g;

/**
 * Custom error type for key generation failures
 */
export class KeyGenerationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'KeyGenerationError';
	}
}

/**
 * Implementation of the key manager that handles hierarchical key generation
 * and management for the dependency tracking system
 */
export class KeyManager extends Disposable implements IKeyManager {
	private globalKeyMapUri: URI | undefined;
	private oldGlobalKeyMapUri: URI | undefined;
	private globalKeyMap: Map<string, KeyInfo> = new Map();
	
	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		private readonly cacheManager: ICacheManager
	) {
		super();
	}

	/**
	 * Initialize the key manager with storage locations
	 */
	async initialize(storageDir: URI): Promise<void> {
		this.globalKeyMapUri = URI.joinPath(storageDir, 'global_key_map.json');
		this.oldGlobalKeyMapUri = URI.joinPath(storageDir, 'global_key_map_old.json');
		
		try {
			await this.loadGlobalKeyMap();
		} catch (error) {
			this.logService.error('KeyManager: Failed to load global key map', error);
		}
	}

	/**
	 * Normalize a file path for consistency across platforms
	 */
	normalizePath(path: string | URI): string {
		const uriPath = path instanceof URI ? path : URI.file(path);
		// Ensure consistent treatment of paths across platforms
		return getExtUri(uriPath).toString().replace(/\\/g, '/');
	}

	/**
	 * Generate keys for a set of paths
	 */
	async generateKeys(
		rootPaths: string[] | URI[],
		excludedDirs?: Set<string>,
		excludedExtensions?: Set<string>,
		precomputedExcludedPaths?: Set<string>
	): Promise<{ pathToKeyInfo: Map<string, KeyInfo>; newKeys: KeyInfo[] }> {
		// Normalize root paths to strings
		const normalizedRootPaths = rootPaths.map(p => this.normalizePath(p));
		
		// Validate root paths
		for (const rootPath of normalizedRootPaths) {
			const rootExists = await this.fileService.exists(URI.parse(rootPath));
			if (!rootExists) {
				throw new Error(localize('keyManager.rootNotFound', "Root path '{0}' does not exist", rootPath));
			}
		}
		
		// Initialize tracking variables
		const pathToKeyInfo = new Map<string, KeyInfo>();
		const newlyGeneratedKeys: KeyInfo[] = [];
		let topLevelDirCount = 0;
		
		// Create a set of excluded paths
		const exclusionSet = new Set<string>();
		if (precomputedExcludedPaths) {
			for (const path of precomputedExcludedPaths) {
				exclusionSet.add(this.normalizePath(path));
			}
		}
		
		// Process each root directory
		for (const rootPath of normalizedRootPaths) {
			await this.processDirectory(
				URI.parse(rootPath),
				exclusionSet,
				null, // No parent for top-level directories
				pathToKeyInfo,
				newlyGeneratedKeys,
				topLevelDirCount,
				excludedDirs,
				excludedExtensions
			);
			
			topLevelDirCount++;
		}
		
		// Save the generated map
		await this.saveGlobalKeyMap(pathToKeyInfo);
		
		// Return unique new keys (removing any duplicates)
		const uniqueNewKeys = Array.from(new Map(newlyGeneratedKeys.map(k => [k.keyString, k])).values());
		
		return { pathToKeyInfo, newKeys: uniqueNewKeys };
	}

	/**
	 * Recursively process a directory to generate keys
	 */
	private async processDirectory(
		dirUri: URI,
		exclusionSet: Set<string>,
		parentInfo: KeyInfo | null,
		pathToKeyInfo: Map<string, KeyInfo>,
		newlyGeneratedKeys: KeyInfo[],
		topLevelDirIndex: number,
		excludedDirNames?: Set<string>,
		excludedExtensions?: Set<string>
	): Promise<void> {
		const normalizedDirPath = this.normalizePath(dirUri);
		
		// Skip excluded directories
		if (exclusionSet.has(normalizedDirPath)) {
			this.logService.debug(`KeyManager: Skipping excluded dir path: '${normalizedDirPath}'`);
			return;
		}
		
		// Assign key to the current directory
		let currentDirKeyInfo: KeyInfo | undefined;
		
		if (!parentInfo) {
			// This is a top-level directory from root_paths
			const dirLetter = String.fromCharCode(ASCII.A_UPPER + topLevelDirIndex);
			const keyString = `1${dirLetter}`;
			const currentTier = 1;
			
			currentDirKeyInfo = {
				keyString,
				normPath: normalizedDirPath,
				parentPath: null,
				tier: currentTier,
				isDirectory: true
			};
			
			// Store immediately so it's available if needed later
			if (!pathToKeyInfo.has(normalizedDirPath)) {
				pathToKeyInfo.set(normalizedDirPath, currentDirKeyInfo);
				newlyGeneratedKeys.push(currentDirKeyInfo);
				this.logService.debug(`KeyManager: Assigned key '${currentDirKeyInfo.keyString}' to directory '${normalizedDirPath}'`);
			} else {
				this.logService.warning(`KeyManager: Top-level directory '${normalizedDirPath}' seems to be processed more than once.`);
				currentDirKeyInfo = pathToKeyInfo.get(normalizedDirPath);
			}
		} else {
			// This is a subdirectory; its key was generated when processing parent
			currentDirKeyInfo = pathToKeyInfo.get(normalizedDirPath);
			if (!currentDirKeyInfo) {
				// This indicates a potential logic flaw
				this.logService.error(
					`KeyManager: CRITICAL LOGIC ERROR: KeyInfo not found for directory '${normalizedDirPath}' ` +
					`which should have been generated by its parent '${parentInfo?.normPath ?? 'None'}'. Halting.`
				);
				throw new KeyGenerationError(`KeyInfo missing for supposedly processed directory: ${normalizedDirPath}`);
			}
		}
		
		// Read directory entries
		try {
			const dirEntries = await this.fileService.resolve(dirUri, { resolveMetadata: true });
			if (!dirEntries.children) {
				this.logService.warning(`KeyManager: No children found in directory: ${normalizedDirPath}`);
				return;
			}
			
			// Sort entries by name for consistent results
			const items = dirEntries.children.sort((a, b) => a.name.localeCompare(b.name));
			
			// Initialize counters for THIS level
			let fileCounter = 1;
			let subdirLetterOrd = ASCII.A_LOWER;
			let promotedDirOrd = ASCII.A_UPPER;
			
			// Determine if current directory key represents a subdirectory level
			const parentKeyString = currentDirKeyInfo.keyString;
			// Regex matching Tier + Upper + Lower pattern (no file number allowed here)
			const isParentKeyASubdir = Boolean(parentKeyString && /^[1-9]\d*[A-Z][a-z]$/.test(parentKeyString));
			
			this.logService.debug(
				`KeyManager: Processing items in: '${normalizedDirPath}' ` +
				`(Key: ${parentKeyString}, Is Subdir Key: ${isParentKeyASubdir})`
			);
			
			// Process each item in the directory
			for (const item of items) {
				const itemUri = item.resource;
				const normalizedItemPath = this.normalizePath(itemUri);
				const isDir = item.isDirectory;
				const isFile = !isDir;
				
				// Skip items in exclusion set
				if (exclusionSet.has(normalizedItemPath)) {
					this.logService.debug(`KeyManager: Skipping excluded item path: '${normalizedItemPath}'`);
					continue;
				}
				
				// Skip excluded directory names
				if (excludedDirNames && excludedDirNames.has(item.name)) {
					this.logService.debug(`KeyManager: Skipping excluded dir name '${item.name}' in '${normalizedDirPath}'`);
					continue;
				}
				
				// Skip mini-tracker files
				if (item.name.endsWith('_module.md')) {
					this.logService.debug(`KeyManager: Skipping mini-tracker '${item.name}' in '${normalizedDirPath}'`);
					continue;
				}
				
				// Check extension exclusion for files
				if (isFile && excludedExtensions) {
					const extension = item.name.substring(item.name.lastIndexOf('.') + 1).toLowerCase();
					if (excludedExtensions.has(extension)) {
						this.logService.debug(
							`KeyManager: Skipping file '${item.name}' with extension '${extension}' in '${normalizedDirPath}'`
						);
						continue;
					}
				}
				
				// Key Generation Logic
				let itemKeyInfo: KeyInfo | undefined;
				
				// Determine parent context
				const needsPromotion = isParentKeyASubdir && isDir;
				
				if (needsPromotion) {
					// --- Tier Promotion (triggered only by sub-subdirectory) ---
					if (!parentKeyString) {
						// Should be impossible if needsPromotion is true
						this.logService.error(`KeyManager: Logic Error: Promotion needed but parent key string is missing for item '${item.name}'`);
						continue;
					}
					
					const [parsedParentTier] = this.parseKey(parentKeyString);
					if (parsedParentTier === undefined) {
						this.logService.error(
							`KeyManager: Logic Error: Could not parse parent key '${parentKeyString}' during promotion for DIR item '${item.name}'`
						);
						continue;
					}
					
					const newTier = parsedParentTier + 1;
					
					// Check limit before assigning character
					if (promotedDirOrd > ASCII.Z_UPPER) {
						const errorMsg = 
							`Key generation failed: Exceeded maximum supported subdirectories (26, 'A'-'Z') requiring promotion ` +
							`within parent directory key '${parentKeyString}' (path: '${normalizedDirPath}'). ` +
							`Problematic item: '${item.name}' (path: '${normalizedItemPath}'). ` +
							`Please reduce the number of direct subdirectories needing keys at this level ` +
							`or add problematic paths to exclusions.`;
						this.logService.error(errorMsg);
						throw new KeyGenerationError(errorMsg);
					}
					
					// Use promoted_dir_ord, reset to 'A' for first one
					const newDirLetter = String.fromCharCode(promotedDirOrd);
					promotedDirOrd++; // Increment for next promoted dir
					
					// Key for the promoted directory itself (e.g., 2A)
					const keyString = `${newTier}${newDirLetter}`;
					
					this.logService.debug(`KeyManager: Promoting DIR '${item.name}': parent '${parentKeyString}' -> new key '${keyString}'`);
					
					// is_dir is always true in this block now
					itemKeyInfo = {
						keyString,
						normPath: normalizedItemPath,
						parentPath: normalizedDirPath,
						tier: newTier,
						isDirectory: true
					};
				} else {
					// --- Standard Key Assignment ---
					if (!currentDirKeyInfo) {
						this.logService.error(`KeyManager: Logic Error: Missing currentDirKeyInfo for non-promotion case of item '${item.name}'`);
						continue;
					}
					
					const baseKeyPart = currentDirKeyInfo.keyString;
					const currentTier = currentDirKeyInfo.tier;
					
					if (isDir) {
						// Assign standard subdirectory key (e.g., 1Bb, 1Bc)
						// Check limit before assigning character
						if (subdirLetterOrd > ASCII.Z_LOWER) {
							const errorMsg = 
								`Key generation failed: Exceeded maximum supported subdirectories (26, 'a'-'z') ` +
								`within parent directory key '${baseKeyPart}' (path: '${normalizedDirPath}'). ` +
								`Problematic item: '${item.name}' (path: '${normalizedItemPath}'). ` +
								`Please reduce the number of direct subdirectories needing keys at this level ` +
								`or add problematic paths to exclusions.`;
							this.logService.error(errorMsg);
							throw new KeyGenerationError(errorMsg);
						}
						
						const subdirLetter = String.fromCharCode(subdirLetterOrd);
						const keyString = `${baseKeyPart}${subdirLetter}`;
						subdirLetterOrd++;
						
						this.logService.debug(
							`KeyManager: Assigning standard subdir key '${keyString}' ` +
							`for DIR item '${item.name}' under parent '${baseKeyPart}'`
						);
						
						itemKeyInfo = {
							keyString,
							normPath: normalizedItemPath,
							parentPath: normalizedDirPath,
							tier: currentTier,
							isDirectory: true
						};
					} else {
						// Assign standard file key (e.g., 1B1, 1Ba1, 1Ba2)
						const keyString = `${baseKeyPart}${fileCounter}`;
						fileCounter++;
						
						this.logService.debug(
							`KeyManager: Assigning standard file key '${keyString}' ` +
							`for FILE item '${item.name}' under parent '${baseKeyPart}'`
						);
						
						itemKeyInfo = {
							keyString,
							normPath: normalizedItemPath,
							parentPath: normalizedDirPath,
							tier: currentTier,
							isDirectory: false
						};
					}
				}
				
				// Validate, Store Key and Recurse
				if (itemKeyInfo) {
					if (this.validateKey(itemKeyInfo.keyString)) {
						if (pathToKeyInfo.has(normalizedItemPath)) {
							// This might happen if a directory is listed in root_paths AND is a subdirectory of another root_path
							this.logService.warning(
								`KeyManager: Path '${normalizedItemPath}' already has an assigned key ` +
								`'${pathToKeyInfo.get(normalizedItemPath)?.keyString}'. ` +
								`Overwriting with new key '${itemKeyInfo.keyString}'. ` +
								`Check root_paths/exclusions if unexpected.`
							);
						}
						
						pathToKeyInfo.set(normalizedItemPath, itemKeyInfo);
						newlyGeneratedKeys.push(itemKeyInfo);
						
						if (isDir) {
							// Recurse with the newly generated key info
							await this.processDirectory(
								itemUri,
								exclusionSet,
								itemKeyInfo,
								pathToKeyInfo,
								newlyGeneratedKeys,
								topLevelDirIndex,
								excludedDirNames,
								excludedExtensions
							);
						}
					} else {
						this.logService.error(
							`KeyManager: Generated key '${itemKeyInfo.keyString}' for path '${normalizedItemPath}' ` +
							`is invalid according to pattern '${HIERARCHICAL_KEY_PATTERN}'. ` +
							`Skipping item and its children.`
						);
					}
				}
			}
		} catch (error) {
			if (error instanceof KeyGenerationError) {
				throw error; // Re-throw critical errors
			}
			this.logService.error(`KeyManager: Failed to process directory '${normalizedDirPath}': ${error}`);
		}
	}

	/**
	 * Parse a key into its components
	 */
	private parseKey(keyString: string | undefined): [number?, string?, string?] {
		if (!keyString || !this.validateKey(keyString)) return [undefined, undefined, undefined];
		
		// Match keys with subdir first (e.g., 1Aa, 1Aa12)
		let match = /^([1-9]\d*)([A-Z])([a-z])/.exec(keyString);
		if (match) {
			const [_, tierStr, dirLetter, subdirLetter] = match;
			return [parseInt(tierStr, 10), dirLetter, subdirLetter];
		}
		
		// Handle case like "1A", "1A1" (no subdir letter)
		match = /^([1-9]\d*)([A-Z])/.exec(keyString);
		if (match) {
			const [_, tierStr, dirLetter] = match;
			return [parseInt(tierStr, 10), dirLetter, undefined];
		}
		
		this.logService.warning(`KeyManager: Could not parse valid key: ${keyString}`);
		return [undefined, undefined, undefined];
	}

	/**
	 * Validate if a key follows the hierarchical key format
	 */
	validateKey(key: string): boolean {
		if (!key) return false;
		return HIERARCHICAL_KEY_PATTERN.test(key);
	}

	/**
	 * Get the key for a path
	 */
	async getKeyFromPath(path: string | URI): Promise<string | undefined> {
		const normalizedPath = this.normalizePath(path);
		const keyInfo = this.globalKeyMap.get(normalizedPath);
		return keyInfo?.keyString;
	}

	/**
	 * Get the path for a key
	 */
	async getPathFromKey(keyString: string, contextPath?: string | URI): Promise<string | undefined> {
		// Find all KeyInfo objects matching this key string
		const matchingInfos = Array.from(this.globalKeyMap.values())
			.filter(info => info.keyString === keyString);
		
		if (matchingInfos.length === 0) {
			this.logService.debug(`KeyManager: Key string '${keyString}' not found in global key map.`);
			return undefined;
		}
		
		if (matchingInfos.length === 1) {
			return matchingInfos[0].normPath;
		}
		
		// Ambiguous key - requires context
		if (contextPath) {
			const normalizedContextPath = this.normalizePath(contextPath);
			
			// Look for a match whose parent_path matches the context_path
			for (const info of matchingInfos) {
				if (info.parentPath && this.normalizePath(info.parentPath) === normalizedContextPath) {
					this.logService.debug(
						`KeyManager: Resolved ambiguous key '${keyString}' using context '${normalizedContextPath}' to path '${info.normPath}'`
					);
					return info.normPath;
				}
			}
			
			this.logService.warning(
				`KeyManager: Ambiguous key '${keyString}' found. Context path '${normalizedContextPath}' provided, ` +
				`but no direct child match found among ${matchingInfos.length} possibilities: ` +
				`${matchingInfos.map(i => i.normPath).join(', ')}`
			);
		} else {
			this.logService.warning(
				`KeyManager: Ambiguous key '${keyString}' found. Multiple paths match: ` +
				`${matchingInfos.map(i => i.normPath).join(', ')}. Provide context_path for disambiguation.`
			);
		}
		
		return undefined;
	}

	/**
	 * Sort keys hierarchically
	 */
	sortKeyStringsHierarchically(keys: string[]): string[] {
		// Filter out potential None or non-string elements before sorting
		const validKeys = keys.filter(k => typeof k === 'string' && k);
		
		return validKeys.sort((a, b) => {
			const partsA = a.match(KEY_PATTERN) || [];
			const partsB = b.match(KEY_PATTERN) || [];
			
			const convertedA = partsA.map(p => /^\d+$/.test(p) ? parseInt(p, 10) : p);
			const convertedB = partsB.map(p => /^\d+$/.test(p) ? parseInt(p, 10) : p);
			
			// Compare part by part
			const minLength = Math.min(convertedA.length, convertedB.length);
			for (let i = 0; i < minLength; i++) {
				if (convertedA[i] < convertedB[i]) return -1;
				if (convertedA[i] > convertedB[i]) return 1;
			}
			
			// If all compared parts are equal, shorter key comes first
			return convertedA.length - convertedB.length;
		});
	}

	/**
	 * Load the global key map from storage
	 */
	private async loadGlobalKeyMap(): Promise<void> {
		if (!this.globalKeyMapUri) {
			throw new Error(localize('keyManager.noMapUri', "Global key map URI not initialized"));
		}
		
		try {
			const exists = await this.fileService.exists(this.globalKeyMapUri);
			if (!exists) {
				this.logService.info(`KeyManager: Global key map file not found at ${this.globalKeyMapUri.toString()}`);
				return;
			}
			
			const content = await this.fileService.readFile(this.globalKeyMapUri);
			const loadedData = JSON.parse(content.value.toString());
			
			this.globalKeyMap.clear();
			for (const [path, infoObj] of Object.entries(loadedData)) {
				// Ensure we have all required fields
				const info = infoObj as any;
				if (!info.keyString || !info.normPath) {
					this.logService.warning(`KeyManager: Skipping invalid key info for path '${path}'`);
					continue;
				}
				
				this.globalKeyMap.set(path, {
					keyString: info.keyString,
					normPath: info.normPath,
					parentPath: info.parentPath || null,
					tier: info.tier || 1,
					isDirectory: Boolean(info.isDirectory)
				});
			}
			
			this.logService.info(
				`KeyManager: Successfully loaded global key map (${this.globalKeyMap.size} entries) from: ${this.globalKeyMapUri.toString()}`
			);
		} catch (error) {
			this.logService.error(`KeyManager: Error loading global key map: ${error}`);
			throw error;
		}
	}

	/**
	 * Save the global key map to storage
	 */
	private async saveGlobalKeyMap(pathToKeyInfo: Map<string, KeyInfo>): Promise<void> {
		if (!this.globalKeyMapUri || !this.oldGlobalKeyMapUri) {
			throw new Error(localize('keyManager.noMapUri', "Global key map URI not initialized"));
		}
		
		try {
			// Step 1: Move current map to old (if it exists)
			const currentExists = await this.fileService.exists(this.globalKeyMapUri);
			if (currentExists) {
				await this.fileService.copy(this.globalKeyMapUri, this.oldGlobalKeyMapUri, true);
				this.logService.info(
					`KeyManager: Renamed existing global key map to: ${this.oldGlobalKeyMapUri.toString()}`
				);
			}
			
			// Step 2: Save new map
			const serializableMap: Record<string, Record<string, any>> = {};
			for (const [path, info] of pathToKeyInfo.entries()) {
				serializableMap[path] = {
					keyString: info.keyString,
					normPath: info.normPath,
					parentPath: info.parentPath,
					tier: info.tier,
					isDirectory: info.isDirectory
				};
			}
			
			const content = JSON.stringify(serializableMap, null, 2);
			await this.fileService.writeFile(
				this.globalKeyMapUri,
				VSBuffer.fromString(content)
			);
			
			// Update the in-memory map
			this.globalKeyMap = new Map(pathToKeyInfo);
			
			this.logService.info(
				`KeyManager: Successfully saved new global key map (${pathToKeyInfo.size} entries) to: ${this.globalKeyMapUri.toString()}`
			);
		} catch (error) {
			this.logService.error(`KeyManager: Error saving global key map: ${error}`);
			throw error;
		}
	}
}