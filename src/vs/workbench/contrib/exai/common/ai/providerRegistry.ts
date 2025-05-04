/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider } from './providerInterface';
import { ILogService } from 'vs/platform/log/common/log';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';

/**
 * Interface for the Provider Registry which maintains a catalog of available providers.
 */
export interface IProviderRegistry {
	// Provider registration
	registerProvider(providerClass: any): IDisposable;
	registerStaticProvider(provider: AIProvider): IDisposable;
	unregisterProvider(providerId: string): void;

	// Provider discovery
	getProvider(providerId: string): AIProvider | undefined;
	getAllProviders(): AIProvider[];
	getProvidersByCapability(capability: string): AIProvider[];

	// Provider status events
	readonly onProviderRegistered: Event<AIProvider>;
	readonly onProviderUnregistered: Event<string>;
	readonly onProviderStatusChanged: Event<{ providerId: string, status: ProviderStatus }>;
}

/**
 * Provider status information.
 */
export interface ProviderStatus {
	isAvailable: boolean;
	isAuthenticated: boolean;
	error?: string;
}

/**
 * Implementation of the Provider Registry.
 */
export class ProviderRegistry implements IProviderRegistry {
	private readonly providers: Map<string, AIProvider> = new Map();
	private readonly providerStatus: Map<string, ProviderStatus> = new Map();

	// Events
	private readonly _onProviderRegistered = new Emitter<AIProvider>();
	private readonly _onProviderUnregistered = new Emitter<string>();
	private readonly _onProviderStatusChanged = new Emitter<{ providerId: string, status: ProviderStatus }>();

	readonly onProviderRegistered: Event<AIProvider> = this._onProviderRegistered.event;
	readonly onProviderUnregistered: Event<string> = this._onProviderUnregistered.event;
	readonly onProviderStatusChanged: Event<{ providerId: string, status: ProviderStatus }> = this._onProviderStatusChanged.event;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService
	) { }

	/**
	 * Register a provider class that will be instantiated by the registry.
	 * @param providerClass The provider class to register
	 * @returns A disposable to unregister the provider
	 */
	registerProvider(providerClass: any): IDisposable {
		try {
			const provider = this.instantiationService.createInstance(providerClass);
			return this.registerStaticProvider(provider);
		} catch (error) {
			this.logService.error(`Failed to instantiate provider class:`, error);
			throw new Error(`Failed to instantiate provider: ${(error as Error).message}`);
		}
	}

	/**
	 * Register an already instantiated provider.
	 * @param provider The provider instance to register
	 * @returns A disposable to unregister the provider
	 */
	registerStaticProvider(provider: AIProvider): IDisposable {
		if (this.providers.has(provider.id)) {
			throw new Error(`Provider with ID '${provider.id}' is already registered`);
		}

		this.providers.set(provider.id, provider);

		// Initialize provider status
		this.providerStatus.set(provider.id, {
			isAvailable: true,
			isAuthenticated: provider.isAuthenticated()
		});

		// Emit registration event
		this._onProviderRegistered.fire(provider);
		this.logService.info(`Provider registered: ${provider.name} (${provider.id})`);

		// Return a disposable to unregister the provider
		return {
			dispose: () => {
				this.unregisterProvider(provider.id);
			}
		};
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
		this.providerStatus.delete(providerId);

		// Emit unregistration event
		this._onProviderUnregistered.fire(providerId);
		this.logService.info(`Provider unregistered: ${providerId}`);
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
	 * Get providers that support a specific capability.
	 * @param capability The capability to filter by
	 * @returns Array of providers supporting the capability
	 */
	getProvidersByCapability(capability: string): AIProvider[] {
		return this.getAllProviders().filter(provider => {
			const capabilities = provider.capabilities;
			switch (capability) {
				case 'completion': return capabilities.supportsCompletion;
				case 'chat': return capabilities.supportsChat;
				case 'embedding': return capabilities.supportsEmbeddings;
				case 'codeAnalysis': return capabilities.supportsCodeAnalysis;
				case 'imageGeneration': return capabilities.supportsImageGeneration;
				case 'imageAnalysis': return capabilities.supportsImageAnalysis;
				default: return false;
			}
		});
	}

	/**
	 * Update the status of a provider.
	 * @param providerId The ID of the provider
	 * @param status The new status information
	 */
	updateProviderStatus(providerId: string, status: Partial<ProviderStatus>): void {
		const currentStatus = this.providerStatus.get(providerId);

		if (!currentStatus) {
			this.logService.warn(`Attempted to update status of unregistered provider: ${providerId}`);
			return;
		}

		const newStatus: ProviderStatus = {
			...currentStatus,
			...status
		};

		this.providerStatus.set(providerId, newStatus);
		this._onProviderStatusChanged.fire({ providerId, status: newStatus });
	}

	/**
	 * Get the current status of a provider.
	 * @param providerId The ID of the provider
	 * @returns The provider status or undefined if not found
	 */
	getProviderStatus(providerId: string): ProviderStatus | undefined {
		return this.providerStatus.get(providerId);
	}
}
