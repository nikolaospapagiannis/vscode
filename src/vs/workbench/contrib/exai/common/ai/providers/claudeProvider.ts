/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbstractProvider } from '../abstractProvider';
import {
	ChatMessage,
	ChatOptions,
	ChatResult,
	CompletionOptions,
	CompletionResult,
	EmbeddingOptions,
	EmbeddingResult,
	ProviderCapabilities,
	TokenUsage
} from '../providerTypes';
import { IConfigurationManager } from '../configurationManager';
import { ILogService } from 'vs/platform/log/common/log';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IRequestService } from 'vs/platform/request/common/request';

/**
 * Claude (Anthropic) Provider implementation
 */
export class ClaudeProvider extends AbstractProvider {
	// Provider identification
	readonly id = 'claude';
	readonly name = 'Claude';
	readonly version = '1.0.0';

	// Provider capabilities
	readonly capabilities: ProviderCapabilities = {
		supportsCompletion: true,
		supportsChat: true,
		supportsEmbeddings: false,
		supportsCodeAnalysis: true,
		supportsImageGeneration: false,
		supportsImageAnalysis: true,
		contextWindowSize: 100000, // Claude 3 Opus context size
		maxTokens: 4096, // Maximum output tokens
		supportedModels: [
			'claude-3-opus',
			'claude-3-sonnet',
			'claude-3-haiku',
			'claude-2.1',
			'claude-2.0'
		]
	};

	// API endpoints
	private readonly apiBaseUrl: string = 'https://api.anthropic.com';
	private readonly completionsEndpoint: string = '/v1/messages';

	constructor(
		@IConfigurationManager configManager: IConfigurationManager,
		@ILogService logService: ILogService,
		@IRequestService private readonly requestService: IRequestService
	) {
		super(configManager, logService);
	}

	/**
	 * Authenticate with the Anthropic API.
	 * @returns Whether authentication was successful
	 */
	async authenticate(): Promise<boolean> {
		try {
			const apiKey = await this.getApiKey();

			if (!apiKey) {
				this.logService.warn('Claude API key not found');
				this.isAuthenticatedState = false;
				return false;
			}

			// Test the API key with a minimal request
			const config = await this.getConfig();
			const baseUrl = config.baseUrl || this.apiBaseUrl;

			// Since Anthropic doesn't have a dedicated endpoint for checking auth status,
			// we'll use a minimal request to test the API key
			const response = await this.requestService.request({
				type: 'GET',
				url: `${baseUrl}/v1/models`,
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01'
				}
			}, CancellationToken.None);

			this.isAuthenticatedState = response.status === 200;
			return this.isAuthenticatedState;
		} catch (error) {
			this.logService.error('Claude authentication failed:', error);
			this.isAuthenticatedState = false;
			return false;
		}
	}

	/**
	 * Generate a text completion from Claude.
	 * For Claude, we use the chat API and format as a simple completion.
	 * @param prompt The prompt to generate a completion for
	 * @param options Completion options
	 * @returns The generated completion
	 */
	async generateCompletion(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
		// For Claude, we'll use the chat API for completions
		const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
		const chatResult = await this.generateChat(messages, options);

		return {
			text: chatResult.messages[0].content,
			finishReason: chatResult.finishReason,
			usage: chatResult.usage,
			model: chatResult.model
		};
	}

	/**
	 * Generate a chat completion from Claude.
	 * @param messages The chat messages to generate a completion for
	 * @param options Chat options
	 * @returns The generated chat completion
	 */
	async generateChat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
		if (!this.isAuthenticatedState) {
			await this.authenticate();

			if (!this.isAuthenticatedState) {
				throw new Error('Authentication required for Claude provider');
			}
		}

		const config = await this.getConfig();
		const apiKey = await this.getApiKey();

		if (!apiKey) {
			throw new Error('Claude API key not found');
		}

		// Calculate token estimation for all messages
		let estimatedTokens = 0;
		for (const message of messages) {
			estimatedTokens += this.estimateTokenUsage(message.content);
		}
		estimatedTokens += (options?.maxTokens || 1000);
		await this.checkRateLimits(estimatedTokens);

		const baseUrl = config.baseUrl || this.apiBaseUrl;
		const model = options?.model || config.models.chat || config.models.default || 'claude-3-sonnet';

		try {
			// Convert VS Code chat format to Claude format
			// Claude expects a specific format:
			// - user and assistant roles map directly
			// - system messages need to be part of the first user message

			const claudeMessages: Array<{ role: string, content: string }> = [];
			let systemMessage = '';

			// Extract system message if present
			for (const message of messages) {
				if (message.role === 'system') {
					systemMessage += message.content + '\n';
				}
			}

			// Build Claude-formatted messages
			for (const message of messages) {
				if (message.role !== 'system') {
					claudeMessages.push({
						role: message.role === 'assistant' ? 'assistant' : 'user',
						content: message.content
					});
				}
			}

			// If we have a system message, prepend it to the first user message
			if (systemMessage && claudeMessages.length > 0 && claudeMessages[0].role === 'user') {
				claudeMessages[0].content = `${systemMessage}\n${claudeMessages[0].content}`;
			} else if (systemMessage) {
				// If there's only a system message, create a user message with it
				claudeMessages.unshift({
					role: 'user',
					content: systemMessage
				});
			}

			const response = await this.requestService.request({
				type: 'POST',
				url: `${baseUrl}${this.completionsEndpoint}`,
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'Content-Type': 'application/json'
				},
				data: JSON.stringify({
					model,
					messages: claudeMessages,
					max_tokens: options?.maxTokens || 1000,
					temperature: options?.temperature ?? 0.7,
					top_p: options?.topP ?? 1,
					stream: false
				})
			}, CancellationToken.None);

			if (response.status !== 200) {
				const errorData = JSON.parse(await response.bodyText());
				throw new Error(`Claude API error: ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
			}

			const responseData = JSON.parse(await response.bodyText());

			// Claude doesn't provide token usage in the same way as OpenAI,
			// so we need to estimate it
			const promptTokens = this.estimateTokenUsage(messages.map(m => m.content).join(' '));
			const completionTokens = this.estimateTokenUsage(responseData.content[0].text);

			const usage: TokenUsage = {
				promptTokens,
				completionTokens,
				totalTokens: promptTokens + completionTokens
			};

			// Update usage statistics
			this.updateUsage(usage);

			// Process the response message
			const responseMessage: ChatMessage = {
				role: 'assistant',
				content: responseData.content[0].text
			};

			return {
				messages: [responseMessage],
				finishReason: responseData.stop_reason || 'stop',
				usage,
				model: responseData.model
			};
		} catch (error) {
			this.logService.error('Claude chat generation failed:', error);
			throw error;
		}
	}

	/**
	 * Generate embeddings for text.
	 * Note: Claude currently doesn't offer an embeddings API, so this is a placeholder.
	 * @param text The text to generate embeddings for
	 * @param options Embedding options
	 * @returns The generated embeddings
	 */
	async embedText(text: string, options?: EmbeddingOptions): Promise<EmbeddingResult> {
		throw new Error('Embedding generation is not supported by Claude');
	}

	/**
	 * Analyze image using Claude's vision capabilities.
	 * @param imageData The image data to analyze
	 * @param options Analysis options
	 */
	async analyzeImage(imageData: Buffer, options?: any): Promise<any> {
		if (!this.isAuthenticatedState) {
			await this.authenticate();

			if (!this.isAuthenticatedState) {
				throw new Error('Authentication required for Claude provider');
			}
		}

		const config = await this.getConfig();
		const apiKey = await this.getApiKey();

		if (!apiKey) {
			throw new Error('Claude API key not found');
		}

		const baseUrl = config.baseUrl || this.apiBaseUrl;
		const model = options?.model || config.models.default || 'claude-3-sonnet';

		// Convert image to base64
		const base64Image = imageData.toString('base64');
		const imageType = this.detectImageMimeType(imageData) || 'image/png';

		// Prepare the message with the image
		const messages = [
			{
				role: 'user',
				content: [
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: imageType,
							data: base64Image
						}
					},
					{
						type: 'text',
						text: options?.prompt || 'Describe this image in detail.'
					}
				]
			}
		];

		try {
			const response = await this.requestService.request({
				type: 'POST',
				url: `${baseUrl}${this.completionsEndpoint}`,
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'Content-Type': 'application/json'
				},
				data: JSON.stringify({
					model,
					messages,
					max_tokens: options?.maxTokens || 1000,
					temperature: options?.temperature ?? 0.7
				})
			}, CancellationToken.None);

			if (response.status !== 200) {
				const errorData = JSON.parse(await response.bodyText());
				throw new Error(`Claude API error: ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
			}

			const responseData = JSON.parse(await response.bodyText());

			// Since Claude returns a free-form description, we'll need to do some post-processing
			// to format it in a more structured way
			const description = responseData.content[0].text;

			// Estimate token usage
			const promptTokens = this.estimateTokenUsage(options?.prompt || 'Describe this image in detail.') + 1000; // Add 1000 tokens for the image
			const completionTokens = this.estimateTokenUsage(description);

			const usage: TokenUsage = {
				promptTokens,
				completionTokens,
				totalTokens: promptTokens + completionTokens
			};

			// Update usage statistics
			this.updateUsage(usage);

			return {
				description,
				usage,
				model: responseData.model
			};
		} catch (error) {
			this.logService.error('Claude image analysis failed:', error);
			throw error;
		}
	}

	/**
	 * Detect the MIME type of an image from its header bytes.
	 * @param buffer The image buffer
	 * @returns The MIME type or undefined if not detected
	 */
	private detectImageMimeType(buffer: Buffer): string | undefined {
		const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
		const jpegSignature = [0xFF, 0xD8, 0xFF];
		const webpSignature = [0x52, 0x49, 0x46, 0x46]; // WebP files start with "RIFF"

		// Check PNG
		if (buffer.length >= pngSignature.length) {
			let isPng = true;
			for (let i = 0; i < pngSignature.length; i++) {
				if (buffer[i] !== pngSignature[i]) {
					isPng = false;
					break;
				}
			}
			if (isPng) {
				return 'image/png';
			}
		}

		// Check JPEG
		if (buffer.length >= jpegSignature.length) {
			let isJpeg = true;
			for (let i = 0; i < jpegSignature.length; i++) {
				if (buffer[i] !== jpegSignature[i]) {
					isJpeg = false;
					break;
				}
			}
			if (isJpeg) {
				return 'image/jpeg';
			}
		}

		// Check WebP
		if (buffer.length >= 12) { // WebP needs more bytes to check
			let isWebP = true;
			for (let i = 0; i < webpSignature.length; i++) {
				if (buffer[i] !== webpSignature[i]) {
					isWebP = false;
					break;
				}
			}
			if (isWebP && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
				// "WEBP" at offset 8
				return 'image/webp';
			}
		}

		return 'application/octet-stream'; // Default fallback
	}

	/**
	 * More accurate token counting for Claude models.
	 * Uses an approximation of Claude's tokenization.
	 */
	override estimateTokenUsage(text: string): number {
		if (!text) {
			return 0;
		}

		// Claude's tokenization is roughly equivalent to GPT's cl100k_base,
		// so we can use a similar approximation
		// Roughly 4 characters per token for English text
		let tokenEstimate = Math.ceil(text.length / 4);

		// Adjust for code-specific structures that often encode as separate tokens
		const codeElements = (text.match(/[{}[\]().,;:=<>+\-*/&|^%$#@!~`'"\\]/g) || []).length;
		tokenEstimate += codeElements;

		// Add some buffer for the potential of non-English characters
		return Math.ceil(tokenEstimate * 1.1);
	}
}
