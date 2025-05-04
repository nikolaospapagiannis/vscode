/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AIProviderConfig, AIProviderType, IAIProvider } from './types';
import { OpenAIProvider } from './openAIProvider';
import { ClaudeProvider } from './claudeProvider';
import { PerplexityProvider } from './perplexityProvider';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IRequestService } from 'vs/platform/request/common/request';

/**
 * Factory for creating AI provider instances
 */
export class AIProviderFactory {
	// Instantiation service for DI
	private static _instantiationService: IInstantiationService | undefined;
	private static _logService: ILogService | undefined;
	private static _requestService: IRequestService | undefined;

	/**
	 * Set the instantiation service for creating providers with DI
	 * @param instantiationService VS Code instantiation service
	 */
	static setInstantiationService(instantiationService: IInstantiationService): void {
		this._instantiationService = instantiationService;
	}

	/**
	 * Set the log service for providers that need it
	 * @param logService VS Code log service
	 */
	static setLogService(logService: ILogService): void {
		this._logService = logService;
	}

	/**
	 * Set the request service for providers that need it
	 * @param requestService VS Code request service
	 */
	static setRequestService(requestService: IRequestService): void {
		this._requestService = requestService;
	}

	/**
	 * Create a new AI provider instance
	 * @param type Provider type to create
	 * @returns A new provider instance
	 */
	static createProvider(type: AIProviderType): IAIProvider {
		// If we have the instantiation service, use it for DI
		if (this._instantiationService) {
			switch (type) {
				case AIProviderType.OpenAI:
					return this._instantiationService.createInstance(OpenAIProvider);

				case AIProviderType.Claude:
					return this._instantiationService.createInstance(ClaudeProvider);

				case AIProviderType.Perplexity:
					return this._instantiationService.createInstance(PerplexityProvider);

				case AIProviderType.Copilot:
					// To be implemented in the future
					throw new Error('GitHub Copilot provider is not implemented yet');

				case AIProviderType.Custom:
					throw new Error('Custom provider requires a factory function');

				default:
					throw new Error(`Unknown provider type: ${type}`);
			}
		} else {
			// Fallback to manual instantiation with available services
			switch (type) {
				case AIProviderType.OpenAI:
					if (this._requestService && this._logService) {
						return new OpenAIProvider(this._requestService, this._logService);
					}
					return new OpenAIProvider();

				case AIProviderType.Claude:
					if (this._requestService && this._logService) {
						return new ClaudeProvider(this._requestService, this._logService);
					}
					return new ClaudeProvider();

				case AIProviderType.Perplexity:
					if (this._requestService && this._logService) {
						return new PerplexityProvider(this._requestService, this._logService);
					}
					throw new Error('Perplexity provider requires request and log services');

				case AIProviderType.Copilot:
					// To be implemented in the future
					throw new Error('GitHub Copilot provider is not implemented yet');

				case AIProviderType.Custom:
					throw new Error('Custom provider requires a factory function');

				default:
					throw new Error(`Unknown provider type: ${type}`);
			}
		}
	}

	/**
	 * Create and initialize a provider
	 * @param config Provider configuration
	 * @returns An initialized provider
	 */
	static async createAndInitializeProvider(config: AIProviderConfig): Promise<IAIProvider> {
		const provider = this.createProvider(config.type);
		await provider.initialize(config);
		return provider;
	}
}
