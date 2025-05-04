/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ICRCTService } from './types';
import { CRCTService } from './crctService';
import { registerCRCTProvider, registerCRCTServices } from './crctRegistration';
import { IAIProviderService } from '../aiProviders/types';
import { localize } from 'vs/nls';

/**
 * Workbench contribution for initializing the CRCT system
 */
export class CRCTContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IAIProviderService private readonly providerService: IAIProviderService
	) {
		super();

		// Register CRCT services
		registerCRCTServices();

		// Initialize when workbench is ready
		lifecycleService.when(LifecyclePhase.Ready).then(() => {
			this._initialize();
		});
	}

	/**
	 * Initialize the CRCT system
	 */
	private async _initialize(): Promise<void> {
		this.logService.info(localize('crct.initializing', "Initializing CRCT System"));

		try {
			// Register CRCT provider
			const registration = registerCRCTProvider(
				this.instantiationService,
				this.providerService,
				this.workspaceService,
				this.logService
			);

			if (registration) {
				this._register(registration);
				this.logService.info(localize('crct.providerRegistered', "CRCT Provider registered successfully"));
			} else {
				this.logService.warn(localize('crct.providerRegistrationFailed', "CRCT Provider registration skipped - no workspace folder"));
			}

			// Get CRCT service
			const crctService = this.instantiationService.invokeFunction(accessor => accessor.get(ICRCTService));

			// Register disposables
			this._register(crctService.onDidChangePhase(phase => {
				this.logService.info(localize('crct.phaseChanged', "CRCT phase changed to: {0}", phase));
			}));

			this._register(crctService.onDidChangeDependencies(() => {
				this.logService.info(localize('crct.dependenciesChanged', "CRCT dependencies changed"));
			}));

			this.logService.info(localize('crct.initialized', "CRCT System initialized successfully"));
		} catch (error) {
			this.logService.error(localize('crct.initializationFailed', "Failed to initialize CRCT System: {0}", error));
		}
	}
}