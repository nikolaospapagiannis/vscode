/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ICRCTService } from './types';
import { CRCTService } from './crctService';
import { CRCTProvider } from './crctProvider';
import { IAIProviderService } from '../aiProviders/types';
import { URI } from 'vs/base/common/uri';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Register the CRCT service with the VS Code DI system
 */
export function registerCRCTServices(): void {
	// Register the CRCT service
	registerSingleton(ICRCTService, CRCTService, true);
}

/**
 * Register the CRCT provider with the AI provider service
 */
export function registerCRCTProvider(
	instantiationService: IInstantiationService,
	providerService: IAIProviderService,
	workspaceService: IWorkspaceContextService,
	logService: ILogService
): IDisposable | undefined {
	const workspaceFolder = workspaceService.getWorkspace().folders[0];
	if (!workspaceFolder) {
		logService.warn('CRCT Provider: No workspace folder found, skipping registration');
		return undefined;
	}
	
	// Get workspace root URI
	const workspaceRoot = workspaceFolder.uri;
	
	// Create the CRCT provider
	const crctProvider = instantiationService.createInstance(CRCTProvider);
	
	// Initialize the provider with workspace root
	crctProvider.initialize({
		type: 'custom',
		apiKey: '',
		customOptions: {
			workspaceRoot: workspaceRoot.toString()
		}
	}).catch(error => {
		logService.error(`CRCT Provider: Failed to initialize: ${error}`);
	});
	
	// Register the provider
	return providerService.registerProvider(crctProvider);
}

/**
 * Register CRCT commands with VS Code
 */
export function registerCRCTCommands(
	instantiationService: IInstantiationService
): IDisposable[] {
	// Create command registration
	// These would be implemented in the extension context
	return [];
}