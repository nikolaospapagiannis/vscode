/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { AIMessage, AIProviderConfig, AIProviderSelector, AIProviderType, AIRequestOptions, AIResponse, IAIProvider } from './types';
import { MultiProviderController } from './multiProviderController';
import { ProviderRegistry } from './providerRegistry';
import { ProviderErrorHandlingStrategy, ProviderSelectionStrategy } from './multiProviderManager';
import { ILogService } from 'vs/platform/log/common/log';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

/**
 * Service identifier for the multi-provider service
 */
export const IMultiProviderService = createDecorator<IMultiProviderService>('multiProviderService');

/**
 * Interface for the multi-provider service
 */
export interface IMultiProviderService {
	/**
	 * Send a request to an appropriate provider
	 */
	sendRequest(
		messages: AIMessage[],
		options?: AIRequestOptions,
		selector?: AIProviderSelector,
		token?: CancellationToken
	): Promise<AIResponse>;

	/**
	 * Get a provider by ID
	 */
	getProvider(id: string): IAIProvider | undefined;

	/**
	 * Get all active providers
	 */
	getActiveProviders(): IAIProvider[];

	/**
	 * Register a provider with the framework
	 */
	registerProvider(provider: IAIProvider): void;

	/**
	 * Create and register a provider
	 */
	createAndRegisterProvider(type: AIProviderType, config: AIProviderConfig): Promise<IAIProvider>;

	/**
	 * Select providers based on criteria
	 */
	selectProviders(selector: AIProviderSelector): Promise<IAIProvider[]>;

	/**
	 * Get provider registry
	 */
	getRegistry(): ProviderRegistry;

	/**
	 * Get the current selection strategy
	 */
	getSelectionStrategy(): ProviderSelectionStrategy;

	/**
	 * Set the selection strategy
	 */
	setSelectionStrategy(strategy: ProviderSelectionStrategy): void;

	/**
	 * Get the current error handling strategy
	 */
	getErrorHandlingStrategy(): ProviderErrorHandlingStrategy;

	/**
	 * Set the error handling strategy
	 */
	setErrorHandlingStrategy(strategy: ProviderErrorHandlingStrategy): void;

	/**
	 * Get provider usage statistics
	 */
	getProviderStats(): { providerId: string; successRate: number; avgResponseTimeMs: number; requestCount: number }[];
}

/**
 * Implementation of the multi-provider service
 */
export class MultiProviderService implements IMultiProviderService {
	private readonly _controller: MultiProviderController;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService
	) {
		this._controller = new MultiProviderController(configurationService, logService);
	}

	sendRequest(
		messages: AIMessage[],
		options?: AIRequestOptions,
		selector?: AIProviderSelector,
		token?: CancellationToken
	): Promise<AIResponse> {
		return this._controller.sendRequest(messages, options, selector, token);
	}

	getProvider(id: string): IAIProvider | undefined {
		return this._controller.getProvider(id);
	}

	getActiveProviders(): IAIProvider[] {
		return this._controller.getActiveProviders();
	}

	registerProvider(provider: IAIProvider): void {
		this._controller.registerProvider(provider);
	}

	async createAndRegisterProvider(type: AIProviderType, config: AIProviderConfig): Promise<IAIProvider> {
		return this._controller.createAndRegisterProvider(type, config);
	}

	async selectProviders(selector: AIProviderSelector): Promise<IAIProvider[]> {
		return this._controller.selectProviders(selector);
	}

	getRegistry(): ProviderRegistry {
		return this._controller.getRegistry();
	}

	getSelectionStrategy(): ProviderSelectionStrategy {
		// Get from configuration
		const strategy = this.configurationService.getValue<string>('exai.multiProvider.selectionStrategy');
		return strategy as ProviderSelectionStrategy || ProviderSelectionStrategy.RoundRobin;
	}

	setSelectionStrategy(strategy: ProviderSelectionStrategy): void {
		// Update configuration
		this.configurationService.updateValue('exai.multiProvider.selectionStrategy', strategy);
	}

	getErrorHandlingStrategy(): ProviderErrorHandlingStrategy {
		// Get from configuration
		const strategy = this.configurationService.getValue<string>('exai.multiProvider.errorHandlingStrategy');
		return strategy as ProviderErrorHandlingStrategy || ProviderErrorHandlingStrategy.Fallback;
	}

	setErrorHandlingStrategy(strategy: ProviderErrorHandlingStrategy): void {
		// Update configuration
		this.configurationService.updateValue('exai.multiProvider.errorHandlingStrategy', strategy);
	}

	getProviderStats(): { providerId: string; successRate: number; avgResponseTimeMs: number; requestCount: number }[] {
		const registry = this.getRegistry();
		const stats: { providerId: string; successRate: number; avgResponseTimeMs: number; requestCount: number }[] = [];

		for (const [id, entry] of registry.getEntries()) {
			const totalRequests = entry.stats.successfulRequests + entry.stats.failedRequests;
			const successRate = totalRequests > 0 ? entry.stats.successfulRequests / totalRequests : 0;

			stats.push({
				providerId: id,
				successRate,
				avgResponseTimeMs: entry.stats.avgResponseTimeMs,
				requestCount: totalRequests
			});
		}

		return stats;
	}
}
