/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbstractProvider } from '../abstractProvider';
import {
	ChatMessage,
	ChatOptions,
	ChatResult,
	CodeAnalysisOptions,
	CodeAnalysisResult,
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
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

/**
 * OpenAI Provider implementation
 */
export class OpenAIProvider extends AbstractProvider {
	// Provider identification
	readonly id = 'openai';
	readonly name = 'OpenAI';
	readonly version = '1.0.0';
	
	// Provider capabilities
	readonly capabilities: ProviderCapabilities = {
		supportsCompletion: true,
		supportsChat: true,
		supportsEmbeddings: true,
		supportsCodeAnalysis: true,
		supportsImageGeneration: true,
		supportsImageAnalysis: false,
		contextWindowSize: 128000, // GPT-4 Turbo context size
		maxTokens: 4096, // Maximum output tokens
		supportedModels: [
			'gpt-4-turbo',
			'gpt-4',
			'gpt-3.5-turbo',
			'text-embedding-ada-002',
			'dall-e-3'
		]
	};
	
	// API endpoints
	private readonly apiBaseUrl: string = 'https://api.openai.com/v1';
	private readonly chatEndpoint: string = '/chat/completions';
	private readonly completionEndpoint: string = '/completions';
	private readonly embeddingEndpoint: string = '/embeddings';
	private readonly imageEndpoint: string = '/images/generations';
	
	constructor(
		@IConfigurationManager configManager: IConfigurationManager,
		@ILogService logService: ILogService,
		@IRequestService private readonly requestService: IRequestService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super(configManager, logService);
	}
	
	/**
	 * Authenticate with the OpenAI API.
	 * @returns Whether authentication was successful
	 */
	async authenticate(): Promise<boolean> {
		try {
			const apiKey = await this.getApiKey();
			
			if (!apiKey) {
				this.logService.warn('OpenAI API key not found');
				this.isAuthenticatedState = false;
				return false;
			}
			
			// Test the API key with a minimal request
			const config = await this.getConfig();
			const baseUrl = config.baseUrl || this.apiBaseUrl;
			
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
			this.logService.error('OpenAI authentication failed:', error);
			this.isAuthenticatedState = false;
			return false;
		}
	}
	
	/**
	 * Generate a text completion from OpenAI.
	 * @param prompt The prompt to generate a completion for
	 * @param options Completion options
	 * @returns The generated completion
	 */
	async generateCompletion(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
		if (!this.isAuthenticatedState) {
			await this.authenticate();
			
			if (!this.isAuthenticatedState) {
				throw new Error('Authentication required for OpenAI provider');
			}
		}
		
		const config = await this.getConfig();
		const apiKey = await this.getApiKey();
		
		if (!apiKey) {
			throw new Error('OpenAI API key not found');
		}
		
		// Calculate token estimation
		const estimatedTokens = this.estimateTokenUsage(prompt) + (options?.maxTokens || 1000);
		await this.checkRateLimits(estimatedTokens);
		
		const baseUrl = config.baseUrl || this.apiBaseUrl;
		const model = options?.model || config.models.completion || config.models.default || 'gpt-3.5-turbo-instruct';
		
		// For newer models, use the chat endpoint instead
		if (model.startsWith('gpt-3.5-turbo') || model.startsWith('gpt-4')) {
			const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
			const chatResult = await this.generateChat(messages, {
				...options,
				model
			});
			
			return {
				text: chatResult.messages[0].content,
				finishReason: chatResult.finishReason,
				usage: chatResult.usage,
				model: chatResult.model
			};
		}
		
		try {
			const response = await this.requestService.request({
				type: 'POST',
				url: `${baseUrl}${this.completionEndpoint}`,
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				data: JSON.stringify({
					model,
					prompt,
					max_tokens: options?.maxTokens || 1000,
					temperature: options?.temperature ?? 0.7,
					top_p: options?.topP ?? 1,
					frequency_penalty: options?.frequencyPenalty ?? 0,
					presence_penalty: options?.presencePenalty ?? 0,
					stop: options?.stop || null
				})
			}, CancellationToken.None);
			
			if (response.status !== 200) {
				throw new Error(`OpenAI API error: ${response.statusText}`);
			}
			
			const responseData = JSON.parse(await response.bodyText());
			
			const usage: TokenUsage = {
				promptTokens: responseData.usage.prompt_tokens,
				completionTokens: responseData.usage.completion_tokens,
				totalTokens: responseData.usage.total_tokens
			};
			
			// Update usage statistics
			this.updateUsage(usage);
			
			return {
				text: responseData.choices[0].text,
				finishReason: responseData.choices[0].finish_reason,
				usage,
				model: responseData.model
			};
		} catch (error) {
			this.logService.error('OpenAI completion generation failed:', error);
			throw error;
		}
	}
	
	/**
	 * Generate a chat completion from OpenAI.
	 * @param messages The chat messages to generate a completion for
	 * @param options Chat options
	 * @returns The generated chat completion
	 */
	async generateChat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
		if (!this.isAuthenticatedState) {
			await this.authenticate();
			
			if (!this.isAuthenticatedState) {
				throw new Error('Authentication required for OpenAI provider');
			}
		}
		
		const config = await this.getConfig();
		const apiKey = await this.getApiKey();
		
		if (!apiKey) {
			throw new Error('OpenAI API key not found');
		}
		
		// Calculate token estimation for all messages
		let estimatedTokens = 0;
		for (const message of messages) {
			estimatedTokens += this.estimateTokenUsage(message.content);
		}
		estimatedTokens += (options?.maxTokens || 1000);
		await this.checkRateLimits(estimatedTokens);
		
		const baseUrl = config.baseUrl || this.apiBaseUrl;
		const model = options?.model || config.models.chat || config.models.default || 'gpt-3.5-turbo';
		
		try {
			// Prepare the request payload
			const payload: any = {
				model,
				messages: messages.map(msg => ({
					role: msg.role,
					content: msg.content,
					...(msg.name ? { name: msg.name } : {}),
					...(msg.functionCall ? { function_call: {
						name: msg.functionCall.name,
						arguments: msg.functionCall.arguments
					}} : {})
				})),
				max_tokens: options?.maxTokens || 1000,
				temperature: options?.temperature ?? 0.7,
				top_p: options?.topP ?? 1,
				frequency_penalty: options?.frequencyPenalty ?? 0,
				presence_penalty: options?.presencePenalty ?? 0,
				stop: options?.stop || null
			};
			
			// Add functions if provided
			if (options?.functions && options.functions.length > 0) {
				payload.functions = options.functions;
				
				if (options.functionCall === 'auto' || options.functionCall === 'none') {
					payload.function_call = options.functionCall;
				} else if (options.functionCall) {
					payload.function_call = {
						name: options.functionCall.name
					};
				}
			}
			
			const response = await this.requestService.request({
				type: 'POST',
				url: `${baseUrl}${this.chatEndpoint}`,
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				data: JSON.stringify(payload)
			}, CancellationToken.None);
			
			if (response.status !== 200) {
				const errorData = JSON.parse(await response.bodyText());
				throw new Error(`OpenAI API error: ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
			}
			
			const responseData = JSON.parse(await response.bodyText());
			
			const usage: TokenUsage = {
				promptTokens: responseData.usage.prompt_tokens,
				completionTokens: responseData.usage.completion_tokens,
				totalTokens: responseData.usage.total_tokens
			};
			
			// Update usage statistics
			this.updateUsage(usage);
			
			// Process the response messages
			const responseMessages: ChatMessage[] = responseData.choices.map((choice: any) => {
				const message: ChatMessage = {
					role: choice.message.role,
					content: choice.message.content || ''
				};
				
				// Add function call if present
				if (choice.message.function_call) {
					message.functionCall = {
						name: choice.message.function_call.name,
						arguments: choice.message.function_call.arguments
					};
				}
				
				return message;
			});
			
			return {
				messages: responseMessages,
				finishReason: responseData.choices[0].finish_reason,
				usage,
				model: responseData.model
			};
		} catch (error) {
			this.logService.error('OpenAI chat generation failed:', error);
			throw error;
		}
	}
	
	/**
	 * Generate embeddings for text from OpenAI.
	 * @param text The text to generate embeddings for
	 * @param options Embedding options
	 * @returns The generated embeddings
	 */
	async embedText(text: string, options?: EmbeddingOptions): Promise<EmbeddingResult> {
		if (!this.isAuthenticatedState) {
			await this.authenticate();
			
			if (!this.isAuthenticatedState) {
				throw new Error('Authentication required for OpenAI provider');
			}
		}
		
		const config = await this.getConfig();
		const apiKey = await this.getApiKey();
		
		if (!apiKey) {
			throw new Error('OpenAI API key not found');
		}
		
		// Calculate token estimation
		const estimatedTokens = this.estimateTokenUsage(text);
		await this.checkRateLimits(estimatedTokens);
		
		const baseUrl = config.baseUrl || this.apiBaseUrl;
		const model = options?.model || config.models.embedding || 'text-embedding-ada-002';
		
		try {
			const response = await this.requestService.request({
				type: 'POST',
				url: `${baseUrl}${this.embeddingEndpoint}`,
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				data: JSON.stringify({
					model,
					input: text,
					dimensions: options?.dimensions
				})
			}, CancellationToken.None);
			
			if (response.status !== 200) {
				throw new Error(`OpenAI API error: ${response.statusText}`);
			}
			
			const responseData = JSON.parse(await response.bodyText());
			
			const usage: TokenUsage = {
				promptTokens: responseData.usage.prompt_tokens,
				completionTokens: 0, // Embeddings don't have completion tokens
				totalTokens: responseData.usage.total_tokens
			};
			
			// Update usage statistics
			this.updateUsage(usage);
			
			return {
				embeddings: responseData.data.map((item: any) => item.embedding),
				usage,
				model: responseData.model
			};
		} catch (error) {
			this.logService.error('OpenAI embedding generation failed:', error);
			throw error;
		}
	}
	
	/**
	 * Analyze code for issues and suggestions using OpenAI.
	 * @param code The code to analyze
	 * @param options Code analysis options
	 * @returns The analysis results
	 */
	async analyzeCode(code: string, options?: CodeAnalysisOptions): Promise<CodeAnalysisResult> {
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
			model: options?.model || 'gpt-4-turbo',
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
	private parseIssues(text: string): CodeIssue[] {
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
	private parseSuggestions(text: string): CodeSuggestion[] {
		const suggestionLines = text.split('\n').filter(line => line.trim().length > 0);
		return suggestionLines.map(line => {
			return {
				description: line.trim(),
				location: {}
			};
		});
	}
	
	/**
	 * More accurate token counting for OpenAI models.
	 * Uses the cl100k_base encoding rules approximation.
	 */
	override estimateTokenUsage(text: string): number {
		if (!text) {
			return 0;
		}
		
		// This is a very rough approximation of the cl100k_base encoding
		// In a real implementation, we would use the tiktoken library or similar
		
		// Roughly 4 characters per token for English text
		// Special case handling for common code elements
		let tokenEstimate = Math.ceil(text.length / 4);
		
		// Adjust for code-specific structures that often encode as separate tokens
		const codeElements = (text.match(/[{}[\]().,;:=<>+\-*/&|^%$#@!~`'"\\]/g) || []).length;
		tokenEstimate += codeElements;
		
		// Add some buffer for the potential of non-English characters
		return Math.ceil(tokenEstimate * 1.1);
	}
	
	/**
	 * More accurate cost estimation for OpenAI models.
	 */
	override estimateCost(request: any): number {
		// Models and their approximate costs per 1K tokens
		const modelCosts: Record<string, { input: number, output: number }> = {
			'gpt-4-turbo': { input: 0.01, output: 0.03 },
			'gpt-4': { input: 0.03, output: 0.06 },
			'gpt-3.5-turbo': { input: 0.001, output: 0.002 },
			'text-embedding-ada-002': { input: 0.0001, output: 0 }
		};
		
		let model = 'gpt-3.5-turbo'; // default
		let inputTokens = 0;
		let outputTokens = 0;
		
		switch (request.type) {
			case 'completion':
				model = request.options?.model || 'gpt-3.5-turbo';
				inputTokens = this.estimateTokenUsage(request.prompt || '');
				outputTokens = request.options?.maxTokens || 1000;
				break;
				
			case 'chat':
				model = request.options?.model || 'gpt-3.5-turbo';
				inputTokens = request.messages ?
					request.messages.reduce((sum, msg) => sum + this.estimateTokenUsage(msg.content || ''), 0) : 0;
				outputTokens = request.options?.maxTokens || 1000;
				break;
				
			case 'embedding':
				model = request.options?.model || 'text-embedding-ada-002';
				inputTokens = this.estimateTokenUsage(request.prompt || '');
				outputTokens = 0; // Embeddings don't have output tokens
				break;
				
			case 'codeAnalysis':
				model = request.options?.model || 'gpt-4-turbo';
				inputTokens = this.estimateTokenUsage(request.code || '');
				outputTokens = 1500; // Rough estimate for analysis response
				break;
				
			case 'imageGeneration':
				// DALL-E pricing is per image and quality-dependent
				const quality = request.options?.quality || 'standard';
				const size = request.options?.size || '1024x1024';
				
				if (request.options?.model === 'dall-e-3') {
					return quality === 'hd' ? 0.08 : 0.04;
				}
				
				// DALL-E 2 pricing
				switch (size) {
					case '256x256': return 0.016;
					case '512x512': return 0.018;
					case '1024x1024': return 0.02;
					default: return 0.02;
				}
		}
		
		// Find the cost for the specified model, or use a default cost
		const costRates = modelCosts[model] || { input: 0.002, output: 0.002 };
		
		// Calculate total cost
		const inputCost = (inputTokens / 1000) * costRates.input;
		const outputCost = (outputTokens / 1000) * costRates.output;
		
		return inputCost + outputCost;
	}
}