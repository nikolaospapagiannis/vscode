/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableSource } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DeferredPromise } from 'vs/base/common/async';
import { AIMessage, AIMessageContent, AIProviderConfig, AIProviderType, AIRequestOptions, AIResponse, AIResponseFragment, AITool } from './types';
import { BaseAIProvider } from './baseProvider';

/**
 * Implementation of the Perplexity AI provider
 */
export class PerplexityProvider extends BaseAIProvider {
	/**
	 * Create a new Perplexity provider
	 */
	constructor() {
		// Initialize with basic info
		super({
			id: 'perplexity',
			name: 'Perplexity',
			type: AIProviderType.Perplexity,
			availableModels: [
				{
					id: 'sonar-medium-online',
					name: 'Sonar Medium (Online)',
					capabilities: {
						supportsImages: true,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 12000,
					maxResponseTokens: 4096,
					pricingTier: 'paid'
				},
				{
					id: 'sonar-small-online',
					name: 'Sonar Small (Online)',
					capabilities: {
						supportsImages: true,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 12000,
					maxResponseTokens: 4096,
					pricingTier: 'free'
				},
				{
					id: 'mistral-7b-instruct',
					name: 'Mistral 7B Instruct',
					capabilities: {
						supportsImages: false,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 8192,
					maxResponseTokens: 1024,
					pricingTier: 'free'
				}
			],
			iconPath: 'perplexity-logo',
			isEnabled: true,
			authStatus: 'unauthenticated'
		});
	}

	/**
	 * Initialize the Perplexity provider with configuration
	 * @param config Provider configuration
	 */
	async initialize(config: AIProviderConfig): Promise<void> {
		// Store API key and base URL
		this._apiKey = config.apiKey;
		this._baseUrl = config.baseUrl ?? 'https://api.perplexity.ai';

		// Set default model if specified
		if (config.defaultModel) {
			this._defaultModel = config.defaultModel;
		} else {
			// Use first available model as default
			this._defaultModel = this.info.availableModels[0].id;
		}

		// Update auth status
		if (this._apiKey) {
			this._setAuthStatus('authenticated');
		}
	}

	/**
	 * Send a request to the Perplexity AI API
	 * @param messages Messages to send
	 * @param options Request options
	 * @param token Cancellation token
	 * @returns Response from the API
	 */
	async sendRequest(messages: AIMessage[], options?: AIRequestOptions, token?: CancellationToken): Promise<AIResponse> {
		// Check if provider is authenticated
		if (this.info.authStatus !== 'authenticated') {
			throw new Error('Perplexity provider is not authenticated');
		}

		// Use default model if not specified
		const modelId = options?.model ?? this._defaultModel;

		// Check if model exists
		const model = this.info.availableModels.find(m => m.id === modelId);
		if (!model) {
			throw new Error(`Model "${modelId}" not found`);
		}

		// Create request payload
		const payload = {
			model: modelId,
			messages: this._formatMessages(messages),
			temperature: options?.temperature ?? 0.7,
			max_tokens: options?.maxTokens ?? model.maxResponseTokens,
			stream: true,
		};

		// Create response stream and promise
		const stream = new AsyncIterableSource<AIResponseFragment>();
		const result = new DeferredPromise<void>();

		// Make API request (implementation would connect to Perplexity API)
		// For now, this is a placeholder that would be replaced with actual API calls
		this._makePerplexityRequest(payload, stream, result, token);

		// Return stream and result promise
		return {
			stream: stream.asyncIterable,
			result: result.p
		};
	}

	/**
	 * Format messages for the Perplexity API
	 * @param messages Messages to format
	 * @returns Formatted messages for API
	 */
	private _formatMessages(messages: AIMessage[]): any[] {
		return messages.map(message => {
			// Convert message content to text
			const content = message.content.map(c => {
				if (c.type === 'text') {
					return c.value;
				}
				// For images, convert to base64 URL format
				// This is a placeholder - actual implementation would depend on Perplexity's API
				return `[Image: ${c.value.uri.toString()}]`;
			}).join('');

			return {
				role: message.role,
				content: content
			};
		});
	}

	/**
	 * Make request to Perplexity API
	 * This is a placeholder method that would be replaced with actual API calls
	 */
	private _makePerplexityRequest(payload: any, stream: AsyncIterableSource<AIResponseFragment>, result: DeferredPromise<void>, token?: CancellationToken): void {
		// Implementation would make actual API calls to Perplexity
		// For now, simulate a response
		setTimeout(() => {
			if (token?.isCancellationRequested) {
				result.error(new Error('Request cancelled'));
				return;
			}

			// Emit a simple response for demonstration
			stream.emitOne({
				index: 0,
				part: { type: 'text', value: 'This is a simulated response from Perplexity AI.' }
			});

			// Complete the response
			stream.resolve();
			result.complete();
		}, 100);
	}

	/**
	 * Count tokens in a message or text
	 * @param value Message or text to count tokens in
	 * @param token Cancellation token
	 * @returns Token count
	 */
	async countTokens(value: string | AIMessage[], token?: CancellationToken): Promise<number> {
		// Simple approximation - would be replaced with actual tokenization
		if (typeof value === 'string') {
			// Approximate token count as words / 0.75
			return Math.ceil(value.split(/\s+/).length / 0.75);
		} else {
			// Count tokens in each message
			let totalTokens = 0;
			for (const message of value) {
				for (const content of message.content) {
					if (content.type === 'text') {
						totalTokens += Math.ceil(content.value.split(/\s+/).length / 0.75);
					} else {
						// Images typically count as a certain number of tokens
						totalTokens += 1000; // Placeholder value
					}
				}
			}
			return totalTokens;
		}
	}
}
