/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { IDisposable } from 'vs/base/common/lifecycle';

/**
 * Types of AI providers supported by the framework
 */
export enum AIProviderType {
	OpenAI = 'openai',
	Claude = 'claude',
	Perplexity = 'perplexity',
	Copilot = 'copilot',
	Custom = 'custom'
}

/**
 * Authentication status for a provider
 */
export type AIProviderAuthStatus = 'unauthenticated' | 'authenticated' | 'error';

/**
 * Pricing tier for models
 */
export type PricingTier = 'free' | 'paid' | 'enterprise';

/**
 * Message role in a conversation
 */
export type AIMessageRole = 'system' | 'user' | 'assistant' | 'function' | 'tool';

/**
 * Model capabilities
 */
export interface AIModelCapabilities {
	supportsImages: boolean;
	supportsToolCalling: boolean;
	supportsStreaming: boolean;
}

/**
 * Information about an AI model
 */
export interface AIModelInfo {
	id: string;
	name: string;
	capabilities: AIModelCapabilities;
	maxContextLength: number;
	maxResponseTokens: number;
	pricingTier: PricingTier;
}

/**
 * Provider information
 */
export interface AIProviderInfo {
	id: string;
	name: string;
	type: AIProviderType;
	availableModels: AIModelInfo[];
	iconPath: string;
	isEnabled: boolean;
	authStatus: AIProviderAuthStatus;
}

/**
 * Provider configuration for initialization
 */
export interface AIProviderConfig {
	type: AIProviderType;
	apiKey: string;
	baseUrl?: string;
	organizationId?: string;
	defaultModel?: string;
	customOptions?: Record<string, any>;
}

/**
 * Image content for messages
 */
export interface AIImageContent {
	uri: URI;
	mimeType: string;
	data?: Uint8Array;
}

/**
 * Message content types
 */
export type AIMessageContent =
	| { type: 'text'; value: string }
	| { type: 'image'; value: AIImageContent };

/**
 * A message in a conversation
 */
export interface AIMessage {
	role: AIMessageRole;
	content: AIMessageContent[];
	name?: string;
}

/**
 * Tool parameter schema
 */
export interface AIToolParameterSchema {
	type: string;
	description?: string;
	enum?: string[];
	required?: boolean;
	properties?: Record<string, AIToolParameterSchema>;
	items?: AIToolParameterSchema;
}

/**
 * Tool definition
 */
export interface AITool {
	name: string;
	description: string;
	parameters: Record<string, AIToolParameterSchema>;
}

/**
 * Options for AI requests
 */
export interface AIRequestOptions {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	tools?: AITool[];
	responseFormat?: 'text' | 'json';
	stopSequences?: string[];
	customOptions?: Record<string, any>;
}

/**
 * Types of response parts
 */
export type AIResponsePart =
	| { type: 'text'; value: string }
	| { type: 'tool_call'; name: string; toolCallId: string; parameters: Record<string, any> };

/**
 * Fragment of a streaming response
 */
export interface AIResponseFragment {
	index: number;
	part: AIResponsePart;
}

/**
 * Complete response from an AI request
 */
export interface AIResponse {
	stream: AsyncIterable<AIResponseFragment>;
	result: Promise<void>;
}

/**
 * Provider selector criteria
 */
export interface AIProviderSelector {
	type?: AIProviderType;
	id?: string;
	requiredCapabilities?: Partial<AIModelCapabilities>;
	filter?: (provider: IAIProvider) => boolean;
}

/**
 * Interface for an AI provider
 */
export interface IAIProvider extends IDisposable {
	/**
	 * Provider information
	 */
	readonly info: AIProviderInfo;

	/**
	 * Event that fires when provider status changes
	 */
	readonly onDidChangeStatus: Event<void>;

	/**
	 * Initialize the provider with configuration
	 * @param config Provider configuration
	 */
	initialize(config: AIProviderConfig): Promise<void>;

	/**
	 * Send a request to the AI provider
	 * @param messages Messages to send
	 * @param options Request options
	 * @param token Cancellation token
	 */
	sendRequest(messages: AIMessage[], options?: AIRequestOptions, token?: CancellationToken): Promise<AIResponse>;

	/**
	 * Count tokens in a message or text
	 * @param value Message or text to count tokens in
	 * @param token Cancellation token
	 */
	countTokens(value: string | AIMessage[], token?: CancellationToken): Promise<number>;
}

/**
 * Interface for the AI provider service
 */
export interface IAIProviderService {
	/**
	 * Event that fires when providers change
	 */
	readonly onDidChangeProviders: Event<void>;

	/**
	 * All registered providers
	 */
	readonly providers: ReadonlyMap<string, IAIProvider>;

	/**
	 * Register a new AI provider
	 * @param provider The provider to register
	 */
	registerProvider(provider: IAIProvider): IDisposable;

	/**
	 * Get a provider by ID
	 * @param id The provider ID
	 */
	getProvider(id: string): IAIProvider | undefined;

	/**
	 * Get all active providers
	 */
	getActiveProviders(): IAIProvider[];

	/**
	 * Select providers based on criteria
	 * @param selector Selection criteria
	 */
	selectProviders(selector: AIProviderSelector): Promise<IAIProvider[]>;
}
