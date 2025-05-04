/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { AIProvider as CoreAIProvider } from '../ai/providerInterface';
import { 
	AIProviderType, 
	AIProviderInfo, 
	AIModelInfo,
	AIMessage, 
	AIMessageRole,
	AIMessageContent,
	AIRequestOptions, 
	AIResponse, 
	IAIProvider,
	AIImageContent,
	AIProviderConfig
} from './types';
import { 
	ChatMessage as CoreChatMessage, 
	ChatOptions as CoreChatOptions,
	CompletionOptions as CoreCompletionOptions,
	EmbeddingOptions as CoreEmbeddingOptions,
	CodeAnalysisOptions as CoreCodeAnalysisOptions
} from '../ai/providerTypes';
import { Event, Emitter } from 'vs/base/common/event';

/**
 * Adapter to convert between the two provider interfaces
 */
export class ProviderAdapter extends Disposable implements IAIProvider {
	// Event to signal status changes
	private readonly _onDidChangeStatus = this._register(new Emitter<void>());
	readonly onDidChangeStatus = this._onDidChangeStatus.event;

	// Provider info
	private _info: AIProviderInfo;

	/**
	 * Create a new provider adapter
	 * @param coreProvider The core provider to adapt
	 * @param logService The log service
	 */
	constructor(
		private readonly coreProvider: CoreAIProvider,
		private readonly logService: ILogService
	) {
		super();

		// Create provider info from core provider
		this._info = this._createProviderInfo(coreProvider);

		// Forward provider events
		if ('onDidChangeStatus' in coreProvider && typeof (coreProvider as any).onDidChangeStatus === 'function') {
			this._register((coreProvider as any).onDidChangeStatus(() => {
				this._updateProviderInfo();
				this._onDidChangeStatus.fire();
			}));
		}
	}

	/**
	 * Update the provider info
	 */
	private _updateProviderInfo(): void {
		// Update authentication status
		const isAuthenticated = this.coreProvider.isAuthenticated();
		this._info = {
			...this._info,
			authStatus: isAuthenticated ? 'authenticated' : 'unauthenticated'
		};
	}

	/**
	 * Create provider info from core provider
	 * @param coreProvider The core provider
	 * @returns Provider info
	 */
	private _createProviderInfo(coreProvider: CoreAIProvider): AIProviderInfo {
		// Map provider to a provider type
		let type: AIProviderType;
		switch (coreProvider.id) {
			case 'openai':
				type = AIProviderType.OpenAI;
				break;
			case 'claude':
				type = AIProviderType.Claude;
				break;
			case 'perplexity':
				type = AIProviderType.Perplexity;
				break;
			case 'copilot':
				type = AIProviderType.Copilot;
				break;
			default:
				type = AIProviderType.Custom;
		}

		// Map capabilities to model info
		const models: AIModelInfo[] = coreProvider.capabilities.supportedModels.map(modelId => {
			// Default capabilities
			const defaultCapabilities = {
				supportsImages: false,
				supportsToolCalling: false,
				supportsStreaming: true
			};

			// Set capabilities based on model and provider
			let capabilities = { ...defaultCapabilities };
			
			// Adjust capabilities based on model
			if (coreProvider.id === 'openai' && (modelId.includes('gpt-4') || modelId.includes('gpt-3.5'))) {
				capabilities.supportsToolCalling = true;
				
				if (modelId.includes('vision') || modelId.includes('gpt-4-turbo')) {
					capabilities.supportsImages = true;
				}
			}
			
			if (coreProvider.id === 'claude' && modelId.includes('claude-3')) {
				capabilities.supportsImages = true;
				capabilities.supportsToolCalling = true;
			}

			// Determine pricing tier
			let pricingTier = 'paid' as const;
			if (modelId.includes('gpt-3.5') || modelId.includes('haiku')) {
				pricingTier = 'paid' as const;
			} else if (modelId.includes('gpt-4') || modelId.includes('opus') || modelId.includes('sonnet')) {
				pricingTier = 'enterprise' as const;
			}

			return {
				id: modelId,
				name: modelId,
				capabilities,
				maxContextLength: coreProvider.capabilities.contextWindowSize || 16000,
				maxResponseTokens: coreProvider.capabilities.maxTokens || 4000,
				pricingTier
			};
		});

		return {
			id: coreProvider.id,
			name: coreProvider.name,
			type,
			availableModels: models,
			iconPath: `./resources/icons/${coreProvider.id}.svg`,
			isEnabled: true,
			authStatus: coreProvider.isAuthenticated() ? 'authenticated' : 'unauthenticated'
		};
	}

	/**
	 * Get provider info
	 */
	get info(): AIProviderInfo {
		return this._info;
	}

	/**
	 * Initialize the provider
	 * @param config Provider configuration
	 */
	async initialize(config: AIProviderConfig): Promise<void> {
		// Authentication is handled by the core provider
		const isAuthenticated = await this.coreProvider.authenticate();

		// Update provider info with authentication status
		this._info = {
			...this._info,
			authStatus: isAuthenticated ? 'authenticated' : 'error'
		};

		// Notify of status change
		this._onDidChangeStatus.fire();
	}

	/**
	 * Convert core chat message to AI message
	 * @param coreMessage The core chat message
	 * @returns AI message
	 */
	private _convertCoreMessageToAIMessage(coreMessage: CoreChatMessage): AIMessage {
		const role = coreMessage.role as AIMessageRole;
		
		// Create text content
		const content: AIMessageContent[] = [
			{ type: 'text', value: coreMessage.content }
		];

		return {
			role,
			content,
			name: coreMessage.name
		};
	}

	/**
	 * Convert AI message to core chat message
	 * @param aiMessage The AI message
	 * @returns Core chat message
	 */
	private _convertAIMessageToCoreMessage(aiMessage: AIMessage): CoreChatMessage {
		// Extract text content
		let textContent = '';
		for (const content of aiMessage.content) {
			if (content.type === 'text') {
				textContent += content.value;
			}
			// Images are not directly supported in the core interface
		}

		return {
			role: aiMessage.role as 'system' | 'user' | 'assistant' | 'function',
			content: textContent,
			name: aiMessage.name
		};
	}

	/**
	 * Create a streaming AI response
	 * @param coreText The text from the core provider
	 * @returns AI response
	 */
	private _createStreamingResponse(coreText: string): AIResponse {
		// For simplicity, we'll convert the whole response to a single fragment
		const responseText = coreText;
		
		// Create an async iterable for streaming
		const stream = (async function* () {
			yield {
				index: 0,
				part: {
					type: 'text',
					value: responseText
				}
			};
		})();

		// Create a promise that resolves when streaming is complete
		const result = Promise.resolve();

		return {
			stream,
			result
		};
	}

	/**
	 * Send a request to the provider
	 * @param messages Messages to send
	 * @param options Request options
	 * @param token Cancellation token
	 * @returns AI response
	 */
	async sendRequest(
		messages: AIMessage[],
		options?: AIRequestOptions,
		token?: CancellationToken
	): Promise<AIResponse> {
		// Convert messages to core format
		const coreMessages = messages.map(msg => this._convertAIMessageToCoreMessage(msg));

		// Check for images in messages
		const hasImages = messages.some(msg => 
			msg.content.some(content => content.type === 'image')
		);

		// Handle image-based messages separately for Claude and GPT-4V
		if (hasImages && this.coreProvider.id === 'claude' && this.coreProvider.analyzeImage) {
			// Extract the first image and any text
			let prompt = '';
			let imageData: Buffer | undefined;

			for (const msg of messages) {
				for (const content of msg.content) {
					if (content.type === 'text') {
						prompt += content.value + '\n';
					} else if (content.type === 'image' && !imageData) {
						// TODO: Convert URI to Buffer
						// For now, we'll assume this is handled elsewhere
						if ((content.value as AIImageContent).data) {
							imageData = Buffer.from((content.value as AIImageContent).data!);
						}
					}
				}
			}

			if (imageData) {
				const result = await this.coreProvider.analyzeImage(imageData, {
					prompt,
					model: options?.model
				});

				return this._createStreamingResponse(result.description);
			}
		}

		// Convert options
		const coreChatOptions: CoreChatOptions = {
			model: options?.model,
			maxTokens: options?.maxTokens,
			temperature: options?.temperature,
			stop: options?.stopSequences
		};

		// Use the chat API
		try {
			const result = await this.coreProvider.generateChat(coreMessages, coreChatOptions);
			
			// Convert result to streaming response
			const responseText = result.messages[0]?.content || '';
			return this._createStreamingResponse(responseText);
		} catch (error) {
			this.logService.error(`Provider ${this.coreProvider.id} request failed:`, error);
			throw error;
		}
	}

	/**
	 * Count tokens in a message or text
	 * @param value Message or text to count tokens in
	 * @param token Cancellation token
	 * @returns Token count
	 */
	async countTokens(value: string | AIMessage[], token?: CancellationToken): Promise<number> {
		if (typeof value === 'string') {
			return this.coreProvider.estimateTokenUsage(value);
		} else {
			// Convert messages to text and count
			const totalTokens = value.reduce((sum, msg) => {
				// Sum up all text content
				const textContent = msg.content
					.filter(content => content.type === 'text')
					.map(content => content.value)
					.join('\n');
				
				return sum + this.coreProvider.estimateTokenUsage(textContent);
			}, 0);

			return totalTokens;
		}
	}
}

/**
 * Create a provider adapter from a core provider
 * @param coreProvider The core provider
 * @param logService The log service
 * @returns Provider adapter
 */
export function createProviderAdapter(
	coreProvider: CoreAIProvider,
	logService: ILogService
): IAIProvider {
	return new ProviderAdapter(coreProvider, logService);
}