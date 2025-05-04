/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { MultiProviderContribution } from './aiProviders/multiProviderContribution';
import { CRCTContribution } from './crct/crctContribution';

// Register workbench contributions
const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);

// Register MultiProvider contribution
workbenchRegistry.registerWorkbenchContribution(
	MultiProviderContribution,
	LifecyclePhase.Starting
);

// Register CRCT contribution
workbenchRegistry.registerWorkbenchContribution(
	CRCTContribution,
	LifecyclePhase.Ready
);