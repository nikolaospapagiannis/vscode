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

/**
 * Workbench contribution for initializing the Multi-Provider Framework
 */
export class MultiProviderContribution extends Disposable implements IWorkbenchContribution {
	private readonly _controller: MultiProviderController;

	constructor(
		@ILifecycleService lifecycleService: ILifecycleService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Create the controller
		this._controller = new MultiProviderController(configurationService, logService);

		// Register the service
		registerSingleton(IMultiProviderService, MultiProviderService, InstantiationType.Delayed);

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
			// Load provider configurations from settings
			await this._initializeProviders();

			this.logService.info('ExAI Multi-Provider Framework initialized successfully');
		} catch (error) {
			this.logService.error(`Failed to initialize ExAI Multi-Provider Framework: ${error}`);
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
					organizationId: providerConfigs.openai.organizationId
				});
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
					baseUrl: providerConfigs.claude.baseUrl
				});
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
					baseUrl: providerConfigs.perplexity.baseUrl
				});
			} catch (error) {
				this.logService.error(`Failed to initialize Perplexity provider: ${error}`);
			}
		}
	}
}
