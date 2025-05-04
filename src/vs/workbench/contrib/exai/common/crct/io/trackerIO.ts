/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { VSBuffer } from 'vs/base/common/buffer';
import { ITrackerIO, KeyInfo, TrackerData, TrackerType } from '../types';
import { Disposable } from 'vs/base/common/lifecycle';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { ICacheManager } from '../types';
import { localize } from 'vs/nls';
import { getExtUri } from 'vs/workbench/contrib/exai/common/utils/uriUtils';
import { IDependencyGridManager } from '../types';
import { IKeyManager } from '../types';

// Constants for extracting tracker data from markdown
const KEY_DEFINITIONS_START_MARKER = '---KEY_DEFINITIONS_START---';
const KEY_DEFINITIONS_END_MARKER = '---KEY_DEFINITIONS_END---';
const GRID_START_MARKER = '---DEPENDENCY_GRID_START---';
const GRID_END_MARKER = '---DEPENDENCY_GRID_END---';
const MINI_TRACKER_START_MARKER = '---mini_tracker_start---';
const MINI_TRACKER_END_MARKER = '---mini_tracker_end---';

/**
 * Implementation of TrackerIO for managing dependency tracker files
 */
export class TrackerIO extends Disposable implements ITrackerIO {
	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		private readonly cacheManager: ICacheManager,
		private readonly dependencyGrid: IDependencyGridManager,
		private readonly keyManager: IKeyManager
	) {
		super();
	}

	/**
	 * Read a tracker file and extract its data
	 */
	async readTrackerFile(path: string | URI): Promise<TrackerData | null> {
		const uri = typeof path === 'string' ? URI.file(path) : path;
		const cacheKey = `tracker_data:${getExtUri(uri)}`;
		
		// Check cache first
		const cachedData = this.cacheManager.get<TrackerData>('tracker_data', cacheKey);
		if (cachedData !== undefined) {
			return cachedData;
		}
		
		try {
			// Check if file exists
			const exists = await this.fileService.exists(uri);
			if (!exists) {
				this.logService.warning(`TrackerIO: Tracker file not found: ${uri.toString()}`);
				return null;
			}
			
			// Read file content
			const content = await this.fileService.readFile(uri);
			const fileContent = content.value.toString();
			
			// Check if this is a mini-tracker (embedded in markdown)
			const isMiniTracker = uri.path.endsWith('_module.md');
			let trackerContent = fileContent;
			
			if (isMiniTracker) {
				const miniStartIndex = fileContent.indexOf(MINI_TRACKER_START_MARKER);
				const miniEndIndex = fileContent.indexOf(MINI_TRACKER_END_MARKER);
				
				if (miniStartIndex === -1 || miniEndIndex === -1 || miniEndIndex <= miniStartIndex) {
					this.logService.warning(`TrackerIO: Mini-tracker markers not found in file: ${uri.toString()}`);
					return null;
				}
				
				// Extract just the mini-tracker section
				trackerContent = fileContent.substring(
					miniStartIndex + MINI_TRACKER_START_MARKER.length,
					miniEndIndex
				);
			}
			
			// Parse the tracker data
			const result = this.parseTrackerContent(trackerContent);
			if (!result) {
				return null;
			}
			
			// Cache the parsed data
			this.cacheManager.set('tracker_data', cacheKey, result, [`file:${getExtUri(uri)}`]);
			return result;
		} catch (error) {
			this.logService.error(`TrackerIO: Error reading tracker file ${uri.toString()}: ${error}`);
			return null;
		}
	}

	/**
	 * Parse the content of a tracker file to extract keys and grid
	 */
	private parseTrackerContent(content: string): TrackerData | null {
		try {
			// Extract key definitions section
			const keyStartIndex = content.indexOf(KEY_DEFINITIONS_START_MARKER);
			const keyEndIndex = content.indexOf(KEY_DEFINITIONS_END_MARKER);
			
			if (keyStartIndex === -1 || keyEndIndex === -1 || keyEndIndex <= keyStartIndex) {
				this.logService.warning('TrackerIO: Key definition markers not found or malformed');
				return null;
			}
			
			const keyDefSection = content.substring(
				keyStartIndex + KEY_DEFINITIONS_START_MARKER.length,
				keyEndIndex
			).trim();
			
			// Extract grid section
			const gridStartIndex = content.indexOf(GRID_START_MARKER);
			const gridEndIndex = content.indexOf(GRID_END_MARKER);
			
			if (gridStartIndex === -1 || gridEndIndex === -1 || gridEndIndex <= gridStartIndex) {
				this.logService.warning('TrackerIO: Grid markers not found or malformed');
				return null;
			}
			
			const gridSection = content.substring(
				gridStartIndex + GRID_START_MARKER.length,
				gridEndIndex
			).trim();
			
			// Parse key definitions
			const keys: Record<string, string> = {};
			const keyLines = keyDefSection.split('\n').filter(line => line.trim() !== '');
			
			for (const line of keyLines) {
				// Look for key: path pattern
				const match = line.match(/^([^:]+):\s*(.+)$/);
				if (match) {
					const [_, key, path] = match;
					keys[key.trim()] = path.trim();
				}
			}
			
			// Parse grid
			const grid: Record<string, string> = {};
			const gridLines = gridSection.split('\n').filter(line => line.trim() !== '');
			
			for (const line of gridLines) {
				// Look for key = compressed_string pattern
				const match = line.match(/^([^=]+)=\s*(.+)$/);
				if (match) {
					const [_, key, compressedRow] = match;
					grid[key.trim()] = compressedRow.trim();
				}
			}
			
			// Extract metadata
			const lastKeyEditMatch = content.match(/Last Key Edit: (.+)/);
			const lastGridEditMatch = content.match(/Last Grid Edit: (.+)/);
			
			const lastKeyEdit = lastKeyEditMatch ? lastKeyEditMatch[1] : '';
			const lastGridEdit = lastGridEditMatch ? lastGridEditMatch[1] : '';
			
			return { keys, grid, lastKeyEdit, lastGridEdit };
		} catch (error) {
			this.logService.error(`TrackerIO: Error parsing tracker content: ${error}`);
			return null;
		}
	}

	/**
	 * Write a tracker file with the provided data
	 */
	async writeTrackerFile(
		path: string | URI,
		keys: Record<string, string>,
		grid: Record<string, string>,
		lastKeyEdit?: string,
		lastGridEdit?: string
	): Promise<boolean> {
		const uri = typeof path === 'string' ? URI.file(path) : path;
		const isMiniTracker = uri.path.endsWith('_module.md');
		
		// Validate that the grid is consistent with keys
		const sortedKeys = Object.keys(keys);
		if (!this.dependencyGrid.validateGrid(grid, sortedKeys)) {
			this.logService.error(`TrackerIO: Grid validation failed for ${uri.toString()}`);
			return false;
		}
		
		try {
			// Format the tracker content
			const currentDate = new Date().toISOString();
			const keyEditTime = lastKeyEdit || currentDate;
			const gridEditTime = lastGridEdit || currentDate;
			
			// Build key definitions section
			let content = `${KEY_DEFINITIONS_START_MARKER}\n`;
			
			// Sort keys for consistent output
			const sortedKeyEntries = Object.entries(keys).sort((a, b) => {
				return this.keyManager.sortKeyStringsHierarchically([a[0], b[0]])[0] === a[0] ? -1 : 1;
			});
			
			for (const [key, path] of sortedKeyEntries) {
				content += `${key}: ${path}\n`;
			}
			content += `${KEY_DEFINITIONS_END_MARKER}\n\n`;
			
			// Add metadata
			content += `Last Key Edit: ${keyEditTime}\n`;
			content += `Last Grid Edit: ${gridEditTime}\n\n`;
			
			// Build grid section
			content += `${GRID_START_MARKER}\n`;
			const sortedRowKeys = Object.keys(grid).sort((a, b) => {
				return this.keyManager.sortKeyStringsHierarchically([a, b])[0] === a ? -1 : 1;
			});
			
			// Format grid for better readability
			for (const key of sortedRowKeys) {
				content += `${key} = ${grid[key]}\n`;
			}
			content += `${GRID_END_MARKER}\n`;
			
			// For mini-trackers, we need to preserve the surrounding content
			if (isMiniTracker) {
				const exists = await this.fileService.exists(uri);
				if (exists) {
					const fileContent = (await this.fileService.readFile(uri)).value.toString();
					const miniStartIndex = fileContent.indexOf(MINI_TRACKER_START_MARKER);
					const miniEndIndex = fileContent.indexOf(MINI_TRACKER_END_MARKER);
					
					if (miniStartIndex !== -1 && miniEndIndex !== -1 && miniEndIndex > miniStartIndex) {
						// Replace just the mini-tracker section
						const beforeTracker = fileContent.substring(0, miniStartIndex + MINI_TRACKER_START_MARKER.length);
						const afterTracker = fileContent.substring(miniEndIndex);
						content = beforeTracker + '\n' + content + afterTracker;
					} else {
						// Append mini-tracker to the end of the file
						content = fileContent + '\n\n' + MINI_TRACKER_START_MARKER + '\n' + content + MINI_TRACKER_END_MARKER + '\n';
					}
				} else {
					// Create new mini-tracker file with surrounding content
					content = `# ${uri.path.split('/').pop()?.replace('_module.md', '')} Module\n\n` +
						`## Overview\n\nModule overview and description goes here.\n\n` +
						`${MINI_TRACKER_START_MARKER}\n${content}${MINI_TRACKER_END_MARKER}\n\n` +
						`## Implementation Details\n\nImplementation details go here.`;
				}
			}
			
			// Write the file
			await this.fileService.writeFile(uri, VSBuffer.fromString(content));
			
			// Invalidate cache for this tracker
			this.cacheManager.invalidateDependentEntries('tracker_data', `tracker_data:${getExtUri(uri)}`);
			
			return true;
		} catch (error) {
			this.logService.error(`TrackerIO: Error writing tracker file ${uri.toString()}: ${error}`);
			return false;
		}
	}

	/**
	 * Update a tracker with new dependencies
	 */
	async updateTracker(
		outputFile: string | URI,
		pathToKeyInfo: Map<string, KeyInfo>,
		trackerType: TrackerType,
		suggestions: Record<string, Array<[string, string]>>,
		fileToModule: Record<string, string>,
		newKeys?: KeyInfo[],
		forceApplySuggestions?: boolean
	): Promise<void> {
		const uri = typeof outputFile === 'string' ? URI.file(outputFile) : outputFile;
		
		try {
			// Determine if this is a new tracker or an existing one
			const exists = await this.fileService.exists(uri);
			let existingData: TrackerData | null = null;
			
			if (exists) {
				existingData = await this.readTrackerFile(uri);
				if (!existingData) {
					this.logService.warning(`TrackerIO: Could not read existing tracker: ${uri.toString()}`);
				}
			}
			
			// Prepare data for the tracker
			const keys: Record<string, string> = {};
			let grid: Record<string, string> = {};
			
			// If we have existing data, use it as a base
			if (existingData) {
				Object.assign(keys, existingData.keys);
				grid = { ...existingData.grid };
			}
			
			// Add any new keys
			if (newKeys && newKeys.length > 0) {
				for (const keyInfo of newKeys) {
					keys[keyInfo.keyString] = keyInfo.normPath;
				}
			}
			
			// Create initial grid if needed
			const allKeys = Object.keys(keys);
			if (Object.keys(grid).length === 0 && allKeys.length > 0) {
				grid = this.dependencyGrid.createInitialGrid(allKeys);
			}
			
			// Apply suggestions
			if (suggestions && Object.keys(suggestions).length > 0) {
				for (const [sourceKey, targetSuggestions] of Object.entries(suggestions)) {
					// Skip if source key is not in the tracker
					if (!keys[sourceKey]) {
						continue;
					}
					
					for (const [targetKey, depType] of targetSuggestions) {
						// For mini-trackers, we need to add foreign keys
						if (trackerType === TrackerType.MINI && !keys[targetKey]) {
							// Add the target key (foreign key) to the tracker
							const targetKeyInfo = Array.from(pathToKeyInfo.values())
								.find(info => info.keyString === targetKey);
							
							if (targetKeyInfo) {
								keys[targetKey] = targetKeyInfo.normPath;
								
								// We need to update the grid to include this new key
								const keysWithNew = Object.keys(keys);
								grid = this.dependencyGrid.createInitialGrid(keysWithNew);
							} else {
								this.logService.warning(
									`TrackerIO: Cannot add foreign key ${targetKey} to mini-tracker ${uri.toString()} - key not found in global map`
								);
								continue;
							}
						}
						
						// Apply the suggestion only if both keys are now in the tracker
						if (keys[sourceKey] && keys[targetKey]) {
							// Update the grid
							grid = this.dependencyGrid.addDependencyToGrid(
								grid,
								sourceKey,
								targetKey,
								Object.keys(keys),
								depType as any
							);
						}
					}
				}
			}
			
			// Write the updated tracker
			const lastKeyEdit = new Date().toISOString();
			const lastGridEdit = `Applied ${Object.keys(suggestions).length} suggestions with ${forceApplySuggestions ? 'force' : 'normal'} mode`;
			
			await this.writeTrackerFile(uri, keys, grid, lastKeyEdit, lastGridEdit);
		} catch (error) {
			this.logService.error(`TrackerIO: Error updating tracker ${uri.toString()}: ${error}`);
			throw error;
		}
	}

	/**
	 * Remove a key from a tracker
	 */
	async removeKeyFromTracker(trackerPath: string | URI, key: string): Promise<void> {
		const uri = typeof trackerPath === 'string' ? URI.file(trackerPath) : trackerPath;
		
		try {
			// Read existing tracker
			const trackerData = await this.readTrackerFile(uri);
			if (!trackerData) {
				throw new Error(localize('trackerIO.trackerNotFound', "Tracker file not found or invalid: {0}", uri.toString()));
			}
			
			// Check if key exists
			if (!trackerData.keys[key]) {
				throw new Error(localize('trackerIO.keyNotFound', "Key {0} not found in tracker {1}", key, uri.toString()));
			}
			
			// Create updated keys and grid
			const updatedKeys = { ...trackerData.keys };
			delete updatedKeys[key];
			
			const remainingKeys = Object.keys(updatedKeys);
			
			// If there are no keys left, create an empty grid
			let updatedGrid: Record<string, string> = {};
			if (remainingKeys.length > 0) {
				// Create a fresh grid with the remaining keys
				updatedGrid = this.dependencyGrid.createInitialGrid(remainingKeys);
				
				// Copy over existing dependencies for remaining keys
				for (const rowKey of remainingKeys) {
					if (trackerData.grid[rowKey]) {
						const oldRow = this.dependencyGrid.decompress(trackerData.grid[rowKey]);
						const newRow = new Array(remainingKeys.length).fill('p');
						
						// Set diagonal element
						const diagIndex = remainingKeys.indexOf(rowKey);
						newRow[diagIndex] = 'o';
						
						// Copy dependencies from old row
						for (let colIdx = 0; colIdx < remainingKeys.length; colIdx++) {
							const colKey = remainingKeys[colIdx];
							const oldColIdx = Object.keys(trackerData.keys).indexOf(colKey);
							
							if (oldColIdx !== -1 && oldColIdx < oldRow.length) {
								// Only copy if not diagonal (which we already set to 'o')
								if (diagIndex !== colIdx) {
									newRow[colIdx] = oldRow[oldColIdx];
								}
							}
						}
						
						updatedGrid[rowKey] = this.dependencyGrid.compress(newRow.join(''));
					}
				}
			}
			
			// Update the tracker
			const lastKeyEdit = `Removed key: ${key}`;
			const lastGridEdit = `Updated grid after removing key: ${key}`;
			
			await this.writeTrackerFile(uri, updatedKeys, updatedGrid, lastKeyEdit, lastGridEdit);
		} catch (error) {
			this.logService.error(`TrackerIO: Error removing key from tracker: ${error}`);
			throw error;
		}
	}

	/**
	 * Merge two trackers
	 */
	async mergeTrackers(
		primaryTrackerPath: string | URI,
		secondaryTrackerPath: string | URI,
		outputPath?: string | URI
	): Promise<TrackerData | null> {
		const primaryUri = typeof primaryTrackerPath === 'string' ? URI.file(primaryTrackerPath) : primaryTrackerPath;
		const secondaryUri = typeof secondaryTrackerPath === 'string' ? URI.file(secondaryTrackerPath) : secondaryTrackerPath;
		const outputUri = outputPath ? (typeof outputPath === 'string' ? URI.file(outputPath) : outputPath) : primaryUri;
		
		try {
			// Read both tracker files
			const primaryData = await this.readTrackerFile(primaryUri);
			const secondaryData = await this.readTrackerFile(secondaryUri);
			
			if (!primaryData) {
				throw new Error(localize('trackerIO.primaryTrackerNotFound', "Primary tracker not found or invalid: {0}", primaryUri.toString()));
			}
			
			if (!secondaryData) {
				throw new Error(localize('trackerIO.secondaryTrackerNotFound', "Secondary tracker not found or invalid: {0}", secondaryUri.toString()));
			}
			
			// Merge keys (primary takes precedence)
			const mergedKeys = { ...secondaryData.keys, ...primaryData.keys };
			const allKeys = Object.keys(mergedKeys);
			
			// Create a new grid with all keys
			let mergedGrid = this.dependencyGrid.createInitialGrid(allKeys);
			
			// Helper to get character at a position in a compressed row
			const getCharOrEmpty = (grid: Record<string, string>, rowKey: string, colKey: string, allGridKeys: string[]): string => {
				if (!grid[rowKey]) {
					return 'p'; // Default placeholder
				}
				
				const colIdx = allGridKeys.indexOf(colKey);
				if (colIdx === -1) {
					return 'p';
				}
				
				try {
					return this.dependencyGrid.getCharAt(grid[rowKey], colIdx);
				} catch (error) {
					return 'p';
				}
			};
			
			// Merge grid data (prioritizing primary)
			for (const rowKey of allKeys) {
				for (const colKey of allKeys) {
					if (rowKey === colKey) {
						continue; // Skip diagonal elements
					}
					
					// Get characters from both grids
					const primaryChar = getCharOrEmpty(primaryData.grid, rowKey, colKey, Object.keys(primaryData.keys));
					const secondaryChar = getCharOrEmpty(secondaryData.grid, rowKey, colKey, Object.keys(secondaryData.keys));
					
					// Prioritize non-placeholder values
					if (primaryChar !== 'p') {
						// Apply primary character
						mergedGrid = this.dependencyGrid.addDependencyToGrid(
							mergedGrid,
							rowKey,
							colKey,
							allKeys,
							primaryChar as any
						);
					} else if (secondaryChar !== 'p') {
						// Apply secondary character if primary is placeholder
						mergedGrid = this.dependencyGrid.addDependencyToGrid(
							mergedGrid,
							rowKey,
							colKey,
							allKeys,
							secondaryChar as any
						);
					}
				}
			}
			
			// Write merged tracker
			const lastKeyEdit = `Merged from ${primaryUri.path} and ${secondaryUri.path}`;
			const lastGridEdit = `Merged grid from ${primaryUri.path} and ${secondaryUri.path}`;
			
			await this.writeTrackerFile(outputUri, mergedKeys, mergedGrid, lastKeyEdit, lastGridEdit);
			
			// Return the merged data
			return { keys: mergedKeys, grid: mergedGrid, lastKeyEdit, lastGridEdit };
		} catch (error) {
			this.logService.error(`TrackerIO: Error merging trackers: ${error}`);
			return null;
		}
	}

	/**
	 * Export a tracker to another format
	 */
	async exportTracker(
		trackerPath: string | URI,
		format: 'json' | 'csv' | 'dot',
		outputPath?: string | URI
	): Promise<string | null> {
		const uri = typeof trackerPath === 'string' ? URI.file(trackerPath) : trackerPath;
		
		try {
			// Read tracker file
			const trackerData = await this.readTrackerFile(uri);
			if (!trackerData) {
				return localize('trackerIO.trackerNotFoundForExport', "Error: Tracker file not found or invalid: {0}", uri.toString());
			}
			
			// Generate output content based on format
			let output = '';
			const keys = Object.keys(trackerData.keys);
			
			switch (format) {
				case 'json':
					output = JSON.stringify(trackerData, null, 2);
					break;
					
				case 'csv':
					// Header row
					output = 'Source,Target,Relation\n';
					
					// Add rows for each dependency
					for (const rowKey of keys) {
						const deps = this.dependencyGrid.getDependenciesFromGrid(trackerData.grid, rowKey, keys);
						
						for (const [depType, targetKeys] of Object.entries(deps)) {
							if (!targetKeys || targetKeys.length === 0) {
								continue;
							}
							
							for (const targetKey of targetKeys) {
								output += `${rowKey},${targetKey},${depType}\n`;
							}
						}
					}
					break;
					
				case 'dot':
					// Generate a DOT file for GraphViz visualization
					output = 'digraph Dependencies {\n';
					output += '  // Node definitions\n';
					
					// Define nodes (with path as label)
					for (const key of keys) {
						const path = trackerData.keys[key];
						output += `  "${key}" [label="${key}\\n${path}"]\n`;
					}
					
					output += '\n  // Edge definitions\n';
					
					// Define edges for dependencies
					for (const rowKey of keys) {
						const deps = this.dependencyGrid.getDependenciesFromGrid(trackerData.grid, rowKey, keys);
						
						// Define edges for each dependency type
						for (const [depType, targetKeys] of Object.entries(deps)) {
							if (!targetKeys || targetKeys.length === 0) {
								continue;
							}
							
							let style = 'solid';
							let color = 'black';
							let dir = 'forward';
							
							// Set edge style based on dependency type
							switch (depType) {
								case '>':
									// rowKey depends on targetKey
									style = 'solid';
									color = 'blue';
									break;
								case '<':
									// targetKey depends on rowKey
									style = 'solid';
									color = 'green';
									dir = 'back';
									break;
								case 'x':
									// Mutual dependency
									style = 'solid';
									color = 'red';
									dir = 'both';
									break;
								case 'd':
									// Documentation dependency
									style = 'dashed';
									color = 'purple';
									break;
								case 's':
									// Weak semantic dependency
									style = 'dotted';
									color = 'orange';
									break;
								case 'S':
									// Strong semantic dependency
									style = 'dashed';
									color = 'orange';
									break;
								case 'p':
									// Placeholder (suggested dependency)
									style = 'dotted';
									color = 'gray';
									break;
							}
							
							for (const targetKey of targetKeys) {
								if (depType === '<') {
									// Reverse the direction for '<' to make the visualization clearer
									output += `  "${targetKey}" -> "${rowKey}" [style=${style}, color=${color}, label="${depType}"]\n`;
								} else {
									output += `  "${rowKey}" -> "${targetKey}" [style=${style}, color=${color}, dir=${dir}, label="${depType}"]\n`;
								}
							}
						}
					}
					
					output += '}\n';
					break;
			}
			
			// Write to output file if specified
			if (outputPath) {
				const outUri = typeof outputPath === 'string' ? URI.file(outputPath) : outputPath;
				await this.fileService.writeFile(outUri, VSBuffer.fromString(output));
				return localize('trackerIO.exportSuccess', "Tracker exported to {0}", outUri.toString());
			}
			
			// Return the content as a string
			return output;
		} catch (error) {
			this.logService.error(`TrackerIO: Error exporting tracker: ${error}`);
			return null;
		}
	}
}