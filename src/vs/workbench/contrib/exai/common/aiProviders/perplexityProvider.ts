/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableSource } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DeferredPromise } from 'vs/base/common/async';
import { AIMessage, AIMessageContent, AIProviderConfig, AIProviderType, AIRequestOptions, AIResponse, AIResponseFragment } from './types';
import { BaseAIProvider } from './baseProvider';
import { IRequestService } from 'vs/platform/request/common/request';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Implementation of the Perplexity AI provider
 */
export class PerplexityProvider extends BaseAIProvider {
	private _apiKey: string | undefined;
	private _baseUrl: string | undefined;
	private _defaultModel: string | undefined;
	private readonly _apiEndpoint: string = '/chat/completions';

	/**
	 * Create a new Perplexity provider
	 * @param requestService Request service for API calls
	 * @param logService Logging service
	 */
	constructor(
		private readonly requestService: IRequestService,
		private readonly logService: ILogService
	) {
		// Initialize with enhanced Perplexity model options
		super({
			id: 'perplexity',
			name: 'Perplexity AI',
			type: AIProviderType.Perplexity,
			availableModels: [
				{
					id: 'pplx-70b-online',
					name: 'Perplexity 70B Online',
					capabilities: {
						supportsImages: true,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 32000,
					maxResponseTokens: 4096,
					pricingTier: 'paid'
				},
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
					id: 'codellama-70b-instruct',
					name: 'CodeLlama 70B Instruct',
					capabilities: {
						supportsImages: false,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 16000,
					maxResponseTokens: 4096,
					pricingTier: 'paid'
				},
				{
					id: 'llama-3-70b-instruct',
					name: 'Llama 3 70B Instruct',
					capabilities: {
						supportsImages: false,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 8192,
					maxResponseTokens: 2048,
					pricingTier: 'paid'
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
	protected async initializeImplementation(config: AIProviderConfig): Promise<void> {
		this.logService.info('Initializing Perplexity provider');
		
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

		// Validate API key by making a test request
		if (this._apiKey) {
			try {
				// Make a test request to the models endpoint
				const response = await this.requestService.request({
					type: 'GET',
					url: `${this._baseUrl}/models`,
					headers: {
						'Authorization': `Bearer ${this._apiKey}`,
					}
				}, CancellationToken.None);

				if (response.status === 200) {
					this.logService.info('Perplexity provider authentication successful');
					this.updateStatus('authenticated');
				} else {
					this.logService.error(`Perplexity provider authentication failed: ${response.statusText}`);
					this.updateStatus('error');
					throw new Error(`Authentication failed: ${response.statusText}`);
				}
			} catch (error) {
				this.logService.error('Perplexity provider initialization error:', error);
				this.updateStatus('error');
				throw error;
			}
		} else {
			this.logService.warn('No API key provided for Perplexity provider');
			this.updateStatus('unauthenticated');
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
			stream: options?.customOptions?.stream === true // Default to non-streaming
		};

		// Create response stream and promise
		const stream = new AsyncIterableSource<AIResponseFragment>();
		const result = new DeferredPromise<void>();

		// Make the API request
		this._makePerplexityAPIRequest(payload, stream, result, token);

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
			// Extract text content from message
			let textParts: string[] = [];
			let hasImages = false;
			
			// Process each content part
			for (const c of message.content) {
				if (c.type === 'text') {
					textParts.push(c.value);
				} else if (c.type === 'image') {
					hasImages = true;
					// Placeholder for image content
					textParts.push('[Image attached]');
				}
			}
			
			// Combine all text parts
			const contentText = textParts.join('\n');
			
			return {
				role: message.role,
				content: contentText
			};
		});
	}

	/**
	 * Make a real API request to Perplexity
	 */
	private async _makePerplexityAPIRequest(
		payload: any,
		stream: AsyncIterableSource<AIResponseFragment>,
		result: DeferredPromise<void>,
		token?: CancellationToken
	): Promise<void> {
		try {
			// Make the API request
			const response = await this.requestService.request({
				type: 'POST',
				url: `${this._baseUrl}${this._apiEndpoint}`,
				headers: {
					'Authorization': `Bearer ${this._apiKey}`,
					'Content-Type': 'application/json'
				},
				data: JSON.stringify(payload)
			}, token || CancellationToken.None);

			// Check if request was successful
			if (response.status !== 200) {
				const errorText = await response.bodyText();
				let errorMsg = `Perplexity API request failed with status ${response.status}`;
				
				try {
					const errorJson = JSON.parse(errorText);
					if (errorJson.error && errorJson.error.message) {
						errorMsg = `Perplexity API error: ${errorJson.error.message}`;
					}
				} catch (e) {
					// If parsing fails, use the raw error text
					errorMsg = `${errorMsg}: ${errorText}`;
				}
				
				throw new Error(errorMsg);
			}

			// Parse response
			const responseData = JSON.parse(await response.bodyText());
			
			// Handle response based on whether it's streaming or not
			if (payload.stream) {
				// Placeholder for streaming implementation
				// In actual implementation, would parse SSE stream
				this.logService.warn('Streaming not fully implemented yet');
				
				// For now, just emit the complete response
				if (responseData.choices && responseData.choices.length > 0) {
					const content = responseData.choices[0].message.content;
					
					stream.emitOne({
						index: 0,
						part: { type: 'text', value: content }
					});
				}
			} else {
				// For non-streaming, emit the complete response
				if (responseData.choices && responseData.choices.length > 0) {
					const content = responseData.choices[0].message.content;
					
					stream.emitOne({
						index: 0,
						part: { type: 'text', value: content }
					});
				}
			}
			
			// Complete the response
			stream.resolve();
			result.complete();
		} catch (error) {
			// Log the error
			this.logService.error('Perplexity API request failed:', error);
			
			// Propagate error to caller
			result.error(error);
			stream.error(error);
		}
	}

	/**
	 * Count tokens in a message or text
	 * @param value Message or text to count tokens in
	 * @param token Cancellation token
	 * @returns Token count
	 */
	async countTokens(value: string | AIMessage[], token?: CancellationToken): Promise<number> {
		// Improved token counting approximation
		if (typeof value === 'string') {
			// Using a more realistic approximation for token counting
			// Approximating tokens as 4 characters per token for English text
			return Math.ceil(value.length / 4);
		} else {
			// Count tokens in each message
			let totalTokens = 0;
			for (const message of value) {
				for (const content of message.content) {
					if (content.type === 'text') {
						totalTokens += Math.ceil(content.value.length / 4);
					} else if (content.type === 'image') {
						// Images typically count as a certain number of tokens
						// This varies by model and image size
						totalTokens += 1000; // Conservative estimate
					}
				}
				// Add overhead for message formatting
				totalTokens += 4;
			}
			return totalTokens;
		}
	}
}
