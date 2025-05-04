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
 * Perplexity AI Provider implementation
 */
export class PerplexityProvider extends AbstractProvider {
	// Provider identification
	readonly id = 'perplexity';
	readonly name = 'Perplexity';
	readonly version = '1.0.0';

	// Provider capabilities
	readonly capabilities: ProviderCapabilities = {
		supportsCompletion: true,
		supportsChat: true,
		supportsEmbeddings: false,
		supportsCodeAnalysis: true,
		supportsImageGeneration: false,
		supportsImageAnalysis: false,
		contextWindowSize: 32000, // Perplexity context size
		maxTokens: 4096, // Maximum output tokens
		supportedModels: [
			'pplx-70b-online',
			'pplx-7b-online',
			'pplx-70b-chat',
			'codellama-70b-instruct',
			'llama-3-70b-instruct',
			'sonar-small-online',
			'sonar-medium-online',
			'mixtral-8x7b-instruct'
		]
	};

	// API endpoints
	private readonly apiBaseUrl: string = 'https://api.perplexity.ai';
	private readonly chatEndpoint: string = '/chat/completions';

	constructor(
		@IConfigurationManager configManager: IConfigurationManager,
		@ILogService logService: ILogService,
		@IRequestService private readonly requestService: IRequestService
	) {
		super(configManager, logService);
	}

	/**
	 * Authenticate with the Perplexity API.
	 * @returns Whether authentication was successful
	 */
	async authenticate(): Promise<boolean> {
		try {
			const apiKey = await this.getApiKey();

			if (!apiKey) {
				this.logService.warn('Perplexity API key not found');
				this.isAuthenticatedState = false;
				return false;
			}

			// Test the API key with a minimal request
			const config = await this.getConfig();
			const baseUrl = config.baseUrl || this.apiBaseUrl;

			// Since Perplexity doesn't have a dedicated endpoint for checking auth status,
			// we'll use a minimal request to test the API key
			const response = await this.requestService.request({
				type: 'GET',
				url: `${baseUrl}/models`,
				headers: {
					'Authorization': `Bearer ${apiKey}`
				}
			}, CancellationToken.None);

			this.isAuthenticatedState = response.status === 200;
			return this.isAuthenticatedState;
		} catch (error) {
			this.logService.error('Perplexity authentication failed:', error);
			this.isAuthenticatedState = false;
			return false;
		}
	}

	/**
	 * Generate a text completion from Perplexity.
	 * For Perplexity, we use the chat API and format as a simple completion.
	 * @param prompt The prompt to generate a completion for
	 * @param options Completion options
	 * @returns The generated completion
	 */
	async generateCompletion(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
		// For Perplexity, we'll use the chat API for completions
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
	 * Generate a chat completion from Perplexity.
	 * @param messages The chat messages to generate a completion for
	 * @param options Chat options
	 * @returns The generated chat completion
	 */
	async generateChat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
		if (!this.isAuthenticatedState) {
			await this.authenticate();

			if (!this.isAuthenticatedState) {
				throw new Error('Authentication required for Perplexity provider');
			}
		}

		const config = await this.getConfig();
		const apiKey = await this.getApiKey();

		if (!apiKey) {
			throw new Error('Perplexity API key not found');
		}

		// Calculate token estimation for all messages
		let estimatedTokens = 0;
		for (const message of messages) {
			estimatedTokens += this.estimateTokenUsage(message.content);
		}
		estimatedTokens += (options?.maxTokens || 1000);
		await this.checkRateLimits(estimatedTokens);

		const baseUrl = config.baseUrl || this.apiBaseUrl;
		const model = options?.model || config.models.chat || config.models.default || 'pplx-70b-online';

		try {
			const response = await this.requestService.request({
				type: 'POST',
				url: `${baseUrl}${this.chatEndpoint}`,
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				data: JSON.stringify({
					model,
					messages: messages.map(msg => ({
						role: msg.role,
						content: msg.content,
						...(msg.name ? { name: msg.name } : {})
					})),
					max_tokens: options?.maxTokens || 1000,
					temperature: options?.temperature ?? 0.7,
					top_p: options?.topP ?? 1,
					stream: false
				})
			}, CancellationToken.None);

			if (response.status !== 200) {
				const errorData = JSON.parse(await response.bodyText());
				throw new Error(`Perplexity API error: ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
			}

			const responseData = JSON.parse(await response.bodyText());

			const usage: TokenUsage = {
				promptTokens: responseData.usage.prompt_tokens,
				completionTokens: responseData.usage.completion_tokens,
				totalTokens: responseData.usage.total_tokens
			};

			// Update usage statistics
			this.updateUsage(usage);

			// Process the response message
			const responseMessage: ChatMessage = {
				role: 'assistant',
				content: responseData.choices[0].message.content
			};

			return {
				messages: [responseMessage],
				finishReason: responseData.choices[0].finish_reason || 'stop',
				usage,
				model: responseData.model
			};
		} catch (error) {
			this.logService.error('Perplexity chat generation failed:', error);
			throw error;
		}
	}

	/**
	 * Generate embeddings for text.
	 * Note: Perplexity currently doesn't offer an embeddings API, so this is a placeholder.
	 * @param text The text to generate embeddings for
	 * @param options Embedding options
	 * @returns The generated embeddings
	 */
	async embedText(text: string, options?: EmbeddingOptions): Promise<EmbeddingResult> {
		throw new Error('Embedding generation is not supported by Perplexity');
	}

	/**
	 * Analyze code for issues and suggestions using Perplexity.
	 * @param code The code to analyze
	 * @param options Code analysis options
	 * @returns The analysis results
	 */
	async analyzeCode(code: string, options?: any): Promise<any> {
		const analysisType = options?.analysisType || 'bugs';

		// Create a prompt for the code analysis
		let systemPrompt = 'You are an expert code reviewer. Analyze the following code for ';

		switch (analysisType) {
			case 'security':
				systemPrompt += 'security vulnerabilities and potential exploits.';
				break;
			case 'performance':
				systemPrompt += 'performance issues and optimization opportunities.';
				break;
			case 'style':
				systemPrompt += 'style issues and adherence to best practices.';
				break;
			case 'bugs':
			default:
				systemPrompt += 'potential bugs, logic errors, and edge case problems.';
				break;
		}

		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: `Please analyze this code:\n\`\`\`\n${code}\n\`\`\`` }
		];

		const chatResult = await this.generateChat(messages, {
			model: options?.model || 'pplx-70b-online',
			temperature: 0.3 // Lower temperature for more deterministic analysis
		});

		// Parse the response to extract issues and suggestions
		const response = chatResult.messages[0].content;

		// Simple parsing strategy - in a real implementation we would use a more structured prompt
		// and parsing logic based on the specific response format
		const issuesSection = response.match(/(?:Issues|Bugs|Problems):(.*?)(?:Suggestions|Recommendations|$)/si);
		const suggestionsSection = response.match(/(?:Suggestions|Recommendations):(.*?)$/si);

		// Extract issues
		const issues = issuesSection ? this.parseIssues(issuesSection[1]) : [];

		// Extract suggestions
		const suggestions = suggestionsSection ? this.parseSuggestions(suggestionsSection[1]) : [];

		return {
			issues,
			suggestions,
			usage: chatResult.usage,
			model: chatResult.model
		};
	}

	/**
	 * Parse issues from a text block.
	 * This is a simplified implementation and would be more sophisticated in a real system.
	 */
	private parseIssues(text: string): any[] {
		const issueLines = text.split('\n').filter(line => line.trim().length > 0);
		return issueLines.map(line => {
			// Simple heuristic to determine severity
			const severity = line.toLowerCase().includes('critical') || line.toLowerCase().includes('severe') ?
				'error' : line.toLowerCase().includes('warning') ? 'warning' : 'info';

			return {
				severity,
				message: line.trim(),
				location: {}
			};
		});
	}

	/**
	 * Parse suggestions from a text block.
	 * This is a simplified implementation and would be more sophisticated in a real system.
	 */
	private parseSuggestions(text: string): any[] {
		const suggestionLines = text.split('\n').filter(line => line.trim().length > 0);
		return suggestionLines.map(line => {
			return {
				description: line.trim(),
				location: {}
			};
		});
	}

	/**
	 * More accurate token counting for Perplexity models.
	 * Uses an approximation similar to OpenAI's cl100k_base encoding.
	 */
	override estimateTokenUsage(text: string): number {
		if (!text) {
			return 0;
		}

		// Perplexity uses tokenization similar to OpenAI's GPT models
		// Roughly 4 characters per token for English text
		let tokenEstimate = Math.ceil(text.length / 4);

		// Adjust for code-specific structures that often encode as separate tokens
		const codeElements = (text.match(/[{}[\]().,;:=<>+\-*/&|^%$#@!~`'"\\]/g) || []).length;
		tokenEstimate += codeElements;

		// Add some buffer for the potential of non-English characters
		return Math.ceil(tokenEstimate * 1.1);
	}

	/**
	 * More accurate cost estimation for Perplexity models.
	 */
	override estimateCost(request: any): number {
		// Perplexity pricing (approximate as of implementation)
		const modelCosts: Record<string, { input: number, output: number }> = {
			'pplx-70b-online': { input: 0.0008, output: 0.0024 },
			'pplx-7b-online': { input: 0.0002, output: 0.0006 },
			'sonar-small-online': { input: 0.0001, output: 0.0003 },
			'sonar-medium-online': { input: 0.0004, output: 0.0012 },
			'default': { input: 0.0004, output: 0.0012 }
		};

		let model = 'default'; // default
		let inputTokens = 0;
		let outputTokens = 0;

		switch (request.type) {
			case 'completion':
				model = request.options?.model || 'pplx-70b-online';
				inputTokens = this.estimateTokenUsage(request.prompt || '');
				outputTokens = request.options?.maxTokens || 1000;
				break;

			case 'chat':
				model = request.options?.model || 'pplx-70b-online';
				inputTokens = request.messages ?
					request.messages.reduce((sum, msg) => sum + this.estimateTokenUsage(msg.content || ''), 0) : 0;
				outputTokens = request.options?.maxTokens || 1000;
				break;

			case 'codeAnalysis':
				model = request.options?.model || 'pplx-70b-online';
				inputTokens = this.estimateTokenUsage(request.code || '');
				outputTokens = 1500; // Rough estimate for analysis response
				break;
		}

		// Find the cost for the specified model, or use a default cost
		const costRates = modelCosts[model] || modelCosts.default;

		// Calculate total cost
		const inputCost = (inputTokens / 1000) * costRates.input;
		const outputCost = (outputTokens / 1000) * costRates.output;

		return inputCost + outputCost;
	}
}