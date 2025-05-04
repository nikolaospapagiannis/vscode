/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the capabilities of an AI provider.
 */
export interface ProviderCapabilities {
	supportsCompletion: boolean;
	supportsChat: boolean;
	supportsEmbeddings: boolean;
	supportsCodeAnalysis: boolean;
	supportsImageGeneration: boolean;
	supportsImageAnalysis: boolean;
	contextWindowSize: number;
	maxTokens: number;
	supportedModels: string[];
}

/**
 * Options for generating text completions.
 */
export interface CompletionOptions {
	model?: string;
	maxTokens?: number;
	temperature?: number;
	topP?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	stop?: string[];
}

/**
 * Result of a completion request.
 */
export interface CompletionResult {
	text: string;
	finishReason: 'stop' | 'length' | 'content_filter' | 'function_call' | 'error';
	usage: TokenUsage;
	model: string;
}

/**
 * Represents a message in a chat conversation.
 */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'function';
	content: string;
	name?: string;
	functionCall?: {
		name: string;
		arguments: string;
	};
}

/**
 * Options for generating chat completions.
 */
export interface ChatOptions {
	model?: string;
	maxTokens?: number;
	temperature?: number;
	topP?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	functions?: FunctionDefinition[];
	functionCall?: 'auto' | 'none' | { name: string };
	stop?: string[];
}

/**
 * Definition of a function that the model can call.
 */
export interface FunctionDefinition {
	name: string;
	description?: string;
	parameters: Record<string, unknown>;
}

/**
 * Result of a chat completion request.
 */
export interface ChatResult {
	messages: ChatMessage[];
	finishReason: 'stop' | 'length' | 'content_filter' | 'function_call' | 'error';
	usage: TokenUsage;
	model: string;
}

/**
 * Options for generating embeddings.
 */
export interface EmbeddingOptions {
	model?: string;
	dimensions?: number;
}

/**
 * Result of an embedding request.
 */
export interface EmbeddingResult {
	embeddings: number[][];
	usage: TokenUsage;
	model: string;
}

/**
 * Options for analyzing code.
 */
export interface CodeAnalysisOptions {
	model?: string;
	analysisType?: 'security' | 'performance' | 'style' | 'bugs';
}

/**
 * Result of a code analysis request.
 */
export interface CodeAnalysisResult {
	issues: CodeIssue[];
	suggestions: CodeSuggestion[];
	usage: TokenUsage;
	model: string;
}

/**
 * Represents an issue found in code analysis.
 */
export interface CodeIssue {
	severity: 'error' | 'warning' | 'info';
	message: string;
	location: {
		file?: string;
		line?: number;
		column?: number;
	};
	code?: string;
}

/**
 * Represents a suggestion for code improvement.
 */
export interface CodeSuggestion {
	description: string;
	replacement?: string;
	location: {
		file?: string;
		line?: number;
		column?: number;
		endLine?: number;
		endColumn?: number;
	};
}

/**
 * Options for generating images.
 */
export interface ImageGenerationOptions {
	model?: string;
	size?: '256x256' | '512x512' | '1024x1024';
	quality?: 'standard' | 'hd';
	style?: 'natural' | 'vivid';
}

/**
 * Result of an image generation request.
 */
export interface ImageGenerationResult {
	imageUrls: string[];
	imageData?: Buffer[];
	usage: TokenUsage;
	model: string;
}

/**
 * Options for analyzing images.
 */
export interface ImageAnalysisOptions {
	model?: string;
	detailLevel?: 'low' | 'medium' | 'high';
	features?: ('objects' | 'text' | 'faces' | 'colors')[];
}

/**
 * Result of an image analysis request.
 */
export interface ImageAnalysisResult {
	description: string;
	objects?: ImageObject[];
	text?: ImageText[];
	colors?: ImageColor[];
	usage: TokenUsage;
	model: string;
}

/**
 * Represents an object detected in an image.
 */
export interface ImageObject {
	label: string;
	confidence: number;
	boundingBox?: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

/**
 * Represents text detected in an image.
 */
export interface ImageText {
	text: string;
	confidence: number;
	boundingBox?: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

/**
 * Represents a dominant color in an image.
 */
export interface ImageColor {
	color: string; // Hex code
	score: number;
}

/**
 * Token usage information for API calls.
 */
export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

/**
 * Generic request to an AI provider.
 */
export interface AIRequest {
	type: 'completion' | 'chat' | 'embedding' | 'codeAnalysis' | 'imageGeneration' | 'imageAnalysis';
	prompt?: string;
	messages?: ChatMessage[];
	code?: string;
	imageData?: Buffer;
	options?: Record<string, unknown>;
}

/**
 * Information about rate limits for a provider.
 */
export interface RateLimitInfo {
	maxRequestsPerMinute: number;
	maxTokensPerDay: number;
	remainingRequests: number;
	remainingTokens: number;
	resetTime: Date;
}

/**
 * Information about quota for a provider.
 */
export interface QuotaInfo {
	totalQuota: number;
	usedQuota: number;
	remainingQuota: number;
	quotaResetDate: Date | null;
}

/**
 * Task type for AI operations.
 */
export type AITask = 'completion' | 'chat' | 'embedding' | 'codeAnalysis' | 'imageGeneration' | 'imageAnalysis';

/**
 * Requirements for an AI task.
 */
export interface TaskRequirements {
	minContextWindow?: number;
	requiredCapabilities?: string[];
	preferredModel?: string;
	maxCost?: number;
	maxLatency?: number;
}
