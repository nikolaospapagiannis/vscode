/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { AIProviderCapability, AIProviderInfo, IAIProvider } from './types';

/**
 * Provider registry entry stats
 */
export interface ProviderStats {
	/**
	 * Number of successful requests
	 */
	successfulRequests: number;

	/**
	 * Number of failed requests
	 */
	failedRequests: number;

	/**
	 * Average response time in milliseconds
	 */
	avgResponseTimeMs: number;

	/**
	 * Last request timestamp
	 */
	lastRequestTimestamp: number;
}

/**
 * Entry in the provider registry
 */
export interface ProviderRegistryEntry {
	/**
	 * Provider information
	 */
	info: AIProviderInfo;

	/**
	 * Provider capabilities
	 */
	capabilities: AIProviderCapability[];

	/**
	 * Provider instance
	 */
	instance: IAIProvider;

	/**
	 * Provider stats
	 */
	stats: ProviderStats;

	/**
	 * Provider status
	 */
	status: 'active' | 'inactive' | 'error';

	/**
	 * Error message, if status is 'error'
	 */
	errorMessage?: string;
}

/**
 * Event data for provider added events
 */
export interface ProviderAddedEvent {
	/**
	 * ID of the provider
	 */
	providerId: string;

	/**
	 * Provider information
	 */
	info: AIProviderInfo;
}

/**
 * Event data for provider removed events
 */
export interface ProviderRemovedEvent {
	/**
	 * ID of the provider
	 */
	providerId: string;
}

/**
 * Event data for provider updated events
 */
export interface ProviderUpdatedEvent {
	/**
	 * ID of the provider
	 */
	providerId: string;

	/**
	 * Updated properties
	 */
	changes: {
		status?: 'active' | 'inactive' | 'error';
		errorMessage?: string;
		capabilities?: AIProviderCapability[];
	};
}

/**
 * Registry of AI providers
 */
export class ProviderRegistry extends Disposable {
	// Events
	private readonly _onDidAddProvider = this._register(new Emitter<ProviderAddedEvent>());
	readonly onDidAddProvider = this._onDidAddProvider.event;

	private readonly _onDidRemoveProvider = this._register(new Emitter<ProviderRemovedEvent>());
	readonly onDidRemoveProvider = this._onDidRemoveProvider.event;

	private readonly _onDidUpdateProvider = this._register(new Emitter<ProviderUpdatedEvent>());
	readonly onDidUpdateProvider = this._onDidUpdateProvider.event;

	// Registry entries
	private readonly _entries = new Map<string, ProviderRegistryEntry>();

	/**
	 * Register a provider with the registry
	 * @param provider Provider to register
	 */
	registerProvider(provider: IAIProvider): IDisposable {
		const id = provider.info.id;

		// Check if provider is already registered
		if (this._entries.has(id)) {
			throw new Error(`Provider with ID '${id}' is already registered`);
		}

		// Create registry entry
		const entry: ProviderRegistryEntry = {
			info: { ...provider.info },
			capabilities: [...provider.capabilities],
			instance: provider,
			stats: {
				successfulRequests: 0,
				failedRequests: 0,
				avgResponseTimeMs: 0,
				lastRequestTimestamp: 0
			},
			status: 'active'
		};

		// Add to registry
		this._entries.set(id, entry);

		// Fire event
		this._onDidAddProvider.fire({
			providerId: id,
			info: { ...provider.info }
		});

		// Return disposable for unregistering
		return {
			dispose: () => {
				this.unregisterProvider(id);
			}
		};
	}

	/**
	 * Unregister a provider from the registry
	 * @param providerId ID of the provider to unregister
	 */
	unregisterProvider(providerId: string): void {
		// Check if provider is registered
		if (!this._entries.has(providerId)) {
			return;
		}

		// Remove from registry
		this._entries.delete(providerId);

		// Fire event
		this._onDidRemoveProvider.fire({
			providerId
		});
	}

	/**
	 * Get a provider from the registry
	 * @param providerId ID of the provider to get
	 */
	getProvider(providerId: string): ProviderRegistryEntry | undefined {
		return this._entries.get(providerId);
	}

	/**
	 * Get all providers from the registry
	 */
	getAllProviders(): ProviderRegistryEntry[] {
		return Array.from(this._entries.values());
	}

	/**
	 * Get active providers from the registry
	 */
	getActiveProviders(): ProviderRegistryEntry[] {
		return Array.from(this._entries.values())
			.filter(entry => entry.status === 'active');
	}

	/**
	 * Update provider status
	 * @param providerId ID of the provider to update
	 * @param status New status
	 * @param errorMessage Optional error message if status is 'error'
	 */
	updateProviderStatus(
		providerId: string,
		status: 'active' | 'inactive' | 'error',
		errorMessage?: string
	): void {
		// Get entry
		const entry = this._entries.get(providerId);
		if (!entry) {
			return;
		}

		// Update status
		entry.status = status;
		entry.errorMessage = errorMessage;

		// Fire event
		this._onDidUpdateProvider.fire({
			providerId,
			changes: {
				status,
				errorMessage
			}
		});
	}

	/**
	 * Update provider capabilities
	 * @param providerId ID of the provider to update
	 * @param capabilities New capabilities
	 */
	updateProviderCapabilities(
		providerId: string,
		capabilities: AIProviderCapability[]
	): void {
		// Get entry
		const entry = this._entries.get(providerId);
		if (!entry) {
			return;
		}

		// Update capabilities
		entry.capabilities = [...capabilities];

		// Fire event
		this._onDidUpdateProvider.fire({
			providerId,
			changes: {
				capabilities: [...capabilities]
			}
		});
	}

	/**
	 * Record successful request
	 * @param providerId ID of the provider
	 * @param responseTimeMs Response time in milliseconds
	 */
	recordSuccessfulRequest(providerId: string, responseTimeMs: number): void {
		// Get entry
		const entry = this._entries.get(providerId);
		if (!entry) {
			return;
		}

		// Update stats
		entry.stats.successfulRequests++;
		entry.stats.lastRequestTimestamp = Date.now();

		// Update average response time
		const totalRequests = entry.stats.successfulRequests + entry.stats.failedRequests;
		const oldAvg = entry.stats.avgResponseTimeMs;
		entry.stats.avgResponseTimeMs = oldAvg + (responseTimeMs - oldAvg) / totalRequests;
	}

	/**
	 * Record failed request
	 * @param providerId ID of the provider
	 */
	recordFailedRequest(providerId: string): void {
		// Get entry
		const entry = this._entries.get(providerId);
		if (!entry) {
			return;
		}

		// Update stats
		entry.stats.failedRequests++;
		entry.stats.lastRequestTimestamp = Date.now();
	}

	/**
	 * Get all entries in the registry
	 */
	getEntries(): Map<string, ProviderRegistryEntry> {
		return new Map(this._entries);
	}
}
