/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { AIMessage, AIProviderSelector, AIRequestOptions, AIResponse, AIResponseStats, IAIProvider, IAIProviderService } from './types';

/**
 * Provider selection strategies
 */
export enum ProviderSelectionStrategy {
	/**
	 * Use the first available provider that meets the criteria
	 */
	FirstAvailable = 'firstAvailable',

	/**
	 * Round-robin between all available providers
	 */
	RoundRobin = 'roundRobin',

	/**
	 * Select the provider with the lowest latency
	 */
	LowestLatency = 'lowestLatency',

	/**
	 * Random selection between available providers
	 */
	Random = 'random'
}

/**
 * Provider error handling strategies
 */
export enum ProviderErrorHandlingStrategy {
	/**
	 * Return the error from the failed provider
	 */
	Fail = 'fail',

	/**
	 * Try to use a fallback provider if available
	 */
	Fallback = 'fallback',

	/**
	 * Retry with the same provider
	 */
	Retry = 'retry'
}

/**
 * Configuration for the multi-provider manager
 */
export interface MultiProviderManagerConfig {
	/**
	 * Strategy for selecting providers
	 */
	selectionStrategy: ProviderSelectionStrategy;

	/**
	 * Strategy for handling provider errors
	 */
	errorHandlingStrategy: ProviderErrorHandlingStrategy;

	/**
	 * Maximum retries for failed requests
	 */
	maxRetries: number;

	/**
	 * Timeout for requests in milliseconds
	 */
	requestTimeoutMs: number;
}

/**
 * Event data for provider selection events
 */
export interface ProviderSelectionEvent {
	/**
	 * ID of the selected provider
	 */
	providerId: string;

	/**
	 * Type of the selected provider
	 */
	providerType: string;

	/**
	 * Selection strategy used
	 */
	strategy: ProviderSelectionStrategy;

	/**
	 * Time taken to select the provider in milliseconds
	 */
	selectionTimeMs: number;
}

/**
 * Event data for provider fallback events
 */
export interface ProviderFallbackEvent {
	/**
	 * ID of the original provider that failed
	 */
	originalProviderId: string;

	/**
	 * ID of the fallback provider
	 */
	fallbackProviderId: string;

	/**
	 * Error that caused the fallback
	 */
	error: Error;
}

/**
 * Manager for multi-provider orchestration
 */
export class MultiProviderManager extends Disposable {
	// Events
	private readonly _onDidSelectProvider = this._register(new Emitter<ProviderSelectionEvent>());
	readonly onDidSelectProvider = this._onDidSelectProvider.event;

	private readonly _onDidFallback = this._register(new Emitter<ProviderFallbackEvent>());
	readonly onDidFallback = this._onDidFallback.event;

	// Tracking last selected provider for round-robin
	private _lastSelectedProviderIndex = -1;

	/**
	 * Create a new multi-provider manager
	 * @param config Manager configuration
	 * @param providerService Provider service
	 */
	constructor(
		private _config: MultiProviderManagerConfig,
		private readonly _providerService: IAIProviderService
	) {
		super();
	}

	/**
	 * Update the manager configuration
	 * @param config New configuration
	 */
	updateConfig(config: Partial<MultiProviderManagerConfig>): void {
		this._config = { ...this._config, ...config };
	}

	/**
	 * Get the current configuration
	 */
	getConfig(): MultiProviderManagerConfig {
		return { ...this._config };
	}

	/**
	 * Send a request to an appropriate provider
	 * @param messages Messages to send
	 * @param options Request options
	 * @param selector Provider selection criteria
	 * @param token Cancellation token
	 * @returns Response from a provider
	 */
	async sendRequest(
		messages: AIMessage[],
		options?: AIRequestOptions,
		selector?: AIProviderSelector,
		token?: CancellationToken
	): Promise<AIResponse> {
		// Create a cancellation token source with timeout
		const cts = new CancellationTokenSource(token);
		if (this._config.requestTimeoutMs > 0) {
			const timeoutHandle = setTimeout(() => {
				cts.cancel();
			}, this._config.requestTimeoutMs);

			// Clean up timeout when done
			cts.token.onCancellationRequested(() => {
				clearTimeout(timeoutHandle);
			});
		}

		try {
			// Select a provider using the configured strategy
			const provider = await this._selectProvider(selector);

			// Send the request to the selected provider
			return await this._sendRequestToProvider(
				provider,
				messages,
				options,
				cts.token,
				0 // Start with no retries
			);
		} finally {
			cts.dispose();
		}
	}

	/**
	 * Select a provider using the configured strategy
	 * @param selector Provider selection criteria
	 * @returns Selected provider
	 * @throws Error if no providers are available
	 */
	private async _selectProvider(selector?: AIProviderSelector): Promise<IAIProvider> {
		const startTime = Date.now();

		// Get providers matching the selector
		const providers = await this._providerService.selectProviders(selector || {});

		if (providers.length === 0) {
			throw new Error('No matching AI providers available');
		}

		let selectedProvider: IAIProvider;

		// Apply the selection strategy
		switch (this._config.selectionStrategy) {
			case ProviderSelectionStrategy.FirstAvailable:
				selectedProvider = providers[0];
				break;

			case ProviderSelectionStrategy.RoundRobin:
				// Move to the next provider in the list
				this._lastSelectedProviderIndex = (this._lastSelectedProviderIndex + 1) % providers.length;
				selectedProvider = providers[this._lastSelectedProviderIndex];
				break;

			case ProviderSelectionStrategy.LowestLatency:
				// Find the provider with the lowest average response time
				// If we have registry data, we could use that to find the fastest provider
				// For now, just use the first one
				selectedProvider = providers[0];
				break;

			case ProviderSelectionStrategy.Random:
				// Select a random provider
				const randomIndex = Math.floor(Math.random() * providers.length);
				selectedProvider = providers[randomIndex];
				break;

			default:
				// Default to first available
				selectedProvider = providers[0];
				break;
		}

		// Fire selection event
		this._onDidSelectProvider.fire({
			providerId: selectedProvider.info.id,
			providerType: selectedProvider.info.type,
			strategy: this._config.selectionStrategy,
			selectionTimeMs: Date.now() - startTime
		});

		return selectedProvider;
	}

	/**
	 * Send a request to a specific provider with retry and fallback logic
	 * @param provider Provider to use
	 * @param messages Messages to send
	 * @param options Request options
	 * @param token Cancellation token
	 * @param retryCount Current retry count
	 * @returns Response from the provider
	 * @throws Error if the request fails and cannot be retried or fallback
	 */
	private async _sendRequestToProvider(
		provider: IAIProvider,
		messages: AIMessage[],
		options?: AIRequestOptions,
		token?: CancellationToken,
		retryCount = 0
	): Promise<AIResponse> {
		try {
			// Send the request to the provider
			return await provider.sendRequest(messages, options, token);
		} catch (error) {
			// Handle the error based on the configured strategy
			switch (this._config.errorHandlingStrategy) {
				case ProviderErrorHandlingStrategy.Retry:
					// Check if we can retry
					if (retryCount < this._config.maxRetries) {
						// Wait a bit before retrying (exponential backoff)
						const delay = Math.pow(2, retryCount) * 500;
						await new Promise(resolve => setTimeout(resolve, delay));

						// Retry with the same provider
						return this._sendRequestToProvider(
							provider,
							messages,
							options,
							token,
							retryCount + 1
						);
					}
					// If we've exhausted retries, fall through to the next strategy
					break;

				case ProviderErrorHandlingStrategy.Fallback:
					// Try to find a different provider
					try {
						// Get all providers except the one that failed
						const fallbackSelector: AIProviderSelector = {
							filter: p => p.info.id !== provider.info.id
						};

						const fallbackProvider = await this._selectProvider(fallbackSelector);

						// Fire fallback event
						this._onDidFallback.fire({
							originalProviderId: provider.info.id,
							fallbackProviderId: fallbackProvider.info.id,
							error: error as Error
						});

						// Try the fallback provider
						return await fallbackProvider.sendRequest(messages, options, token);
					} catch (fallbackError) {
						// If fallback also fails, throw the original error
						throw error;
					}

				case ProviderErrorHandlingStrategy.Fail:
				default:
					// Just throw the error
					throw error;
			}

			// If we get here, we've exhausted all options
			throw error;
		}
	}
}
