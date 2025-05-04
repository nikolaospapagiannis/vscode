/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { AIProviderType } from './types';
import { MultiProviderController } from './multiProviderController';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IMultiProviderService, MultiProviderService } from './multiProviderService';
import { AIProviderFactory } from './aiProviderFactory';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IRequestService } from 'vs/platform/request/common/request';
import { ISecretStorageService } from 'vs/platform/secrets/common/secrets';
import { ProviderAdapter, createProviderAdapter } from './providerAdapter';
import { IAIProviderService, AIProviderService } from './aiProviderService';
import { IAIProviderService as ICoreAIProviderService } from '../ai/providerService';

/**
 * Workbench contribution for initializing the Multi-Provider Framework
 */
export class MultiProviderContribution extends Disposable implements IWorkbenchContribution {
	private readonly _controller: MultiProviderController;

	constructor(
		@ILifecycleService lifecycleService: ILifecycleService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IRequestService private readonly requestService: IRequestService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@ICoreAIProviderService private readonly coreProviderService: ICoreAIProviderService
	) {
		super();

		// Register factory services
		AIProviderFactory.setInstantiationService(instantiationService);
		AIProviderFactory.setLogService(logService);
		AIProviderFactory.setRequestService(requestService);

		// Create the controller
		this._controller = new MultiProviderController(configurationService, logService);

		// Register the service
		registerSingleton(IMultiProviderService, MultiProviderService, InstantiationType.Delayed);
		
		// Register the provider service
		registerSingleton(IAIProviderService, AIProviderService, InstantiationType.Delayed);

		// Initialize when workbench is ready
		lifecycleService.when(LifecyclePhase.Ready).then(() => {
			this._initialize();
		});
	}

	/**
	 * Initialize the multi-provider framework
	 */
	private async _initialize(): Promise<void> {
		this.logService.info('Initializing ExAI Multi-Provider Framework');

		try {
			// Register adapter for core providers
			this._registerCoreProviderAdapters();
			
			// Load provider configurations from settings
			await this._initializeProviders();
			
			// Register default configurations
			this._registerDefaultConfigurations();

			this.logService.info('ExAI Multi-Provider Framework initialized successfully');
		} catch (error) {
			this.logService.error(`Failed to initialize ExAI Multi-Provider Framework: ${error}`);
		}
	}
	
	/**
	 * Register adapters for core providers
	 */
	private _registerCoreProviderAdapters(): void {
		// Get all providers from the core service
		const coreProviders = this.coreProviderService.getAllProviders();
		
		for (const coreProvider of coreProviders) {
			try {
				// Create an adapter for the core provider
				const adapter = createProviderAdapter(coreProvider, this.logService);
				
				// Register the adapter with our controller
				this._controller.registerProvider(adapter);
				
				this.logService.info(`Registered adapter for core provider: ${coreProvider.id}`);
			} catch (error) {
				this.logService.error(`Failed to register adapter for provider ${coreProvider.id}:`, error);
			}
		}
	}

	/**
	 * Initialize providers from configuration
	 */
	private async _initializeProviders(): Promise<void> {
		// Get provider configurations from settings
		const providerConfigs = this.configurationService.getValue<any>('exai.multiProvider.providers') || {};

		// Initialize OpenAI provider
		if (providerConfigs.openai?.apiKey) {
			try {
				await this._controller.createAndRegisterProvider(AIProviderType.OpenAI, {
					type: AIProviderType.OpenAI,
					apiKey: providerConfigs.openai.apiKey,
					baseUrl: providerConfigs.openai.baseUrl,
					organizationId: providerConfigs.openai.organizationId,
					defaultModel: providerConfigs.openai.defaultModel
				});
				this.logService.info('OpenAI provider initialized successfully');
			} catch (error) {
				this.logService.error(`Failed to initialize OpenAI provider: ${error}`);
			}
		}

		// Initialize Claude provider
		if (providerConfigs.claude?.apiKey) {
			try {
				await this._controller.createAndRegisterProvider(AIProviderType.Claude, {
					type: AIProviderType.Claude,
					apiKey: providerConfigs.claude.apiKey,
					baseUrl: providerConfigs.claude.baseUrl,
					defaultModel: providerConfigs.claude.defaultModel
				});
				this.logService.info('Claude provider initialized successfully');
			} catch (error) {
				this.logService.error(`Failed to initialize Claude provider: ${error}`);
			}
		}

		// Initialize Perplexity provider
		if (providerConfigs.perplexity?.apiKey) {
			try {
				await this._controller.createAndRegisterProvider(AIProviderType.Perplexity, {
					type: AIProviderType.Perplexity,
					apiKey: providerConfigs.perplexity.apiKey,
					baseUrl: providerConfigs.perplexity.baseUrl,
					defaultModel: providerConfigs.perplexity.defaultModel
				});
				this.logService.info('Perplexity provider initialized successfully');
			} catch (error) {
				this.logService.error(`Failed to initialize Perplexity provider: ${error}`);
			}
		}
		
		// Look for keys in secret storage for providers that weren't configured
		this._initializeFromSecretStorage('openai', AIProviderType.OpenAI);
		this._initializeFromSecretStorage('claude', AIProviderType.Claude);
		this._initializeFromSecretStorage('perplexity', AIProviderType.Perplexity);
	}
	
	/**
	 * Initialize a provider using keys from secret storage
	 * @param providerId Provider ID in secret storage
	 * @param providerType Provider type enum
	 */
	private async _initializeFromSecretStorage(providerId: string, providerType: AIProviderType): Promise<void> {
		// Skip if already initialized from settings
		const providerConfigs = this.configurationService.getValue<any>('exai.multiProvider.providers') || {};
		if (providerConfigs[providerId]?.apiKey) {
			return;
		}
		
		try {
			// Try to get the API key from secret storage
			const keyId = `exai.apiKey.${providerId}`;
			const apiKey = await this.secretStorageService.get(keyId);
			
			if (apiKey) {
				// Initialize the provider with the key from secret storage
				await this._controller.createAndRegisterProvider(providerType, {
					type: providerType,
					apiKey: apiKey
				});
				this.logService.info(`${providerId} provider initialized from secret storage`);
			}
		} catch (error) {
			this.logService.error(`Failed to initialize ${providerId} provider from secret storage:`, error);
		}
	}
	
	/**
	 * Register default configurations for providers
	 */
	private _registerDefaultConfigurations(): void {
		// Register default configuration for OpenAI
		this._controller.registerDefaultConfiguration(AIProviderType.OpenAI, {
			type: AIProviderType.OpenAI,
			apiKey: '',
			baseUrl: 'https://api.openai.com/v1',
			defaultModel: 'gpt-4-turbo'
		});
		
		// Register default configuration for Claude
		this._controller.registerDefaultConfiguration(AIProviderType.Claude, {
			type: AIProviderType.Claude,
			apiKey: '',
			baseUrl: 'https://api.anthropic.com',
			defaultModel: 'claude-3-sonnet'
		});
		
		// Register default configuration for Perplexity
		this._controller.registerDefaultConfiguration(AIProviderType.Perplexity, {
			type: AIProviderType.Perplexity,
			apiKey: '',
			baseUrl: 'https://api.perplexity.ai',
			defaultModel: 'pplx-70b-online'
		});
	}
}
