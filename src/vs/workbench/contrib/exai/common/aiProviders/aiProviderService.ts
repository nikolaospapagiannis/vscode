/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IAIProvider, IAIProviderService, AIProviderSelector } from './types';

/**
 * Service implementation for managing AI providers
 */
export class AIProviderService extends Disposable implements IAIProviderService {
	private static readonly _instance: AIProviderService = new AIProviderService();

	// Service events
	private readonly _onDidChangeProviders = this._register(new Emitter<void>());
	readonly onDidChangeProviders = this._onDidChangeProviders.event;

	// Storage for registered providers
	private readonly _providers = new Map<string, IAIProvider>();

	// Disposables for provider registrations
	private readonly _providerDisposables = new DisposableStore();

	constructor() {
		super();
		this._register(this._providerDisposables);
	}

	/**
	 * Get the singleton instance of the provider service
	 */
	static get instance(): AIProviderService {
		return this._instance;
	}

	/**
	 * Get all registered providers
	 */
	get providers(): ReadonlyMap<string, IAIProvider> {
		return this._providers;
	}

	/**
	 * Register a new AI provider
	 * @param provider The provider to register
	 * @returns A disposable to unregister the provider
	 */
	registerProvider(provider: IAIProvider): IDisposable {
		// Check for duplicate IDs
		if (this._providers.has(provider.info.id)) {
			throw new Error(`AI provider with ID "${provider.info.id}" is already registered.`);
		}

		// Store the provider
		this._providers.set(provider.info.id, provider);

		// Monitor provider status changes
		const statusListener = provider.onDidChangeStatus(() => {
			this._onDidChangeProviders.fire();
		});

		// Fire change event
		this._onDidChangeProviders.fire();

		// Return a disposable to unregister the provider
		return toDisposable(() => {
			this._providers.delete(provider.info.id);
			statusListener.dispose();
			this._onDidChangeProviders.fire();
		});
	}

	/**
	 * Get a provider by ID
	 * @param id The provider ID
	 */
	getProvider(id: string): IAIProvider | undefined {
		return this._providers.get(id);
	}

	/**
	 * Get all active providers (enabled and authenticated)
	 */
	getActiveProviders(): IAIProvider[] {
		return Array.from(this._providers.values())
			.filter(provider => provider.info.isEnabled && provider.info.authStatus === 'authenticated');
	}

	/**
	 * Select providers based on criteria
	 * @param selector Selection criteria
	 */
	async selectProviders(selector: AIProviderSelector): Promise<IAIProvider[]> {
		// Start with all active providers
		let providers = this.getActiveProviders();

		// Filter by type
		if (selector.type) {
			providers = providers.filter(p => p.info.type === selector.type);
		}

		// Filter by ID
		if (selector.id) {
			providers = providers.filter(p => p.info.id === selector.id);
		}

		// Filter by required capabilities
		if (selector.requiredCapabilities) {
			providers = providers.filter(p => {
				// Check if any of the provider's models meets the capability requirements
				return p.info.availableModels.some(model => {
					if (selector.requiredCapabilities!.supportsImages !== undefined &&
						model.capabilities.supportsImages !== selector.requiredCapabilities!.supportsImages) {
						return false;
					}
					if (selector.requiredCapabilities!.supportsToolCalling !== undefined &&
						model.capabilities.supportsToolCalling !== selector.requiredCapabilities!.supportsToolCalling) {
						return false;
					}
					if (selector.requiredCapabilities!.supportsStreaming !== undefined &&
						model.capabilities.supportsStreaming !== selector.requiredCapabilities!.supportsStreaming) {
						return false;
					}
					return true;
				});
			});
		}

		// Apply custom filter if provided
		if (selector.filter) {
			providers = providers.filter(selector.filter);
		}

		return providers;
	}
}

/**
 * Default implementation of the AI provider service
 */
export const AIProviderServiceImpl = AIProviderService.instance;
