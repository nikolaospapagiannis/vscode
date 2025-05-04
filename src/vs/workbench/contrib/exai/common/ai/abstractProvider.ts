/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider } from './providerInterface';
import {
	AIRequest,
	ChatMessage,
	ChatOptions,
	ChatResult,
	CodeAnalysisOptions,
	CodeAnalysisResult,
	CompletionOptions,
	CompletionResult,
	EmbeddingOptions,
	EmbeddingResult,
	ImageAnalysisOptions,
	ImageAnalysisResult,
	ImageGenerationOptions,
	ImageGenerationResult,
	ProviderCapabilities,
	QuotaInfo,
	RateLimitInfo,
	TokenUsage
} from './providerTypes';
import { IConfigurationManager, ProviderConfiguration } from './configurationManager';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Abstract base class for AI providers that implements common functionality.
 */
export abstract class AbstractProvider implements AIProvider {
	// Provider identification
	abstract readonly id: string;
	abstract readonly name: string;
	abstract readonly version: string;

	// Provider capabilities
	abstract readonly capabilities: ProviderCapabilities;

	// Authentication state
	protected isAuthenticatedState: boolean = false;

	// Rate limiting and usage tracking
	protected requestCounter: number = 0;
	protected tokenUsageToday: number = 0;
	protected lastReset: Date = new Date();

	constructor(
		protected readonly configManager: IConfigurationManager,
		protected readonly logService: ILogService
	) { }

	/**
	 * Get the configuration for this provider.
	 */
	protected async getConfig(): Promise<ProviderConfiguration> {
		const config = this.configManager.getProviderConfiguration(this.id);
		return config;
	}

	/**
	 * Get the API key for this provider.
	 */
	protected async getApiKey(): Promise<string | undefined> {
		return this.configManager.getApiKey(this.id);
	}

	/**
	 * Check if the provider is authenticated.
	 */
	isAuthenticated(): boolean {
		return this.isAuthenticatedState;
	}

	/**
	 * Authenticate with the provider's API.
	 * Each provider must implement this method.
	 */
	abstract authenticate(): Promise<boolean>;

	/**
	 * Generate a text completion.
	 * Each provider must implement this method.
	 */
	abstract generateCompletion(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;

	/**
	 * Generate a chat completion.
	 * Each provider must implement this method.
	 */
	abstract generateChat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;

	/**
	 * Generate embeddings for text.
	 * Each provider must implement this method.
	 */
	abstract embedText(text: string, options?: EmbeddingOptions): Promise<EmbeddingResult>;

	/**
	 * Analyze code for issues and suggestions.
	 * Optional method that providers can implement.
	 */
	analyzeCode?(code: string, options?: CodeAnalysisOptions): Promise<CodeAnalysisResult>;

	/**
	 * Generate an image from a text prompt.
	 * Optional method that providers can implement.
	 */
	generateImage?(prompt: string, options?: ImageGenerationOptions): Promise<ImageGenerationResult>;

	/**
	 * Analyze an image.
	 * Optional method that providers can implement.
	 */
	analyzeImage?(imageData: Buffer, options?: ImageAnalysisOptions): Promise<ImageAnalysisResult>;

	/**
	 * Estimate token usage for a given text.
	 * Default implementation uses rough approximation; providers should override for accuracy.
	 */
	estimateTokenUsage(text: string): number {
		// Rough approximation: ~4 characters per token for English text
		return Math.ceil(text.length / 4);
	}

	/**
	 * Estimate the cost of a request.
	 * Default implementation uses a simple model; providers should override for accuracy.
	 */
	estimateCost(request: AIRequest): number {
		// Base cost estimate on token count
		let tokenCount = 0;

		switch (request.type) {
			case 'completion':
				tokenCount = request.prompt ? this.estimateTokenUsage(request.prompt) : 0;
				break;
			case 'chat':
				tokenCount = request.messages ?
					request.messages.reduce((sum, msg) => sum + this.estimateTokenUsage(msg.content), 0) : 0;
				break;
			case 'embedding':
				tokenCount = request.prompt ? this.estimateTokenUsage(request.prompt) : 0;
				break;
			case 'codeAnalysis':
				tokenCount = request.code ? this.estimateTokenUsage(request.code) : 0;
				break;
			case 'imageGeneration':
				// Image generation typically has a fixed cost per image
				return 0.02; // Default estimate
			case 'imageAnalysis':
				// Image analysis typically has a fixed cost per image
				return 0.01; // Default estimate
		}

		// Default cost estimation: $0.01 per 1K tokens
		return tokenCount / 1000 * 0.01;
	}

	/**
	 * Get information about rate limits for this provider.
	 */
	getRateLimit(): RateLimitInfo {
		const resetTokenCounter = () => {
			const now = new Date();
			const isNewDay = now.getDate() !== this.lastReset.getDate() ||
				now.getMonth() !== this.lastReset.getMonth() ||
				now.getFullYear() !== this.lastReset.getFullYear();

			if (isNewDay) {
				this.tokenUsageToday = 0;
				this.lastReset = now;
			}
		};

		// Check if we need to reset the token counter
		resetTokenCounter();

		// Get configured rate limits
		return this.getConfig().then(config => {
			return {
				maxRequestsPerMinute: config.rateLimit.maxRequestsPerMinute,
				maxTokensPerDay: config.rateLimit.maxTokensPerDay,
				remainingRequests: config.rateLimit.maxRequestsPerMinute - (this.requestCounter % config.rateLimit.maxRequestsPerMinute),
				remainingTokens: config.rateLimit.maxTokensPerDay - this.tokenUsageToday,
				resetTime: new Date(this.lastReset.getTime() + 24 * 60 * 60 * 1000) // Next day
			};
		});
	}

	/**
	 * Get information about remaining quota for this provider.
	 */
	getRemainingQuota(): QuotaInfo {
		// Default implementation uses daily token limits as quota
		return this.getConfig().then(config => {
			return {
				totalQuota: config.rateLimit.maxTokensPerDay,
				usedQuota: this.tokenUsageToday,
				remainingQuota: config.rateLimit.maxTokensPerDay - this.tokenUsageToday,
				quotaResetDate: new Date(this.lastReset.getTime() + 24 * 60 * 60 * 1000) // Next day
			};
		});
	}

	/**
	 * Update usage statistics after an API call.
	 */
	protected updateUsage(usage: TokenUsage): void {
		this.requestCounter++;
		this.tokenUsageToday += usage.totalTokens;

		// Log usage for debugging
		this.logService.debug(`[${this.id}] Usage: ${usage.promptTokens} prompt + ${usage.completionTokens} completion = ${usage.totalTokens} total tokens`);
	}

	/**
	 * Check if a request would exceed rate limits.
	 */
	protected async checkRateLimits(estimatedTokens: number): Promise<boolean> {
		const rateLimits = await this.getRateLimit();

		if (rateLimits.remainingRequests <= 0) {
			throw new Error(`Request rate limit exceeded for provider ${this.id}`);
		}

		if (rateLimits.remainingTokens < estimatedTokens) {
			throw new Error(`Daily token limit exceeded for provider ${this.id}`);
		}

		return true;
	}
}
