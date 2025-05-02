/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider } from './providerInterface';
import { AITask, TaskRequirements } from './providerTypes';

/**
 * Interface for the Provider Manager which handles provider registration and selection.
 */
export interface IProviderManager {
	// Provider management
	registerProvider(provider: AIProvider): void;
	unregisterProvider(providerId: string): void;
	getProvider(providerId: string): AIProvider | undefined;
	getAllProviders(): AIProvider[];
	
	// Provider selection
	getDefaultProvider(): AIProvider;
	getBestProviderForTask(task: AITask, requirements?: TaskRequirements): AIProvider;
	
	// Operations
	executeWithProvider<T>(providerId: string, operation: (provider: AIProvider) => Promise<T>): Promise<T>;
	executeWithFallback<T>(operation: (provider: AIProvider) => Promise<T>, requirements?: TaskRequirements): Promise<T>;
}

/**
 * Implementation of the Provider Manager interface.
 */
export class ProviderManager implements IProviderManager {
	private providers: Map<string, AIProvider> = new Map();
	private defaultProviderId: string | undefined;

	constructor() {
		// Initialize with empty provider list
	}

	/**
	 * Register a new AI provider with the manager.
	 * @param provider The provider to register
	 */
	registerProvider(provider: AIProvider): void {
		if (this.providers.has(provider.id)) {
			throw new Error(`Provider with ID '${provider.id}' is already registered`);
		}
		
		this.providers.set(provider.id, provider);
		
		// If this is the first provider or no default is set, make it the default
		if (!this.defaultProviderId || this.providers.size === 1) {
			this.defaultProviderId = provider.id;
		}
	}

	/**
	 * Unregister a provider by its ID.
	 * @param providerId The ID of the provider to unregister
	 */
	unregisterProvider(providerId: string): void {
		if (!this.providers.has(providerId)) {
			return; // Provider doesn't exist, nothing to do
		}
		
		this.providers.delete(providerId);
		
		// If we removed the default provider, set a new default if any providers remain
		if (this.defaultProviderId === providerId && this.providers.size > 0) {
			this.defaultProviderId = this.providers.keys().next().value;
		} else if (this.providers.size === 0) {
			this.defaultProviderId = undefined;
		}
	}

	/**
	 * Get a provider by its ID.
	 * @param providerId The ID of the provider to retrieve
	 * @returns The provider or undefined if not found
	 */
	getProvider(providerId: string): AIProvider | undefined {
		return this.providers.get(providerId);
	}

	/**
	 * Get all registered providers.
	 * @returns Array of all providers
	 */
	getAllProviders(): AIProvider[] {
		return Array.from(this.providers.values());
	}

	/**
	 * Get the default provider.
	 * @returns The default provider
	 * @throws Error if no providers are registered
	 */
	getDefaultProvider(): AIProvider {
		if (!this.defaultProviderId || !this.providers.has(this.defaultProviderId)) {
			throw new Error('No default provider available');
		}
		
		return this.providers.get(this.defaultProviderId)!;
	}

	/**
	 * Set the default provider.
	 * @param providerId The ID of the provider to set as default
	 * @throws Error if the provider is not registered
	 */
	setDefaultProvider(providerId: string): void {
		if (!this.providers.has(providerId)) {
			throw new Error(`Cannot set default provider: Provider with ID '${providerId}' is not registered`);
		}
		
		this.defaultProviderId = providerId;
	}

	/**
	 * Find the best provider for a given task based on requirements.
	 * @param task The AI task to perform
	 * @param requirements Optional requirements for the provider
	 * @returns The best matching provider
	 * @throws Error if no suitable provider is found
	 */
	getBestProviderForTask(task: AITask, requirements?: TaskRequirements): AIProvider {
		if (this.providers.size === 0) {
			throw new Error('No providers registered');
		}
		
		// Filter providers by basic capability for the task
		const capableProviders = this.getAllProviders().filter(provider => {
			switch (task) {
				case 'completion': return provider.capabilities.supportsCompletion;
				case 'chat': return provider.capabilities.supportsChat;
				case 'embedding': return provider.capabilities.supportsEmbeddings;
				case 'codeAnalysis': return !!provider.analyzeCode && provider.capabilities.supportsCodeAnalysis;
				case 'imageGeneration': return !!provider.generateImage && provider.capabilities.supportsImageGeneration;
				case 'imageAnalysis': return !!provider.analyzeImage && provider.capabilities.supportsImageAnalysis;
				default: return false;
			}
		});
		
		if (capableProviders.length === 0) {
			throw new Error(`No providers support the requested task: ${task}`);
		}
		
		if (!requirements) {
			// If no specific requirements, return the first capable provider
			return capableProviders[0];
		}
		
		// Filter by additional requirements
		let matchingProviders = capableProviders;
		
		// Filter by context window if specified
		if (requirements.minContextWindow) {
			matchingProviders = matchingProviders.filter(
				provider => provider.capabilities.contextWindowSize >= requirements.minContextWindow!
			);
		}
		
		// Filter by required capabilities if specified
		if (requirements.requiredCapabilities && requirements.requiredCapabilities.length > 0) {
			matchingProviders = matchingProviders.filter(provider => {
				return requirements.requiredCapabilities!.every(capability => {
					switch (capability) {
						case 'codeAnalysis': return !!provider.analyzeCode;
						case 'imageGeneration': return !!provider.generateImage;
						case 'imageAnalysis': return !!provider.analyzeImage;
						default: return true;
					}
				});
			});
		}
		
		if (matchingProviders.length === 0) {
			throw new Error(`No providers meet all the requirements for task: ${task}`);
		}
		
		// If specific model is preferred, try to find a provider with that model
		if (requirements.preferredModel) {
			const modelProviders = matchingProviders.filter(
				provider => provider.capabilities.supportedModels.includes(requirements.preferredModel!)
			);
			
			if (modelProviders.length > 0) {
				matchingProviders = modelProviders;
			}
		}
		
		// TODO: Add more sophisticated provider selection based on cost, latency, etc.
		// For now, just return the first matching provider
		return matchingProviders[0];
	}

	/**
	 * Execute an operation with a specific provider.
	 * @param providerId The ID of the provider to use
	 * @param operation The operation to execute
	 * @returns The result of the operation
	 * @throws Error if the provider is not found
	 */
	async executeWithProvider<T>(providerId: string, operation: (provider: AIProvider) => Promise<T>): Promise<T> {
		const provider = this.getProvider(providerId);
		if (!provider) {
			throw new Error(`Provider with ID '${providerId}' not found`);
		}
		
		return operation(provider);
	}

	/**
	 * Execute an operation with automatic fallback to other providers if the primary fails.
	 * @param operation The operation to execute
	 * @param requirements Optional requirements for selecting providers
	 * @returns The result of the operation
	 * @throws Error if all providers fail
	 */
	async executeWithFallback<T>(
		operation: (provider: AIProvider) => Promise<T>,
		requirements?: TaskRequirements
	): Promise<T> {
		// Get all providers, sorted by priority
		// For now, we just use the ordering of the providers in the map
		const providers = this.getAllProviders();
		
		if (providers.length === 0) {
			throw new Error('No providers registered to execute operation');
		}
		
		// Try each provider in order until one succeeds
		const errors: Error[] = [];
		
		for (const provider of providers) {
			try {
				return await operation(provider);
			} catch (error) {
				// Log the error and try the next provider
				errors.push(error as Error);
				console.error(`Provider ${provider.id} failed:`, error);
			}
		}
		
		// If we get here, all providers failed
		throw new Error(`All providers failed to execute operation: ${errors.map(e => e.message).join(', ')}`);
	}
}