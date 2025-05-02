/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { AIMessage, AIProviderConfig, AIProviderSelector, AIProviderType, AIRequestOptions, AIResponse, IAIProvider } from './types';
import { EnhancedAIProviderService } from './enhancedAIProviderService';
import { MultiProviderManager, ProviderErrorHandlingStrategy, ProviderSelectionStrategy } from './multiProviderManager';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Configuration for the multi-provider framework
 */
export interface MultiProviderConfig {
	/**
	 * Enable the multi-provider framework
	 */
	enable: boolean;

	/**
	 * Selection strategy for choosing providers
	 */
	selectionStrategy: ProviderSelectionStrategy;

	/**
	 * Error handling strategy when a provider fails
	 */
	errorHandlingStrategy: ProviderErrorHandlingStrategy;

	/**
	 * Default provider selection criteria
	 */
	defaultSelector?: AIProviderSelector;

	/**
	 * Timeout for requests in milliseconds
	 */
	requestTimeoutMs: number;

	/**
	 * Maximum retries for failed requests
	 */
	maxRetries: number;
}

/**
 * Controller that orchestrates the Multi-Provider Framework
 */
export class MultiProviderController extends Disposable {
	private readonly _providerService: EnhancedAIProviderService;
	private readonly _manager: MultiProviderManager;
	private _config: MultiProviderConfig;

	/**
	 * Create a new multi-provider controller
	 * @param configService Configuration service for settings
	 * @param logService Log service for logging
	 */
	constructor(
		@IConfigurationService private readonly configService: IConfigurationService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Get the provider service and manager
		this._providerService = EnhancedAIProviderService.instance;
		this._manager = this._providerService.getMultiProviderManager();

		// Initialize configuration from user settings
		this._config = this._loadConfiguration();

		// Listen for configuration changes
		this._register(this.configService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('exai.multiProvider')) {
				this._config = this._loadConfiguration();
				this._updateManagerConfiguration();
			}
		}));

		// Apply initial configuration
		this._updateManagerConfiguration();
	}

	/**
	 * Load configuration from user settings
	 */
	private _loadConfiguration(): MultiProviderConfig {
		const config = this.configService.getValue<MultiProviderConfig>('exai.multiProvider') || {};

		return {
			enable: config.enable ?? true,
			selectionStrategy: config.selectionStrategy ?? ProviderSelectionStrategy.RoundRobin,
			errorHandlingStrategy: config.errorHandlingStrategy ?? ProviderErrorHandlingStrategy.Fallback,
			defaultSelector: config.defaultSelector,
			requestTimeoutMs: config.requestTimeoutMs ?? 60000,
			maxRetries: config.maxRetries ?? 3
		};
	}

	/**
	 * Update the manager configuration
	 */
	private _updateManagerConfiguration(): void {
		// Nothing to do for now - in a real implementation we would
		// update the manager's configuration based on user settings
	}

	/**
	 * Register a provider with the framework
	 * @param provider Provider to register
	 */
	registerProvider(provider: IAIProvider): void {
		this._providerService.registerProvider(provider);
		this.logService.info(`[MultiProvider] Registered provider: ${provider.info.id} (${provider.info.type})`);
	}

	/**
	 * Register multiple providers
	 * @param providers Providers to register
	 */
	registerProviders(providers: IAIProvider[]): void {
		for (const provider of providers) {
			this.registerProvider(provider);
		}
	}

	/**
	 * Create and register a provider
	 * @param type Provider type to create
	 * @param config Provider configuration
	 */
	async createAndRegisterProvider(type: AIProviderType, config: AIProviderConfig): Promise<IAIProvider> {
		const provider = await this._providerService.createAndRegisterProvider(type, config);
		this.logService.info(`[MultiProvider] Created and registered provider: ${provider.info.id} (${provider.info.type})`);
		return provider;
	}

	/**
	 * Get a provider by ID
	 * @param id Provider ID
	 */
	getProvider(id: string): IAIProvider | undefined {
		return this._providerService.getProvider(id);
	}

	/**
	 * Send a request to an appropriate provider
	 * @param messages Messages to send
	 * @param options Request options
	 * @param selector Provider selection criteria
	 * @param token Cancellation token
	 */
	async sendRequest(
		messages: AIMessage[],
		options?: AIRequestOptions,
		selector?: AIProviderSelector,
		token?: CancellationToken
	): Promise<AIResponse> {
		// Check if multi-provider framework is enabled
		if (!this._config.enable) {
			this.logService.debug('[MultiProvider] Framework disabled, using first available provider');

			// If disabled, use the first available provider
			const providers = await this._providerService.selectProviders(selector || {});
			if (providers.length === 0) {
				throw new Error('No matching AI providers available');
			}

			return providers[0].sendRequest(messages, options, token);
		}

		// Use the multi-provider manager to send the request
		this.logService.debug(`[MultiProvider] Sending request using ${this._config.selectionStrategy} strategy`);

		const startTime = Date.now();
		try {
			const response = await this._manager.sendRequest(messages, options, selector, token);
			this.logService.debug(`[MultiProvider] Request completed in ${Date.now() - startTime}ms`);
			return response;
		} catch (error) {
			this.logService.error(`[MultiProvider] Request failed after ${Date.now() - startTime}ms: ${error}`);
			throw error;
		}
	}

	/**
	 * Select providers based on criteria
	 * @param selector Selection criteria
	 */
	async selectProviders(selector: AIProviderSelector): Promise<IAIProvider[]> {
		return this._providerService.selectProviders(selector);
	}

	/**
	 * Register default configuration for a provider type
	 * @param type Provider type
	 * @param config Default configuration
	 */
	registerDefaultConfiguration(type: AIProviderType, config: AIProviderConfig): void {
		this._providerService.registerDefaultConfiguration(type, config);
		this.logService.info(`[MultiProvider] Registered default configuration for provider type: ${type}`);
	}

	/**
	 * Get active providers
	 */
	getActiveProviders(): IAIProvider[] {
		return this._providerService.getActiveProviders();
	}

	/**
	 * Get the provider registry
	 */
	getRegistry() {
		return this._providerService.getRegistry();
	}
}
