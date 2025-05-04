/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ProviderCapabilities,
	CompletionOptions,
	CompletionResult,
	ChatMessage,
	ChatOptions,
	ChatResult,
	EmbeddingOptions,
	EmbeddingResult,
	CodeAnalysisOptions,
	CodeAnalysisResult,
	ImageGenerationOptions,
	ImageGenerationResult,
	ImageAnalysisOptions,
	ImageAnalysisResult,
	AIRequest,
	RateLimitInfo,
	QuotaInfo
} from './providerTypes';

/**
 * Interface that all AI providers must implement.
 */
export interface AIProvider {
	// Provider identification
	id: string;
	name: string;
	version: string;

	// Capability advertising
	readonly capabilities: ProviderCapabilities;

	// Authentication
	authenticate(): Promise<boolean>;
	isAuthenticated(): boolean;

	// Core operations
	generateCompletion(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
	generateChat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
	embedText(text: string, options?: EmbeddingOptions): Promise<EmbeddingResult>;

	// Advanced operations (optional)
	analyzeCode?(code: string, options?: CodeAnalysisOptions): Promise<CodeAnalysisResult>;
	generateImage?(prompt: string, options?: ImageGenerationOptions): Promise<ImageGenerationResult>;
	analyzeImage?(imageData: Buffer, options?: ImageAnalysisOptions): Promise<ImageAnalysisResult>;

	// Cost estimation
	estimateTokenUsage(text: string): number;
	estimateCost(request: AIRequest): number;

	// Rate limiting and quota management
	getRateLimit(): RateLimitInfo;
	getRemainingQuota(): QuotaInfo;
}
