/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider } from './providerInterface';
import { IProviderManager, ProviderManager } from './providerManager';
import { IProviderRegistry, ProviderRegistry } from './providerRegistry';
import { IConfigurationManager, ConfigurationManager } from './configurationManager';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ISecretStorageService } from 'vs/platform/secrets/common/secrets';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IDisposable, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import {
	AITask,
	TaskRequirements,
	ChatMessage,
	ChatOptions,
	ChatResult,
	CompletionOptions,
	CompletionResult,
	EmbeddingOptions,
	EmbeddingResult,
	CodeAnalysisOptions,
	CodeAnalysisResult,
	ImageGenerationOptions,
	ImageGenerationResult,
	ImageAnalysisOptions,
	ImageAnalysisResult
} from './providerTypes';

/**
 * Interface for the AI Provider Service, which coordinates the multi-provider framework.
 */
export interface IAIProviderService {
	// Provider registry operations
	registerProvider(providerClass: any): IDisposable;
	unregisterProvider(providerId: string): void;
	getProvider(providerId: string): AIProvider | undefined;
	getAllProviders(): AIProvider[];
	
	// Provider selection
	getDefaultProvider(): AIProvider;
	setDefaultProvider(providerId: string): Promise<void>;
	getBestProviderForTask(task: AITask, requirements?: TaskRequirements): AIProvider;
	
	// Convenience methods for key AI operations
	generateCompletion(prompt: string, options?: CompletionOptions & { providerId?: string }): Promise<CompletionResult>;
	generateChat(messages: ChatMessage[], options?: ChatOptions & { providerId?: string }): Promise<ChatResult>;
	embedText(text: string, options?: EmbeddingOptions & { providerId?: string }): Promise<EmbeddingResult>;
	analyzeCode(code: string, options?: CodeAnalysisOptions & { providerId?: string }): Promise<CodeAnalysisResult>;
	generateImage(prompt: string, options?: ImageGenerationOptions & { providerId?: string }): Promise<ImageGenerationResult>;
	analyzeImage(imageData: Buffer, options?: ImageAnalysisOptions & { providerId?: string }): Promise<ImageAnalysisResult>;
	
	// Events
	readonly onProviderRegistered: Event<AIProvider>;
	readonly onProviderUnregistered: Event<string>;
	readonly onDefaultProviderChanged: Event<string>;
}

/**
 * Implementation of the AI Provider Service.
 */
export class AIProviderService implements IAIProviderService {
	private readonly disposables = new DisposableStore();
	
	// Events
	private readonly _onDefaultProviderChanged = new Emitter<string>();
	readonly onDefaultProviderChanged: Event<string> = this._onDefaultProviderChanged.event;
	
	// Forward events from the registry
	readonly onProviderRegistered: Event<AIProvider>;
	readonly onProviderUnregistered: Event<string>;
	
	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService
	) {
		// Create our core components
		const configManager = instantiationService.createInstance(ConfigurationManager);
		const providerRegistry = instantiationService.createInstance(ProviderRegistry);
		const providerManager = instantiationService.createInstance(ProviderManager);
		
		// Store the instances for later use
		this.configManager = configManager;
		this.providerRegistry = providerRegistry;
		this.providerManager = providerManager;
		
		// Forward events from the registry
		this.onProviderRegistered = providerRegistry.onProviderRegistered;
		this.onProviderUnregistered = providerRegistry.onProviderUnregistered;
		
		// When a provider is registered or unregistered, update the provider manager
		this.disposables.add(
			providerRegistry.onProviderRegistered(provider => {
				providerManager.registerProvider(provider);
			})
		);
		
		this.disposables.add(
			providerRegistry.onProviderUnregistered(providerId => {
				providerManager.unregisterProvider(providerId);
			})
		);
		
		// Initialize with default providers
		this.initializeDefaultProviders();
	}
	
	private readonly configManager: IConfigurationManager;
	private readonly providerRegistry: IProviderRegistry;
	private readonly providerManager: IProviderManager;
	
	/**
	 * Initialize the service with default providers.
	 */
	private async initializeDefaultProviders(): Promise<void> {
		// Load the provider preferences
		const preferences = await this.configManager.getProviderPreferences();
		
		// Set the default provider if specified in preferences
		if (preferences.defaultProvider) {
			try {
				this.providerManager.setDefaultProvider(preferences.defaultProvider);
			} catch (error) {
				// If the preferred default provider is not available, we'll fall back
				// to whatever default the provider manager selects
				this.logService.warn(`Could not set preferred default provider: ${(error as Error).message}`);
			}
		}
	}
	
	/**
	 * Register a provider class with the service.
	 * @param providerClass The provider class to register
	 * @returns A disposable to unregister the provider
	 */
	registerProvider(providerClass: any): IDisposable {
		return this.providerRegistry.registerProvider(providerClass);
	}
	
	/**
	 * Unregister a provider by its ID.
	 * @param providerId The ID of the provider to unregister
	 */
	unregisterProvider(providerId: string): void {
		this.providerRegistry.unregisterProvider(providerId);
	}
	
	/**
	 * Get a provider by its ID.
	 * @param providerId The ID of the provider to retrieve
	 * @returns The provider or undefined if not found
	 */
	getProvider(providerId: string): AIProvider | undefined {
		return this.providerRegistry.getProvider(providerId);
	}
	
	/**
	 * Get all registered providers.
	 * @returns Array of all providers
	 */
	getAllProviders(): AIProvider[] {
		return this.providerRegistry.getAllProviders();
	}
	
	/**
	 * Get the default provider.
	 * @returns The default provider
	 */
	getDefaultProvider(): AIProvider {
		return this.providerManager.getDefaultProvider();
	}
	
	/**
	 * Set the default provider and update preferences.
	 * @param providerId The ID of the provider to set as default
	 */
	async setDefaultProvider(providerId: string): Promise<void> {
		// First check if the provider exists
		const provider = this.getProvider(providerId);
		if (!provider) {
			throw new Error(`Cannot set default provider: Provider with ID '${providerId}' is not registered`);
		}
		
		// Update the provider manager
		this.providerManager.setDefaultProvider(providerId);
		
		// Update the preferences
		await this.configManager.setProviderPreferences({
			defaultProvider: providerId
		});
		
		// Emit event
		this._onDefaultProviderChanged.fire(providerId);
	}
	
	/**
	 * Get the best provider for a given task based on requirements.
	 * @param task The AI task to perform
	 * @param requirements Optional requirements for the provider
	 * @returns The best matching provider
	 */
	getBestProviderForTask(task: AITask, requirements?: TaskRequirements): AIProvider {
		return this.providerManager.getBestProviderForTask(task, requirements);
	}
	
	/**
	 * Generate a text completion.
	 * @param prompt The prompt to generate a completion for
	 * @param options Completion options
	 * @returns Promise resolving to the completion result
	 */
	async generateCompletion(prompt: string, options?: CompletionOptions & { providerId?: string }): Promise<CompletionResult> {
		const providerId = options?.providerId;
		
		if (providerId) {
			// Use the specified provider
			return this.providerManager.executeWithProvider(providerId, provider => 
				provider.generateCompletion(prompt, options)
			);
		} else {
			// Find the best provider for the task
			return this.providerManager.executeWithFallback(provider => 
				provider.generateCompletion(prompt, options)
			);
		}
	}
	
	/**
	 * Generate a chat completion.
	 * @param messages The chat messages to generate a completion for
	 * @param options Chat options
	 * @returns Promise resolving to the chat result
	 */
	async generateChat(messages: ChatMessage[], options?: ChatOptions & { providerId?: string }): Promise<ChatResult> {
		const providerId = options?.providerId;
		
		if (providerId) {
			// Use the specified provider
			return this.providerManager.executeWithProvider(providerId, provider => 
				provider.generateChat(messages, options)
			);
		} else {
			// Find the best provider for the task
			return this.providerManager.executeWithFallback(provider => 
				provider.generateChat(messages, options)
			);
		}
	}
	
	/**
	 * Generate embeddings for text.
	 * @param text The text to generate embeddings for
	 * @param options Embedding options
	 * @returns Promise resolving to the embedding result
	 */
	async embedText(text: string, options?: EmbeddingOptions & { providerId?: string }): Promise<EmbeddingResult> {
		const providerId = options?.providerId;
		
		if (providerId) {
			// Use the specified provider
			return this.providerManager.executeWithProvider(providerId, provider => 
				provider.embedText(text, options)
			);
		} else {
			// Find the best provider for the task
			return this.providerManager.executeWithFallback(provider => 
				provider.embedText(text, options)
			);
		}
	}
	
	/**
	 * Analyze code for issues and suggestions.
	 * @param code The code to analyze
	 * @param options Code analysis options
	 * @returns Promise resolving to the analysis result
	 */
	async analyzeCode(code: string, options?: CodeAnalysisOptions & { providerId?: string }): Promise<CodeAnalysisResult> {
		const providerId = options?.providerId;
		const requirements: TaskRequirements = {
			requiredCapabilities: ['codeAnalysis']
		};
		
		if (providerId) {
			// Use the specified provider
			return this.providerManager.executeWithProvider(providerId, provider => {
				if (!provider.analyzeCode) {
					throw new Error(`Provider ${provider.id} does not support code analysis`);
				}
				return provider.analyzeCode(code, options);
			});
		} else {
			// Find the best provider for the task
			const provider = this.getBestProviderForTask('codeAnalysis', requirements);
			
			if (!provider.analyzeCode) {
				throw new Error('No provider with code analysis capability found');
			}
			
			return provider.analyzeCode(code, options);
		}
	}
	
	/**
	 * Generate an image from a text prompt.
	 * @param prompt The prompt to generate an image for
	 * @param options Image generation options
	 * @returns Promise resolving to the image generation result
	 */
	async generateImage(prompt: string, options?: ImageGenerationOptions & { providerId?: string }): Promise<ImageGenerationResult> {
		const providerId = options?.providerId;
		const requirements: TaskRequirements = {
			requiredCapabilities: ['imageGeneration']
		};
		
		if (providerId) {
			// Use the specified provider
			return this.providerManager.executeWithProvider(providerId, provider => {
				if (!provider.generateImage) {
					throw new Error(`Provider ${provider.id} does not support image generation`);
				}
				return provider.generateImage(prompt, options);
			});
		} else {
			// Find the best provider for the task
			const provider = this.getBestProviderForTask('imageGeneration', requirements);
			
			if (!provider.generateImage) {
				throw new Error('No provider with image generation capability found');
			}
			
			return provider.generateImage(prompt, options);
		}
	}
	
	/**
	 * Analyze an image.
	 * @param imageData The image data to analyze
	 * @param options Image analysis options
	 * @returns Promise resolving to the image analysis result
	 */
	async analyzeImage(imageData: Buffer, options?: ImageAnalysisOptions & { providerId?: string }): Promise<ImageAnalysisResult> {
		const providerId = options?.providerId;
		const requirements: TaskRequirements = {
			requiredCapabilities: ['imageAnalysis']
		};
		
		if (providerId) {
			// Use the specified provider
			return this.providerManager.executeWithProvider(providerId, provider => {
				if (!provider.analyzeImage) {
					throw new Error(`Provider ${provider.id} does not support image analysis`);
				}
				return provider.analyzeImage(imageData, options);
			});
		} else {
			// Find the best provider for the task
			const provider = this.getBestProviderForTask('imageAnalysis', requirements);
			
			if (!provider.analyzeImage) {
				throw new Error('No provider with image analysis capability found');
			}
			
			return provider.analyzeImage(imageData, options);
		}
	}
	
	/**
	 * Dispose of the service.
	 */
	dispose(): void {
		this.disposables.dispose();
	}
}

// Register the service as a singleton
registerSingleton(IAIProviderService, AIProviderService, true);