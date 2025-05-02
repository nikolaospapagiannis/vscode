/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AIProviderConfig, AIProviderType, IAIProvider } from './types';
import { OpenAIProvider } from './openAIProvider';
import { ClaudeProvider } from './claudeProvider';
import { PerplexityProvider } from './perplexityProvider';

/**
 * Factory for creating AI provider instances
 */
export class AIProviderFactory {
	/**
	 * Create a new AI provider instance
	 * @param type Provider type to create
	 * @returns A new provider instance
	 */
	static createProvider(type: AIProviderType): IAIProvider {
		switch (type) {
			case AIProviderType.OpenAI:
				return new OpenAIProvider();

			case AIProviderType.Claude:
				return new ClaudeProvider();

			case AIProviderType.Perplexity:
				return new PerplexityProvider();

			case AIProviderType.Copilot:
				// To be implemented in the future
				throw new Error('GitHub Copilot provider is not implemented yet');

			case AIProviderType.Custom:
				throw new Error('Custom provider requires a factory function');

			default:
				throw new Error(`Unknown provider type: ${type}`);
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
