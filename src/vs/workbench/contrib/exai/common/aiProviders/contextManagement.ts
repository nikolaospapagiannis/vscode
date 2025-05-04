/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { AIMessage, AIProviderType, IAIProvider } from './types';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Context management strategy
 */
export enum ContextManagementStrategy {
	/**
	 * Adapt context size based on the provider's capabilities
	 */
	Adaptive = 'adaptive',

	/**
	 * Use a fixed context size for all providers
	 */
	FixedSize = 'fixedSize',

	/**
	 * Use a sliding window approach for context management
	 */
	Sliding = 'sliding'
}

/**
 * Context item with metadata
 */
export interface ContextItem {
	/**
	 * Message content
	 */
	message: AIMessage;

	/**
	 * Timestamp when the item was added
	 */
	timestamp: number;

	/**
	 * Estimated token count
	 */
	tokenCount: number;

	/**
	 * Provider that generated this message (if any)
	 */
	providerId?: string;

	/**
	 * Tags for message filtering
	 */
	tags?: string[];
}

/**
 * Context window configuration
 */
export interface ContextConfig {
	/**
	 * Maximum context size in tokens
	 */
	maxContextSize: number;

	/**
	 * Context management strategy
	 */
	strategy: ContextManagementStrategy;

	/**
	 * Whether to include system messages in token count
	 */
	countSystemMessages: boolean;

	/**
	 * Whether to enable token optimization
	 */
	enableOptimization: boolean;
}

/**
 * Provider-specific context settings
 */
export interface ProviderContextSettings {
	/**
	 * Provider ID
	 */
	providerId: string;

	/**
	 * Maximum context window size
	 */
	maxContextSize: number;

	/**
	 * Maximum output tokens
	 */
	maxOutputTokens: number;
}

/**
 * Context state export format
 */
export interface ContextExport {
	/**
	 * Context items
	 */
	items: ContextItem[];

	/**
	 * Context configuration
	 */
	config: ContextConfig;

	/**
	 * Provider settings
	 */
	providerSettings: ProviderContextSettings[];

	/**
	 * Export version
	 */
	version: string;
}

/**
 * Interface for the context management service
 */
export interface IContextManagementService {
	/**
	 * Event that fires when the context is updated
	 */
	readonly onDidUpdateContext: Event<void>;

	/**
	 * Add a message to the context
	 * @param message Message to add
	 * @param providerId Provider that generated the message
	 * @param tags Tags for message filtering
	 */
	addMessage(message: AIMessage, providerId?: string, tags?: string[]): void;

	/**
	 * Add multiple messages to the context
	 * @param messages Messages to add
	 * @param providerId Provider that generated the messages
	 * @param tags Tags for message filtering
	 */
	addMessages(messages: AIMessage[], providerId?: string, tags?: string[]): void;

	/**
	 * Clear all messages from the context
	 */
	clearContext(): void;

	/**
	 * Get messages for a specific provider
	 * @param provider Provider to get messages for
	 */
	getMessagesForProvider(provider: IAIProvider): AIMessage[];

	/**
	 * Register provider settings
	 * @param provider Provider to register settings for
	 */
	registerProviderSettings(provider: IAIProvider): void;

	/**
	 * Update provider settings
	 * @param providerId Provider ID
	 * @param settings New settings
	 */
	updateProviderSettings(providerId: string, settings: Partial<ProviderContextSettings>): void;

	/**
	 * Export the current context state
	 */
	exportContext(): ContextExport;

	/**
	 * Import a context state
	 * @param context Context to import
	 */
	importContext(context: ContextExport): void;

	/**
	 * Get the estimated token count for all messages
	 */
	getTokenCount(): number;
}

/**
 * Implementation of the context management service
 */
export class ContextManagementService extends Disposable implements IContextManagementService {
	private readonly _onDidUpdateContext = this._register(new Emitter<void>());
	readonly onDidUpdateContext = this._onDidUpdateContext.event;

	private _items: ContextItem[] = [];
	private _providerSettings = new Map<string, ProviderContextSettings>();
	private _config: ContextConfig;

	constructor(
		@IConfigurationService private readonly configService: IConfigurationService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Initialize context configuration
		this._config = this._loadConfig();

		// Listen for configuration changes
		this._register(this.configService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('exai.multiProvider.contextManagement')) {
				this._config = this._loadConfig();
				this._onDidUpdateContext.fire();
			}
		}));
	}

	/**
	 * Load context configuration from settings
	 */
	private _loadConfig(): ContextConfig {
		const config = this.configService.getValue<any>('exai.multiProvider.contextManagement');

		return {
			maxContextSize: config?.maxContextSize ?? 100000,
			strategy: config?.strategy ?? ContextManagementStrategy.Adaptive,
			countSystemMessages: config?.countSystemMessages ?? true,
			enableOptimization: config?.enableOptimization ?? true
		};
	}

	/**
	 * Add a message to the context
	 * @param message Message to add
	 * @param providerId Provider that generated the message
	 * @param tags Tags for message filtering
	 */
	addMessage(message: AIMessage, providerId?: string, tags?: string[]): void {
		// Create context item
		const item: ContextItem = {
			message,
			timestamp: Date.now(),
			tokenCount: this._estimateTokenCount(message),
			providerId,
			tags
		};

		// Add to items
		this._items.push(item);

		// Apply context management strategy
		this._applyContextStrategy();

		// Notify of update
		this._onDidUpdateContext.fire();
	}

	/**
	 * Add multiple messages to the context
	 * @param messages Messages to add
	 * @param providerId Provider that generated the messages
	 * @param tags Tags for message filtering
	 */
	addMessages(messages: AIMessage[], providerId?: string, tags?: string[]): void {
		// Add each message
		for (const message of messages) {
			this.addMessage(message, providerId, tags);
		}
	}

	/**
	 * Clear all messages from the context
	 */
	clearContext(): void {
		this._items = [];
		this._onDidUpdateContext.fire();
	}

	/**
	 * Get messages for a specific provider
	 * @param provider Provider to get messages for
	 */
	getMessagesForProvider(provider: IAIProvider): AIMessage[] {
		// Get provider settings
		const settings = this._getProviderSettings(provider.info.id);
		if (!settings) {
			// If no settings are registered, register them now
			this.registerProviderSettings(provider);
		}

		// Apply context optimization based on strategy
		const optimizedItems = this._optimizeContextForProvider(provider.info.id);

		// Extract messages from items
		return optimizedItems.map(item => item.message);
	}

	/**
	 * Register provider settings
	 * @param provider Provider to register settings for
	 */
	registerProviderSettings(provider: IAIProvider): void {
		// Get maximum context size from provider models
		let maxContextSize = 0;
		let maxOutputTokens = 0;

		// Find the model with the largest context window
		for (const model of provider.info.availableModels) {
			if (model.maxContextLength > maxContextSize) {
				maxContextSize = model.maxContextLength;
			}
			if (model.maxResponseTokens > maxOutputTokens) {
				maxOutputTokens = model.maxResponseTokens;
			}
		}

		// If no models found, use defaults
		if (maxContextSize === 0) {
			maxContextSize = 16000; // Default
		}
		if (maxOutputTokens === 0) {
			maxOutputTokens = 4000; // Default
		}

		// Register settings
		this._providerSettings.set(provider.info.id, {
			providerId: provider.info.id,
			maxContextSize,
			maxOutputTokens
		});

		this.logService.info(`Registered context settings for provider ${provider.info.id}: ${maxContextSize} tokens`);
	}

	/**
	 * Update provider settings
	 * @param providerId Provider ID
	 * @param settings New settings
	 */
	updateProviderSettings(providerId: string, settings: Partial<ProviderContextSettings>): void {
		// Get existing settings
		const existingSettings = this._getProviderSettings(providerId);
		if (!existingSettings) {
			this.logService.warn(`Cannot update settings for unknown provider: ${providerId}`);
			return;
		}

		// Update settings
		const newSettings: ProviderContextSettings = {
			...existingSettings,
			...settings,
			providerId // Ensure provider ID remains the same
		};

		// Store updated settings
		this._providerSettings.set(providerId, newSettings);
		this._onDidUpdateContext.fire();
	}

	/**
	 * Export the current context state
	 */
	exportContext(): ContextExport {
		return {
			items: [...this._items],
			config: { ...this._config },
			providerSettings: Array.from(this._providerSettings.values()),
			version: '1.0'
		};
	}

	/**
	 * Import a context state
	 * @param context Context to import
	 */
	importContext(context: ContextExport): void {
		// Validate version
		if (!context.version || context.version !== '1.0') {
			this.logService.warn(`Unsupported context version: ${context.version}`);
			return;
		}

		// Import items
		this._items = [...context.items];

		// Import config if available
		if (context.config) {
			this._config = { ...context.config };
		}

		// Import provider settings
		this._providerSettings.clear();
		for (const settings of context.providerSettings) {
			this._providerSettings.set(settings.providerId, { ...settings });
		}

		// Notify of update
		this._onDidUpdateContext.fire();
	}

	/**
	 * Get the estimated token count for all messages
	 */
	getTokenCount(): number {
		return this._items.reduce((sum, item) => sum + item.tokenCount, 0);
	}

	/**
	 * Get provider settings
	 * @param providerId Provider ID
	 */
	private _getProviderSettings(providerId: string): ProviderContextSettings | undefined {
		return this._providerSettings.get(providerId);
	}

	/**
	 * Apply the context management strategy
	 */
	private _applyContextStrategy(): void {
		switch (this._config.strategy) {
			case ContextManagementStrategy.FixedSize:
				this._applyFixedSizeStrategy();
				break;

			case ContextManagementStrategy.Sliding:
				this._applySlidingWindowStrategy();
				break;

			case ContextManagementStrategy.Adaptive:
			default:
				// Do nothing - this is applied per provider
				break;
		}
	}

	/**
	 * Apply fixed size strategy
	 */
	private _applyFixedSizeStrategy(): void {
		// Check if we need to trim
		const totalTokens = this.getTokenCount();
		if (totalTokens <= this._config.maxContextSize) {
			return; // No trimming needed
		}

		// We need to trim items from the beginning until we're under the limit
		let tokensToRemove = totalTokens - this._config.maxContextSize;
		while (tokensToRemove > 0 && this._items.length > 0) {
			// Keep system messages if configured
			if (!this._config.countSystemMessages && this._items[0].message.role === 'system') {
				// Skip system messages
				const item = this._items.shift();
				if (item) {
					this._items.push(item); // Move to the end
				}
				continue;
			}

			// Remove the oldest item
			const item = this._items.shift();
			if (item) {
				tokensToRemove -= item.tokenCount;
			} else {
				break;
			}
		}
	}

	/**
	 * Apply sliding window strategy
	 */
	private _applySlidingWindowStrategy(): void {
		// Keep only the most recent messages that fit within the context size
		const totalTokens = this.getTokenCount();
		if (totalTokens <= this._config.maxContextSize) {
			return; // No trimming needed
		}

		// Preserve system messages if configured
		const systemMessages: ContextItem[] = [];
		if (!this._config.countSystemMessages) {
			// Extract system messages
			const nonSystemMessages: ContextItem[] = [];
			for (const item of this._items) {
				if (item.message.role === 'system') {
					systemMessages.push(item);
				} else {
					nonSystemMessages.push(item);
				}
			}
			this._items = nonSystemMessages;
		}

		// Calculate how many tokens we can keep
		let availableTokens = this._config.maxContextSize;
		if (!this._config.countSystemMessages) {
			// Subtract system message tokens
			const systemTokens = systemMessages.reduce((sum, item) => sum + item.tokenCount, 0);
			availableTokens -= systemTokens;
		}

		// Keep the most recent messages that fit within the available tokens
		const keptItems: ContextItem[] = [];
		let totalKeptTokens = 0;

		// Process items from newest to oldest
		for (let i = this._items.length - 1; i >= 0; i--) {
			const item = this._items[i];
			if (totalKeptTokens + item.tokenCount <= availableTokens) {
				keptItems.unshift(item); // Add to the beginning
				totalKeptTokens += item.tokenCount;
			} else {
				// Can't fit any more items
				break;
			}
		}

		// Restore system messages if needed
		if (!this._config.countSystemMessages) {
			this._items = [...systemMessages, ...keptItems];
		} else {
			this._items = keptItems;
		}
	}

	/**
	 * Optimize context for a specific provider
	 * @param providerId Provider ID
	 */
	private _optimizeContextForProvider(providerId: string): ContextItem[] {
		// Get provider settings
		const settings = this._getProviderSettings(providerId);
		if (!settings) {
			// Use default context
			return [...this._items];
		}

		// If optimization is disabled, return all items
		if (!this._config.enableOptimization) {
			return [...this._items];
		}

		// Determine effective context size based on strategy
		let effectiveContextSize: number;
		switch (this._config.strategy) {
			case ContextManagementStrategy.FixedSize:
				// Use fixed size from config
				effectiveContextSize = this._config.maxContextSize;
				break;

			case ContextManagementStrategy.Adaptive:
				// Use provider's context size
				effectiveContextSize = settings.maxContextSize;
				break;

			case ContextManagementStrategy.Sliding:
				// Use minimum of provider and config size
				effectiveContextSize = Math.min(settings.maxContextSize, this._config.maxContextSize);
				break;

			default:
				effectiveContextSize = settings.maxContextSize;
		}

		// Reserve space for response tokens
		const reservedTokens = Math.min(settings.maxOutputTokens, effectiveContextSize * 0.25);
		const availableTokens = effectiveContextSize - reservedTokens;

		// Extract system messages (always include them)
		const systemMessages: ContextItem[] = [];
		const nonSystemMessages: ContextItem[] = [];

		for (const item of this._items) {
			if (item.message.role === 'system') {
				systemMessages.push(item);
			} else {
				nonSystemMessages.push(item);
			}
		}

		// Calculate system message tokens
		const systemTokens = systemMessages.reduce((sum, item) => sum + item.tokenCount, 0);
		const remainingTokens = availableTokens - systemTokens;

		// If we don't have enough tokens for system messages, we need to truncate them
		if (remainingTokens <= 0) {
			this.logService.warn(`System messages exceed available context size for provider ${providerId}`);
			// Return only the most important system messages that fit
			return this._truncateItemsToFit(systemMessages, availableTokens);
		}

		// We have room for additional messages
		// Keep the most recent messages that fit within the remaining tokens
		const keptItems = this._truncateItemsToFit(nonSystemMessages.reverse(), remainingTokens).reverse();

		// Combine system messages with kept items
		return [...systemMessages, ...keptItems];
	}

	/**
	 * Truncate items to fit within a token limit
	 * @param items Items to truncate
	 * @param maxTokens Maximum tokens
	 */
	private _truncateItemsToFit(items: ContextItem[], maxTokens: number): ContextItem[] {
		const result: ContextItem[] = [];
		let totalTokens = 0;

		for (const item of items) {
			if (totalTokens + item.tokenCount <= maxTokens) {
				result.push(item);
				totalTokens += item.tokenCount;
			} else {
				// Can't fit this item
				break;
			}
		}

		return result;
	}

	/**
	 * Estimate token count for a message
	 * @param message Message to estimate tokens for
	 */
	private _estimateTokenCount(message: AIMessage): number {
		// Start with base token count for message structure
		let tokenCount = 4; // Base tokens for message structure

		// Count tokens in text content
		for (const content of message.content) {
			if (content.type === 'text') {
				// Approximate 4 characters per token for text
				tokenCount += Math.ceil(content.value.length / 4);
			} else if (content.type === 'image') {
				// Images use a lot of tokens (rough estimate)
				tokenCount += 1000;
			}
		}

		// Add tokens for role and name
		tokenCount += 1; // Role
		if (message.name) {
			tokenCount += 1; // Name
		}

		return tokenCount;
	}
}