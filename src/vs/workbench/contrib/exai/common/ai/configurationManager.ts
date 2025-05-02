/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { ISecretStorageService } from 'vs/platform/secrets/common/secrets';

/**
 * Configuration for an AI provider.
 */
export interface ProviderConfiguration {
	enabled: boolean;
	apiKey?: string;
	organizationId?: string;
	baseUrl?: string;
	models: {
		default: string;
		completion?: string;
		chat?: string;
		embedding?: string;
		codeAnalysis?: string;
	};
	rateLimit: {
		maxRequestsPerMinute: number;
		maxTokensPerDay: number;
	};
	costSettings: {
		maxCostPerRequest: number;
		maxCostPerDay: number;
	};
}

/**
 * User preferences for AI provider selection and behavior.
 */
export interface ProviderPreferences {
	defaultProvider: string;
	providerPriority: string[];
	fallbackStrategy: 'sequential' | 'capability-based' | 'cost-based';
	costSensitivity: 'low' | 'medium' | 'high';
	performancePriority: 'speed' | 'quality' | 'balanced';
}

/**
 * Interface for the configuration manager.
 */
export interface IConfigurationManager {
	// Configuration access
	getProviderConfiguration(providerId: string): ProviderConfiguration;
	updateProviderConfiguration(providerId: string, config: Partial<ProviderConfiguration>): Promise<void>;
	
	// API key management
	getApiKey(providerId: string): Promise<string | undefined>;
	setApiKey(providerId: string, apiKey: string): Promise<void>;
	
	// Provider preferences
	getProviderPreferences(): ProviderPreferences;
	setProviderPreferences(preferences: Partial<ProviderPreferences>): Promise<void>;
}

/**
 * Implementation of the configuration manager.
 */
export class ConfigurationManager implements IConfigurationManager {
	private static readonly CONFIG_KEY_PREFIX = 'exai.providers';
	private static readonly API_KEY_PREFIX = 'exai.apiKey';
	private static readonly PREFERENCES_KEY = 'exai.providerPreferences';
	
	private defaultConfig: ProviderConfiguration = {
		enabled: true,
		models: {
			default: 'default'
		},
		rateLimit: {
			maxRequestsPerMinute: 60,
			maxTokensPerDay: 100000
		},
		costSettings: {
			maxCostPerRequest: 0.1,
			maxCostPerDay: 5.0
		}
	};
	
	private defaultPreferences: ProviderPreferences = {
		defaultProvider: 'openai',
		providerPriority: ['openai', 'claude', 'perplexity', 'copilot'],
		fallbackStrategy: 'sequential',
		costSensitivity: 'medium',
		performancePriority: 'balanced'
	};

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@ILogService private readonly logService: ILogService
	) {}

	/**
	 * Get the configuration for a provider.
	 * @param providerId The ID of the provider
	 * @returns The provider configuration
	 */
	getProviderConfiguration(providerId: string): ProviderConfiguration {
		const configKey = `${ConfigurationManager.CONFIG_KEY_PREFIX}.${providerId}`;
		const userConfig = this.configurationService.getValue<Partial<ProviderConfiguration>>(configKey) || {};
		
		return {
			...this.defaultConfig,
			...userConfig
		};
	}

	/**
	 * Update the configuration for a provider.
	 * @param providerId The ID of the provider
	 * @param config Partial configuration to update
	 */
	async updateProviderConfiguration(providerId: string, config: Partial<ProviderConfiguration>): Promise<void> {
		const configKey = `${ConfigurationManager.CONFIG_KEY_PREFIX}.${providerId}`;
		const currentConfig = this.getProviderConfiguration(providerId);
		
		// Merge the new config with the current one
		const newConfig = {
			...currentConfig,
			...config
		};
		
		// API keys are stored separately in secure storage
		if (newConfig.apiKey !== undefined) {
			await this.setApiKey(providerId, newConfig.apiKey);
			delete newConfig.apiKey;
		}
		
		// Update the configuration
		await this.configurationService.updateValue(configKey, newConfig);
	}

	/**
	 * Get the API key for a provider.
	 * @param providerId The ID of the provider
	 * @returns Promise resolving to the API key or undefined
	 */
	async getApiKey(providerId: string): Promise<string | undefined> {
		const keyId = `${ConfigurationManager.API_KEY_PREFIX}.${providerId}`;
		try {
			return await this.secretStorageService.get(keyId);
		} catch (error) {
			this.logService.error(`Failed to retrieve API key for provider ${providerId}:`, error);
			return undefined;
		}
	}

	/**
	 * Set the API key for a provider.
	 * @param providerId The ID of the provider
	 * @param apiKey The API key to store
	 */
	async setApiKey(providerId: string, apiKey: string): Promise<void> {
		const keyId = `${ConfigurationManager.API_KEY_PREFIX}.${providerId}`;
		try {
			await this.secretStorageService.store(keyId, apiKey);
		} catch (error) {
			this.logService.error(`Failed to store API key for provider ${providerId}:`, error);
			throw new Error(`Could not store API key for provider ${providerId}: ${(error as Error).message}`);
		}
	}

	/**
	 * Get the provider preferences.
	 * @returns The provider preferences
	 */
	getProviderPreferences(): ProviderPreferences {
		const storedPreferences = this.configurationService.getValue<Partial<ProviderPreferences>>(ConfigurationManager.PREFERENCES_KEY) || {};
		
		return {
			...this.defaultPreferences,
			...storedPreferences
		};
	}

	/**
	 * Set the provider preferences.
	 * @param preferences Partial preferences to update
	 */
	async setProviderPreferences(preferences: Partial<ProviderPreferences>): Promise<void> {
		const currentPreferences = this.getProviderPreferences();
		
		const newPreferences = {
			...currentPreferences,
			...preferences
		};
		
		await this.configurationService.updateValue(ConfigurationManager.PREFERENCES_KEY, newPreferences);
	}
}