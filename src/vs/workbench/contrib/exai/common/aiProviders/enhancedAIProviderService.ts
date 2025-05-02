/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { AIMessage, AIProviderConfig, AIProviderSelector, AIProviderType, AIRequestOptions, AIResponse, IAIProvider, IAIProviderService } from './types';
import { AIProviderFactory } from './aiProviderFactory';
import { ProviderRegistry } from './providerRegistry';
import { MultiProviderManager, ProviderErrorHandlingStrategy, ProviderSelectionStrategy } from './multiProviderManager';

/**
 * Enhanced AI provider service that integrates the provider registry and multi-provider manager
 */
export class EnhancedAIProviderService extends Disposable implements IAIProviderService {
	private static readonly _instance: EnhancedAIProviderService = new EnhancedAIProviderService();

	// Events
	private readonly _onDidChangeProviders = this._register(new Emitter<void>());
	readonly onDidChangeProviders = this._onDidChangeProviders.event;

	// Core components
	private readonly _registry = new ProviderRegistry();
	private readonly _providerStore = new DisposableStore();
	private readonly _multiProviderManager: MultiProviderManager;

	// Default provider configurations
	private readonly _defaultConfigurations = new Map<AIProviderType, AIProviderConfig>();

	constructor() {
		super();

		// Register the registry and store
		this._register(this._registry);
		this._register(this._providerStore);

		// Create the multi-provider manager with default config
		this._multiProviderManager = new MultiProviderManager({
			selectionStrategy: ProviderSelectionStrategy.RoundRobin,
			errorHandlingStrategy: ProviderErrorHandlingStrategy.Fallback,
			maxRetries: 2,
			requestTimeoutMs: 60000
		}, this);

		this._register(this._multiProviderManager);

		// Listen for registry changes
		this._registry.onDidChangeProviders(() => {
			this._onDidChangeProviders.fire();
		});
	}

	/**
	 * Get the singleton instance of the enhanced provider service
	 */
	static get instance(): EnhancedAIProviderService {
		return this._instance;
	}

	/**
	 * Get all registered providers
	 */
	get providers(): ReadonlyMap<string, IAIProvider> {
		// Create a map of providers from the registry entries
		const providers = new Map<string, IAIProvider>();
		for (const [id, entry] of this._registry.getEntries()) {
			providers.set(id, entry.provider);
		}
		return providers;
	}

	/**
	 * Register a new AI provider
	 * @param provider The provider to register
	 * @returns A disposable to unregister the provider
	 */
	registerProvider(provider: IAIProvider): IDisposable {
		const disposable = this._registry.registerProvider(provider);
		this._providerStore.add(disposable);
		return disposable;
	}

	/**
	 * Get a provider by ID
	 * @param id The provider ID
	 */
	getProvider(id: string): IAIProvider | undefined {
		const entry = this._registry.getEntry(id);
		return entry?.provider;
	}

	/**
	 * Get all active providers (enabled and authenticated)
	 */
	getActiveProviders(): IAIProvider[] {
		return Array.from(this.providers.values())
			.filter(provider => provider.info.isEnabled && provider.info.authStatus === 'authenticated');
	}

	/**
	 * Select providers based on criteria
	 * @param selector Selection criteria
	 */
	async selectProviders(selector: AIProviderSelector): Promise<IAIProvider[]> {
		// Start with all active providers
		let providers = this.getActiveProviders();

		// Filter by type
		if (selector.type) {
			providers = providers.filter(p => p.info.type === selector.type);
		}

		// Filter by ID
		if (selector.id) {
			providers = providers.filter(p => p.info.id === selector.id);
		}

		// Filter by required capabilities
		if (selector.requiredCapabilities) {
			providers = providers.filter(p => {
				// Check if any of the provider's models meets the capability requirements
				return p.info.availableModels.some(model => {
					if (selector.requiredCapabilities!.supportsImages !== undefined &&
						model.capabilities.supportsImages !== selector.requiredCapabilities!.supportsImages) {
						return false;
					}
					if (selector.requiredCapabilities!.supportsToolCalling !== undefined &&
						model.capabilities.supportsToolCalling !== selector.requiredCapabilities!.supportsToolCalling) {
						return false;
					}
					if (selector.requiredCapabilities!.supportsStreaming !== undefined &&
						model.capabilities.supportsStreaming !== selector.requiredCapabilities!.supportsStreaming) {
						return false;
					}
					return true;
				});
			});
		}

		// Apply custom filter if provided
		if (selector.filter) {
			providers = providers.filter(selector.filter);
		}

		return providers;
	}

	/**
	 * Get the provider registry
	 */
	getRegistry(): ProviderRegistry {
		return this._registry;
	}

	/**
	 * Get the multi-provider manager
	 */
	getMultiProviderManager(): MultiProviderManager {
		return this._multiProviderManager;
	}

	/**
	 * Register a default configuration for a provider type
	 * @param type Provider type
	 * @param config Default configuration
	 * @returns A disposable to unregister the configuration
	 */
	registerDefaultConfiguration(type: AIProviderType, config: AIProviderConfig): IDisposable {
		this._defaultConfigurations.set(type, config);

		return toDisposable(() => {
			this._defaultConfigurations.delete(type);
		});
	}

	/**
	 * Get default configuration for a provider type
	 * @param type Provider type
	 * @returns Default configuration if registered, or undefined
	 */
	getDefaultConfiguration(type: AIProviderType): AIProviderConfig | undefined {
		return this._defaultConfigurations.get(type);
	}

	/**
	 * Create and register a provider with default configuration
	 * @param type Provider type to create
	 * @param overrideConfig Optional configuration to override defaults
	 * @returns The created provider
	 */
	async createAndRegisterProvider(type: AIProviderType, overrideConfig?: Partial<AIProviderConfig>): Promise<IAIProvider> {
		// Get default configuration
		const defaultConfig = this._defaultConfigurations.get(type);

		if (!defaultConfig && !overrideConfig?.apiKey) {
			throw new Error(`No default configuration registered for provider type ${type} and no API key provided`);
		}

		// Merge configurations
		const config: AIProviderConfig = {
			...defaultConfig,
			...overrideConfig,
			type
		} as AIProviderConfig;

		// Create and initialize the provider
		const provider = await AIProviderFactory.createAndInitializeProvider(config);

		// Register the provider
		this.registerProvider(provider);

		return provider;
	}

	/**
	 * Send a request using the multi-provider manager
	 * @param messages Messages to send
	 * @param options Request options
	 * @param selector Provider selector
	 * @param token Cancellation token
	 * @returns Response from a provider
	 */
	async sendRequest(
		messages: AIMessage[],
		options?: AIRequestOptions,
		selector?: AIProviderSelector,
		token?: CancellationToken
	): Promise<AIResponse> {
		// Get start time for metrics
		const startTime = Date.now();

		try {
			// Use the multi-provider manager to send the request
			const response = await this._multiProviderManager.sendRequest(
				messages,
				options,
				selector,
				token
			);

			// Extract the selected provider ID from the manager
			// (This would require some additional work to expose this information)

			// Record metrics in the registry
			// This would be done when the response is complete

			return response;
		} catch (error) {
			// Handle error (logging, etc.)
			throw error;
		}
	}
}

/**
 * Default implementation of the enhanced AI provider service
 */
export const EnhancedAIProviderServiceImpl = EnhancedAIProviderService.instance;
