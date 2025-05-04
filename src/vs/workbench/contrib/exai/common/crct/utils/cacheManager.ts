/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ICacheManager } from '../types';
import { localize } from 'vs/nls';
import { getExtUri } from 'vs/workbench/contrib/exai/common/utils/uriUtils';

// Cache Configuration
const DEFAULT_TTL = 600; // 10 minutes in seconds
const DEFAULT_MAX_SIZE = 1000; // Default max items per cache
const CACHE_SIZES: Record<string, number> = {
	'embeddings_generation': 100, // Smaller for heavy data
	'key_generation': 5000,       // Larger for key maps
};

/**
 * Type for cache entry with value, timestamps, and expiry
 */
type CacheEntry<T> = {
	value: T;
	accessTime: number;
	expiryTime: number | null;
};

/**
 * Single cache instance with LRU eviction, TTL, and dependency tracking
 */
class Cache<T> {
	private readonly name: string;
	private readonly data: Map<string, CacheEntry<T>> = new Map();
	private readonly dependencies: Map<string, string[]> = new Map();
	private readonly reverseDeps: Map<string, string[]> = new Map();
	private readonly creationTime: number = Date.now();
	private readonly maxSize: number;
	private readonly defaultTtl: number;
	
	private hits = 0;
	private misses = 0;

	constructor(name: string, ttl: number = DEFAULT_TTL, maxSize?: number) {
		this.name = name;
		this.defaultTtl = ttl;
		this.maxSize = maxSize ?? CACHE_SIZES[name] ?? DEFAULT_MAX_SIZE;
	}

	/**
	 * Get value from cache, with TTL checking
	 */
	get(key: string): T | undefined {
		const entry = this.data.get(key);
		if (!entry) {
			this.misses++;
			return undefined;
		}

		// Check if entry is expired
		if (entry.expiryTime !== null && Date.now() > entry.expiryTime) {
			this.data.delete(key);
			this.removeKeyDependencies(key);
			this.misses++;
			return undefined;
		}

		// Update access time
		entry.accessTime = Date.now();
		this.hits++;
		return entry.value;
	}

	/**
	 * Set value in cache with dependencies and TTL
	 */
	set(key: string, value: T, dependencies?: string[], ttl?: number): void {
		// If at max size, evict least recently used entry
		if (this.data.size >= this.maxSize && !this.data.has(key)) {
			this.evictLRU();
		}

		// Calculate expiry time (null means no expiry)
		const expiryTime = ttl !== undefined 
			? ttl === 0 ? null : Date.now() + (ttl ?? this.defaultTtl) * 1000
			: Date.now() + this.defaultTtl * 1000;
		
		// Store the entry
		this.data.set(key, {
			value,
			accessTime: Date.now(),
			expiryTime
		});

		// Set up dependencies
		if (dependencies && dependencies.length > 0) {
			// Track what keys depend on this dependency
			for (const dep of dependencies) {
				if (!this.dependencies.has(dep)) {
					this.dependencies.set(dep, []);
				}
				this.dependencies.get(dep)!.push(key);

				// Track what dependencies this key depends on
				if (!this.reverseDeps.has(key)) {
					this.reverseDeps.set(key, []);
				}
				this.reverseDeps.get(key)!.push(dep);
			}
		}
	}

	/**
	 * Invalidate entries matching a key pattern
	 */
	invalidate(keyPattern: string): void {
		const regex = new RegExp(keyPattern);
		const keysToRemove = Array.from(this.data.keys()).filter(k => regex.test(k));
		
		for (const key of keysToRemove) {
			this.data.delete(key);
			this.removeKeyDependencies(key);
		}
	}

	/**
	 * Remove a key and its dependency relationships
	 */
	private removeKeyDependencies(key: string): void {
		// Remove from reverse dependencies
		if (this.reverseDeps.has(key)) {
			const deps = this.reverseDeps.get(key)!;
			for (const dep of deps) {
				// Remove this key from the dependencies list
				if (this.dependencies.has(dep)) {
					const dependentKeys = this.dependencies.get(dep)!;
					const index = dependentKeys.indexOf(key);
					if (index >= 0) {
						dependentKeys.splice(index, 1);
					}
					
					// Clean up empty dependencies
					if (dependentKeys.length === 0) {
						this.dependencies.delete(dep);
					}
				}
			}
			this.reverseDeps.delete(key);
		}

		// Remove from dependencies
		if (this.dependencies.has(key)) {
			this.dependencies.delete(key);
		}
	}

	/**
	 * Evict the least recently used entry
	 */
	private evictLRU(): void {
		if (this.data.size === 0) {
			return;
		}

		let oldestKey: string | undefined;
		let oldestTime = Infinity;

		for (const [key, entry] of this.data.entries()) {
			if (entry.accessTime < oldestTime) {
				oldestKey = key;
				oldestTime = entry.accessTime;
			}
		}

		if (oldestKey) {
			this.data.delete(oldestKey);
			this.removeKeyDependencies(oldestKey);
		}
	}

	/**
	 * Remove all expired entries
	 */
	cleanupExpired(): void {
		const now = Date.now();
		const expiredKeys = Array.from(this.data.entries())
			.filter(([_, entry]) => entry.expiryTime !== null && entry.expiryTime < now)
			.map(([key]) => key);

		for (const key of expiredKeys) {
			this.data.delete(key);
			this.removeKeyDependencies(key);
		}
	}

	/**
	 * Check if cache is expired and empty
	 */
	isExpired(): boolean {
		return this.data.size === 0 && (Date.now() - this.creationTime) > this.defaultTtl * 1000;
	}

	/**
	 * Get cache statistics
	 */
	stats(): { hits: number; misses: number; size: number } {
		return {
			hits: this.hits,
			misses: this.misses,
			size: this.data.size
		};
	}

	/**
	 * Serialize cache for storage
	 */
	serialize(): Record<string, any> {
		// Only include non-expired entries
		const now = Date.now();
		const serializedData: Record<string, any> = {};
		
		for (const [key, entry] of this.data.entries()) {
			if (entry.expiryTime === null || entry.expiryTime > now) {
				serializedData[key] = entry.value;
			}
		}

		return {
			name: this.name,
			data: serializedData,
			dependencies: Object.fromEntries(this.dependencies)
		};
	}
}

/**
 * Implementation of the Cache Manager for TypeScript
 */
export class CacheManager extends Disposable implements ICacheManager {
	private readonly caches: Map<string, Cache<any>> = new Map();
	private readonly storageDir: URI | undefined;
	private readonly persist: boolean;
	
	constructor(persist: boolean = false, storageDir?: URI) {
		super();
		this.persist = persist;
		this.storageDir = storageDir;
		
		// Cleanup interval
		const cleanupInterval = setInterval(() => this.cleanup(), 60_000); // Cleanup every minute
		this._register({ dispose: () => clearInterval(cleanupInterval) });
		
		// Try to load persisted caches if enabled
		if (persist && storageDir) {
			this.loadPersistedCaches().catch(e => 
				console.error(localize('cacheManager.loadError', "Failed to load persisted caches: {0}", e))
			);
		}
	}

	/**
	 * Get or create a cache by name
	 */
	private getCache<T>(cacheName: string, ttl: number = DEFAULT_TTL): Cache<T> {
		// Get existing cache or create if not present/expired
		let cache = this.caches.get(cacheName) as Cache<T> | undefined;
		
		if (!cache || cache.isExpired()) {
			cache = new Cache<T>(cacheName, ttl);
			this.caches.set(cacheName, cache);
		}
		
		return cache;
	}

	/**
	 * Get a cached value
	 */
	get<T>(cacheName: string, key: string): T | undefined {
		const cache = this.getCache<T>(cacheName);
		return cache.get(key);
	}

	/**
	 * Set a cached value
	 */
	set<T>(cacheName: string, key: string, value: T, dependencies?: string[], ttl?: number): void {
		const cache = this.getCache<T>(cacheName);
		cache.set(key, value, dependencies, ttl);
	}

	/**
	 * Remove expired caches and entries
	 */
	private cleanup(): void {
		// Remove expired caches
		const expiredCacheNames: string[] = [];
		
		for (const [name, cache] of this.caches.entries()) {
			if (cache.isExpired()) {
				expiredCacheNames.push(name);
			} else {
				cache.cleanupExpired();
			}
		}
		
		// Remove expired caches
		for (const name of expiredCacheNames) {
			if (this.persist) {
				this.saveCache(name).catch(e => 
					console.error(localize('cacheManager.saveError', "Failed to save cache {0}: {1}", name, e))
				);
			}
			this.caches.delete(name);
		}
	}

	/**
	 * Clear all caches
	 */
	clearAll(): void {
		if (this.persist) {
			// Save all caches before clearing
			Promise.all(Array.from(this.caches.keys()).map(name => this.saveCache(name)))
				.catch(e => console.error(localize('cacheManager.bulkSaveError', "Failed to save caches: {0}", e)));
		}
		
		this.caches.clear();
	}

	/**
	 * Invalidate cache entries by key pattern
	 */
	invalidateDependentEntries(cacheName: string, keyPattern: string): void {
		const cache = this.caches.get(cacheName);
		if (cache) {
			cache.invalidate(keyPattern);
		}
	}

	/**
	 * Invalidate caches when a file is modified
	 */
	fileModified(filePath: string, projectRoot: string, cacheType: string = 'all'): void {
		const normalizedPath = getExtUri(URI.file(filePath)).toString();
		const normalizedRoot = getExtUri(URI.file(projectRoot)).toString();
		
		// Create a pattern that matches cache keys for this file
		const pattern = cacheType === 'all' 
			? `.*:${normalizedPath}:.*` 
			: `${cacheType}:${normalizedPath}:.*`;
		
		// Invalidate in all caches
		for (const [name, cache] of this.caches.entries()) {
			cache.invalidate(pattern);
		}
	}

	/**
	 * Get cache stats
	 */
	getStats(cacheName: string): { hits: number; misses: number; size: number } {
		const cache = this.caches.get(cacheName);
		if (cache) {
			return cache.stats();
		}
		return { hits: 0, misses: 0, size: 0 };
	}

	/**
	 * Save a cache to storage
	 */
	private async saveCache(cacheName: string): Promise<void> {
		if (!this.persist || !this.storageDir) {
			return;
		}

		const cache = this.caches.get(cacheName);
		if (!cache) {
			return;
		}

		try {
			// Serialize the cache
			const serialized = cache.serialize();
			const serializedJson = JSON.stringify(serialized);
			const filename = `${cacheName}.json`;
			
			// TODO: Implement file system operations when needed
			// This would use VS Code's workspace.fs APIs
		} catch (error) {
			console.error(localize('cacheManager.serializeError', "Failed to serialize cache {0}: {1}", cacheName, error));
		}
	}

	/**
	 * Load persisted caches
	 */
	private async loadPersistedCaches(): Promise<void> {
		if (!this.persist || !this.storageDir) {
			return;
		}

		try {
			// TODO: Implement file reading and cache restoration
			// This would use VS Code's workspace.fs APIs to enumerate
			// and read cache files from the storage directory
		} catch (error) {
			console.error(localize('cacheManager.loadPersistedError', "Failed to load persisted caches: {0}", error));
		}
	}

	/**
	 * Create a cache decorator function that can be used to cache function results
	 * Similar to the Python @cached decorator but as a higher-order function
	 */
	createCachedDecorator<T extends (...args: any[]) => Promise<any>>(
		cacheName: string,
		keyFunc?: (...args: Parameters<T>) => string,
		ttl?: number
	) {
		return (target: T) => {
			return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
				// Generate cache key
				const key = keyFunc 
					? keyFunc(...args) 
					: `${target.name}:${JSON.stringify(args)}`;
				
				// Check cache
				const cachedResult = this.get<ReturnType<T>>(cacheName, key);
				if (cachedResult !== undefined) {
					return cachedResult;
				}
				
				// Call original function
				const result = await target(...args);
				
				// Cache result and detect file dependencies
				let dependencies: string[] | undefined = undefined;
				let valueToCache: any = result;
				
				// Check for explicit dependencies in result tuple format [value, dependencies]
				if (Array.isArray(result) && result.length === 2 && Array.isArray(result[1])) {
					valueToCache = result[0];
					dependencies = result[1];
				} else {
					// Auto-detect file dependencies for certain function names
					const functionName = target.name.toLowerCase();
					
					if (['loadembedding', 'loadmetadata', 'analyzefile', 'analyzeproject', 'getfiletype'].includes(functionName)) {
						if (args.length > 0 && typeof args[0] === 'string') {
							dependencies = [`file:${getExtUri(URI.file(args[0]))}`];
						}
					}
				}
				
				// Store in cache
				this.set(cacheName, key, valueToCache, dependencies, ttl);
				
				return valueToCache;
			};
		};
	}
}