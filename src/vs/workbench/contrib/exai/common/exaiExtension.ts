/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext } from 'vscode';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';

// Import registry to ensure contributions are registered
import './registry';

// Export activation function
export async function activate(context: ExtensionContext, instantiationService: IInstantiationService, logService: ILogService) {
	logService.info('ExAI extension activated');
	
	// Register commands
	// This would register VS Code commands for operating the CRCT system
	// registerCRCTCommands(context, instantiationService);
	
	// Return API for other extensions
	return {
		// Public API methods would go here
	};
}

// Export deactivation function
export async function deactivate(logService: ILogService) {
	logService.info('ExAI extension deactivated');
	// Any cleanup would go here
}