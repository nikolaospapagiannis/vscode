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
 * Implementation of the OpenAI provider
 */
export class OpenAIProvider extends BaseAIProvider {
	// API client instance
	private _client: any | undefined;

	/**
	 * Create a new OpenAI provider
	 */
	constructor() {
		// Initialize with basic info
		super({
			id: 'openai',
			name: 'OpenAI',
			type: AIProviderType.OpenAI,
			availableModels: [
				{
					id: 'gpt-4o',
					name: 'GPT-4o',
					capabilities: {
						supportsImages: true,
						supportsToolCalling: true,
						supportsStreaming: true
					},
					maxContextLength: 128000,
					maxResponseTokens: 4096,
					pricingTier: 'paid'
				},
				{
					id: 'gpt-4-turbo',
					name: 'GPT-4 Turbo',
					capabilities: {
						supportsImages: true,
						supportsToolCalling: true,
						supportsStreaming: true
					},
					maxContextLength: 128000,
					maxResponseTokens: 4096,
					pricingTier: 'paid'
				},
				{
					id: 'gpt-3.5-turbo',
					name: 'GPT-3.5 Turbo',
					capabilities: {
						supportsImages: false,
						supportsToolCalling: true,
						supportsStreaming: true
					},
					maxContextLength: 16385,
					maxResponseTokens: 4096,
					pricingTier: 'free'
				}
			],
			iconPath: 'openai-logo',
			isEnabled: true,
			authStatus: 'unauthenticated'
		});
	}

	/**
	 * Initialize the OpenAI provider
	 * @param config Provider configuration
	 */
	protected async initializeImplementation(config: AIProviderConfig): Promise<void> {
		try {
			// In a real implementation, we would import the OpenAI SDK and create a client
			// For this prototype, we'll simulate the API client
			this._client = {
				apiKey: config.apiKey,
				organization: config.organizationId,
				baseURL: config.baseUrl || 'https://api.openai.com/v1',
			};

			// Validate API key and connection
			await this.validateApiKey();
		} catch (error) {
			this._client = undefined;
			throw error;
		}
	}

	/**
	 * Validate the API key by making a test request
	 */
	private async validateApiKey(): Promise<void> {
		// In a real implementation, we would make a lightweight API call to validate the key
		// For this prototype, we'll simulate the validation
		if (!this._client?.apiKey) {
			throw new Error('OpenAI API key is required');
		}

		// Simulate API validation delay
		await new Promise(resolve => setTimeout(resolve, 100));

		// Simulate success
		return Promise.resolve();
	}

	/**
	 * Send a request to the OpenAI API
	 * @param messages Messages to send
	 * @param options Request options
	 * @param token Cancellation token
	 */
	async sendRequest(messages: AIMessage[], options?: AIRequestOptions, token?: CancellationToken): Promise<AIResponse> {
		if (!this._client) {
			throw new Error('OpenAI provider is not initialized');
		}

		// Convert messages to OpenAI format
		const openaiMessages = this.convertToOpenAIMessages(messages);

		// Set the model to use (default to gpt-4o if not specified)
		const model = options?.model || 'gpt-4o';

		// Prepare tools if any
		const tools = options?.tools ? this.convertToOpenAITools(options.tools) : undefined;

		// Set up streaming response handling
		const responseStream = new AsyncIterableSource<AIResponseFragment>();
		const responseComplete = new DeferredPromise<void>();

		// Process in background to allow streaming
		(async () => {
			try {
				// In a real implementation, we would use the OpenAI SDK to make the API call
				// For this prototype, we'll simulate the API call with a simple streaming response

				// Simulate API call delay
				await new Promise(resolve => setTimeout(resolve, 200));

				// Check for cancellation
				if (token?.isCancellationRequested) {
					responseComplete.complete();
					return;
				}

				// Simulate streaming response
				const response = "This is a sample response from the OpenAI provider. The GPT models provide state-of-the-art results for a wide range of language tasks.";

				for (let i = 0; i < response.length; i += 10) {
					if (token?.isCancellationRequested) {
						break;
					}

					const chunk = response.substring(i, Math.min(i + 10, response.length));

					// Emit response fragment
					responseStream.emitOne({
						index: 0,
						part: {
							type: 'text',
							value: chunk
						}
					});

					// Simulate streaming delay
					await new Promise(resolve => setTimeout(resolve, 50));
				}

				// Simulate tool calling if requested
				if (tools && tools.length > 0) {
					responseStream.emitOne({
						index: 1,
						part: {
							type: 'tool_call',
							name: 'get_weather',
							toolCallId: 'tool-call-1',
							parameters: {
								location: 'San Francisco',
								unit: 'celsius'
							}
						}
					});
				}

				// Complete the response
				responseComplete.complete();
			} catch (error) {
				responseStream.reject(error);
				responseComplete.error(error);
			} finally {
				responseStream.resolve();
			}
		})();

		// Return the response
		return {
			stream: responseStream.asyncIterable,
			result: responseComplete.p
		};
	}

	/**
	 * Count tokens in a message or text
	 * @param value Message or text to count tokens for
	 * @param token Cancellation token
	 */
	async countTokens(value: string | AIMessage[], token?: CancellationToken): Promise<number> {
		// In a real implementation, we would use the OpenAI tokenizer
		// For this prototype, we'll use a simple approximation

		if (typeof value === 'string') {
			// Roughly 4 characters per token for English text
			return Math.ceil(value.length / 4);
		} else {
			// Convert messages to OpenAI format and estimate token count
			const openAIMessages = this.convertToOpenAIMessages(value);

			// Count tokens in all messages
			let tokenCount = 0;
			for (const message of openAIMessages) {
				// Base token count for each message
				tokenCount += 4;

				// Add tokens for role
				tokenCount += 1;

				// Add tokens for name if present
				if (message.name) {
					tokenCount += 1 + Math.ceil(message.name.length / 4);
				}

				// Add tokens for content
				if (message.content) {
					if (typeof message.content === 'string') {
						tokenCount += Math.ceil(message.content.length / 4);
					} else {
						for (const part of message.content) {
							if (part.type === 'text') {
								tokenCount += Math.ceil(part.text.length / 4);
							} else if (part.type === 'image_url') {
								// Images typically use more tokens
								tokenCount += 1000;
							}
						}
					}
				}
			}

			return tokenCount;
		}
	}

	/**
	 * Convert ExAI messages to OpenAI format
	 * @param messages ExAI messages
	 */
	private convertToOpenAIMessages(messages: AIMessage[]): any[] {
		return messages.map(message => {
			const openAIMessage: any = {
				role: message.role,
				content: message.content.length === 1 && message.content[0].type === 'text'
					? message.content[0].value
					: message.content.map(part => this.convertMessageContentToOpenAI(part)),
			};

			if (message.name) {
				openAIMessage.name = message.name;
			}

			return openAIMessage;
		});
	}

	/**
	 * Convert ExAI message content to OpenAI format
	 * @param content Message content part
	 */
	private convertMessageContentToOpenAI(content: AIMessageContent): any {
		if (content.type === 'text') {
			return {
				type: 'text',
				text: content.value
			};
		} else if (content.type === 'image') {
			// For image content, convert to OpenAI format
			return {
				type: 'image_url',
				image_url: {
					url: content.value.data
						? `data:${content.value.mimeType};base64,${Buffer.from(content.value.data).toString('base64')}`
						: content.value.uri.toString(),
				}
			};
		}

		return null;
	}

	/**
	 * Convert ExAI tools to OpenAI tools format
	 * @param tools ExAI tools
	 */
	private convertToOpenAITools(tools: AITool[]): any[] {
		return tools.map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: {
					type: 'object',
					properties: tool.parameters,
					required: Object.keys(tool.parameters).filter(key =>
						tool.parameters[key].required === true
					)
				}
			}
		}));
	}
}
