/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DependencyType, IDependencyGridManager } from '../types';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ICacheManager } from '../types';
import { localize } from 'vs/nls';

// Constants
const DIAGONAL_CHAR = 'o';
const PLACEHOLDER_CHAR = 'p';
const EMPTY_CHAR = '.';

// Compile regex pattern for RLE compression (repeating characters, excluding 'o')
const COMPRESSION_PATTERN = /([^o])\1{2,}/g;

/**
 * DependencyGrid manages the grid representation of dependencies between keys
 * using Run-Length Encoding (RLE) for compression
 */
export class DependencyGrid extends Disposable implements IDependencyGridManager {
	constructor(
		@ILogService private readonly logService: ILogService,
		private readonly cacheManager: ICacheManager
	) {
		super();
	}

	/**
	 * Compress a dependency string using Run-Length Encoding (RLE)
	 * Only compresses sequences of 3 or more repeating characters (excluding 'o')
	 */
	compress(s: string): string {
		if (!s || s.length <= 3) {
			return s;
		}
		
		return s.replace(COMPRESSION_PATTERN, (match, char) => char + match.length);
	}

	/**
	 * Decompress a Run-Length Encoded dependency string
	 */
	decompress(s: string): string {
		// Cache key for decompress operations
		const cacheKey = `decompress:${s}`;
		const cachedResult = this.cacheManager.get<string>('grid_decompress', cacheKey);
		if (cachedResult !== undefined) {
			return cachedResult;
		}
		
		if (!s || (s.length <= 3 && !/\d/.test(s))) {
			return s;
		}
		
		const result: string[] = [];
		let i = 0;
		
		while (i < s.length) {
			if (i + 1 < s.length && /\d/.test(s[i + 1])) {
				const char = s[i];
				let j = i + 1;
				
				// Extract the number
				while (j < s.length && /\d/.test(s[j])) {
					j++;
				}
				
				const count = parseInt(s.substring(i + 1, j), 10);
				result.push(char.repeat(count));
				i = j;
			} else {
				result.push(s[i]);
				i++;
			}
		}
		
		const decompressed = result.join('');
		this.cacheManager.set('grid_decompress', cacheKey, decompressed);
		return decompressed;
	}

	/**
	 * Get the character at a specific index in a compressed string
	 */
	getCharAt(s: string, index: number): string {
		if (!s) {
			throw new Error(localize('dependencyGrid.emptyString', "Cannot get character from empty string"));
		}
		
		// For short strings or direct access, decompress and get the char
		if (s.length <= 3 || !s.match(/\d/)) {
			if (index >= s.length) {
				throw new Error(localize('dependencyGrid.indexOutOfRange', "Index out of range"));
			}
			return s[index];
		}
		
		const decompressed = this.decompress(s);
		if (index >= decompressed.length) {
			throw new Error(localize('dependencyGrid.indexOutOfRange', "Index out of range"));
		}
		
		return decompressed[index];
	}

	/**
	 * Set a character at a specific index and return the compressed string
	 */
	setCharAt(s: string, index: number, newChar: string): string {
		if (typeof newChar !== 'string' || newChar.length !== 1) {
			throw new Error(localize('dependencyGrid.invalidChar', "new_char must be a single character"));
		}
		
		const decompressed = this.decompress(s);
		if (index >= decompressed.length) {
			throw new Error(localize('dependencyGrid.indexOutOfRange', "Index out of range"));
		}
		
		const updated = decompressed.substring(0, index) + newChar + decompressed.substring(index + 1);
		return this.compress(updated);
	}

	/**
	 * Create an initial dependency grid with placeholders and diagonal markers
	 */
	createInitialGrid(keys: string[]): Record<string, string> {
		// Validate input
		if (!keys || !Array.isArray(keys) || !keys.every(k => typeof k === 'string' && k)) {
			this.logService.error(`DependencyGrid: Invalid keys provided for initial grid: ${keys}`);
			throw new Error(localize('dependencyGrid.invalidKeys', "All keys must be valid non-empty strings"));
		}
		
		// Cache lookup
		const cacheKey = `initial_grid:${keys.join(':')}`;
		const cachedGrid = this.cacheManager.get<Record<string, string>>('initial_grids', cacheKey);
		if (cachedGrid !== undefined) {
			return cachedGrid;
		}
		
		// Create new grid
		const grid: Record<string, string> = {};
		const numKeys = keys.length;
		
		for (let i = 0; i < keys.length; i++) {
			const rowKey = keys[i];
			const rowList = new Array(numKeys).fill(PLACEHOLDER_CHAR);
			rowList[i] = DIAGONAL_CHAR; // Diagonal element
			grid[rowKey] = this.compress(rowList.join(''));
		}
		
		// Cache the result
		this.cacheManager.set('initial_grids', cacheKey, grid);
		return grid;
	}

	/**
	 * Add a dependency between two keys in the grid
	 */
	addDependencyToGrid(
		grid: Record<string, string>,
		sourceKey: string,
		targetKey: string,
		keys: string[],
		depType: DependencyType = '>'
	): Record<string, string> {
		// Validate input
		if (!sourceKey || !targetKey) {
			throw new Error(localize('dependencyGrid.invalidSourceTarget', "Source and target keys must be non-empty strings"));
		}
		
		if (!keys.includes(sourceKey) || !keys.includes(targetKey)) {
			throw new Error(localize('dependencyGrid.keysNotInList', "Keys {0} or {1} not in keys list", sourceKey, targetKey));
		}
		
		const sourceIdx = keys.indexOf(sourceKey);
		const targetIdx = keys.indexOf(targetKey);
		
		// Cannot modify diagonal elements
		if (sourceIdx === targetIdx) {
			throw new Error(
				localize('dependencyGrid.diagonalModification', 
				"Cannot directly modify diagonal element for key '{0}'. Self-dependency must be 'o'.", sourceKey)
			);
		}
		
		// Create a copy of the grid to avoid modifying the original
		const newGrid = { ...grid };
		
		// Get and update the row
		const row = this.decompress(newGrid[sourceKey] || PLACEHOLDER_CHAR.repeat(keys.length));
		const newRow = row.substring(0, targetIdx) + depType + row.substring(targetIdx + 1);
		newGrid[sourceKey] = this.compress(newRow);
		
		// Invalidate caches
		this.cacheManager.invalidateDependentEntries('grid_decompress', `decompress:${newGrid[sourceKey]}`);
		this.cacheManager.invalidateDependentEntries(
			'grid_validation', 
			`validate_grid:${JSON.stringify(Object.entries(newGrid).sort())}:${keys.join(':')}`
		);
		
		return newGrid;
	}

	/**
	 * Remove a dependency between two keys in the grid
	 */
	removeDependencyFromGrid(
		grid: Record<string, string>,
		sourceKey: string,
		targetKey: string,
		keys: string[]
	): Record<string, string> {
		// Validate input
		if (!sourceKey || !targetKey) {
			throw new Error(localize('dependencyGrid.invalidSourceTarget', "Source and target keys must be non-empty strings"));
		}
		
		if (!keys.includes(sourceKey) || !keys.includes(targetKey)) {
			throw new Error(localize('dependencyGrid.keysNotInList', "Keys {0} or {1} not in keys list", sourceKey, targetKey));
		}
		
		const sourceIdx = keys.indexOf(sourceKey);
		const targetIdx = keys.indexOf(targetKey);
		
		// Skip diagonal elements
		if (sourceIdx === targetIdx) {
			return grid;
		}
		
		// Create a copy of the grid to avoid modifying the original
		const newGrid = { ...grid };
		
		// Get and update the row
		const row = this.decompress(newGrid[sourceKey] || PLACEHOLDER_CHAR.repeat(keys.length));
		const newRow = row.substring(0, targetIdx) + EMPTY_CHAR + row.substring(targetIdx + 1);
		newGrid[sourceKey] = this.compress(newRow);
		
		// Invalidate caches
		this.cacheManager.invalidateDependentEntries('grid_decompress', `decompress:${newGrid[sourceKey]}`);
		this.cacheManager.invalidateDependentEntries(
			'grid_validation', 
			`validate_grid:${JSON.stringify(Object.entries(newGrid).sort())}:${keys.join(':')}`
		);
		
		return newGrid;
	}

	/**
	 * Get dependencies for a specific key from the grid
	 */
	getDependenciesFromGrid(
		grid: Record<string, string>,
		key: string,
		keys: string[]
	): Record<DependencyType, string[]> {
		if (!keys.includes(key)) {
			throw new Error(localize('dependencyGrid.keyNotInList', "Key {0} not in keys list", key));
		}
		
		// Cache lookup
		const cacheKey = `grid_deps:${JSON.stringify(Object.entries(grid).sort())}:${key}:${keys.join(':')}`;
		const cachedDeps = this.cacheManager.get<Record<DependencyType, string[]>>('grid_dependencies', cacheKey);
		if (cachedDeps !== undefined) {
			return cachedDeps;
		}
		
		const results: Record<string, Set<string>> = {
			'>': new Set<string>(),
			'<': new Set<string>(),
			'x': new Set<string>(),
			'd': new Set<string>(),
			's': new Set<string>(),
			'S': new Set<string>(),
			'o': new Set<string>(),
			'n': new Set<string>(),
			'p': new Set<string>()
		};
		
		const keyIdx = keys.indexOf(key);
		const definedDepChars = new Set<string>(['<', '>', 'x', 'd', 's', 'S']);
		
		// Check each key's relationship to the target key
		for (let i = 0; i < keys.length; i++) {
			const otherKey = keys[i];
			if (key === otherKey) continue;
			
			let charOutgoing = EMPTY_CHAR;
			const rowKeyCompressed = grid[key];
			
			if (rowKeyCompressed) {
				try {
					charOutgoing = this.getCharAt(rowKeyCompressed, i);
				} catch (error) {
					// Ignore if index out of bounds
				}
			}
			
			// Categorize based on characters
			// Note: The logic here follows Python implementation priority rules
			if (charOutgoing === 'x') {
				results['x'].add(otherKey);
			} else if (charOutgoing === 'd') {
				results['d'].add(otherKey);
			} else if (charOutgoing === 'S') {
				results['S'].add(otherKey);
			} else if (charOutgoing === 's') {
				results['s'].add(otherKey);
			} else if (charOutgoing === '>') {
				results['>'].add(otherKey);
			} else if (charOutgoing === '<') {
				results['<'].add(otherKey);
			} else if (charOutgoing === 'p' && !definedDepChars.has(charOutgoing)) {
				results['p'].add(otherKey);
			}
		}
		
		// Convert Sets to arrays for the final output
		const finalResults: Record<DependencyType, string[]> = {} as Record<DependencyType, string[]>;
		for (const [depType, depSet] of Object.entries(results)) {
			finalResults[depType as DependencyType] = Array.from(depSet);
		}
		
		// Cache result
		this.cacheManager.set('grid_dependencies', cacheKey, finalResults);
		return finalResults;
	}

	/**
	 * Validate a grid for consistency
	 */
	validateGrid(grid: Record<string, string>, keys: string[]): boolean {
		// Cache lookup
		const cacheKey = `validate_grid:${JSON.stringify(Object.entries(grid).sort())}:${keys.join(':')}`;
		const cachedResult = this.cacheManager.get<boolean>('grid_validation', cacheKey);
		if (cachedResult !== undefined) {
			return cachedResult;
		}
		
		// Validate input types
		if (typeof grid !== 'object' || grid === null) {
			this.logService.error("Grid validation failed: 'grid' not a dict.");
			return false;
		}
		
		if (!Array.isArray(keys)) {
			this.logService.error("Grid validation failed: 'keys' not a list.");
			return false;
		}
		
		const numKeys = keys.length;
		
		// Empty grid and keys is valid
		if (numKeys === 0 && Object.keys(grid).length === 0) {
			this.cacheManager.set('grid_validation', cacheKey, true);
			return true;
		}
		
		// Empty keys but non-empty grid is invalid
		if (numKeys === 0 && Object.keys(grid).length > 0) {
			this.logService.error("Grid validation failed: Grid not empty but keys list is.");
			this.cacheManager.set('grid_validation', cacheKey, false);
			return false;
		}
		
		const expectedKeysSet = new Set(keys);
		const actualGridKeysSet = new Set(Object.keys(grid));
		
		// Check if grid has all expected keys and no extra keys
		const missingRows = Array.from(expectedKeysSet).filter(k => !actualGridKeysSet.has(k));
		const extraRows = Array.from(actualGridKeysSet).filter(k => !expectedKeysSet.has(k));
		
		if (missingRows.length > 0) {
			this.logService.error(`Grid validation failed: Missing rows for keys: ${missingRows.sort().join(', ')}`);
			this.cacheManager.set('grid_validation', cacheKey, false);
			return false;
		}
		
		if (extraRows.length > 0) {
			this.logService.error(`Grid validation failed: Extra rows found for keys: ${extraRows.sort().join(', ')}`);
			this.cacheManager.set('grid_validation', cacheKey, false);
			return false;
		}
		
		// Check row lengths and diagonal character
		for (let idx = 0; idx < keys.length; idx++) {
			const key = keys[idx];
			const compressedRow = grid[key];
			
			if (compressedRow === undefined) {
				this.logService.error(`Grid validation failed: Row missing for key '${key}'.`);
				this.cacheManager.set('grid_validation', cacheKey, false);
				return false;
			}
			
			try {
				const decompressed = this.decompress(compressedRow);
				
				if (decompressed.length !== numKeys) {
					this.logService.error(
						`Grid validation failed: Row '${key}' length incorrect ` +
						`(Expected: ${numKeys}, Got: ${decompressed.length}).`
					);
					this.cacheManager.set('grid_validation', cacheKey, false);
					return false;
				}
				
				// Check diagonal character
				if (decompressed[idx] !== DIAGONAL_CHAR) {
					this.logService.error(
						`Grid validation failed: Row for key '${key}' has incorrect diagonal character ` +
						`at index ${idx} (Expected: '${DIAGONAL_CHAR}', Got: '${decompressed[idx]}'). ` +
						`Row: '${decompressed}'`
					);
					this.cacheManager.set('grid_validation', cacheKey, false);
					return false;
				}
			} catch (error) {
				this.logService.error(`Grid validation failed: Error decompressing row '${key}': ${error}`);
				this.cacheManager.set('grid_validation', cacheKey, false);
				return false;
			}
		}
		
		this.logService.debug("Grid validation successful.");
		this.cacheManager.set('grid_validation', cacheKey, true);
		return true;
	}

	/**
	 * Format a grid for display
	 */
	formatGridForDisplay(grid: Record<string, string>, keys: string[]): string {
		const result: string[] = [`X ${keys.join(' ')}`];
		
		for (const key of keys) {
			result.push(
				`${key} = ${grid[key] || this.compress(PLACEHOLDER_CHAR.repeat(keys.length))}`
			);
		}
		
		return result.join('\n');
	}
}