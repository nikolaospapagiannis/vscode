/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { CRCTCommandsContribution } from './commands/crctCommands';
import { CRCTStatusBarContribution } from './statusBar/crctStatusBar';
import { CRCTProgressReporter } from './statusBar/progressReporter';
import { DependencyGraphViewContribution } from './visualization/dependencyGraph';
import { registerCRCTMenus } from './commands/menus';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';

// This class serves as a coordinator for all UI components of CRCT
export class CRCTUIContribution extends Disposable {
    constructor(
        @IInstantiationService private readonly instantiationService: IInstantiationService,
        @ILogService private readonly logService: ILogService
    ) {
        super();
        
        this.initialize();
    }
    
    private initialize(): void {
        this.logService.info('Initializing CRCT UI components');
        
        // Register commands
        this._register(this.instantiationService.createInstance(CRCTCommandsContribution));
        
        // Register status bar contributions
        this._register(this.instantiationService.createInstance(CRCTStatusBarContribution));
        
        // Register progress reporter
        this._register(this.instantiationService.createInstance(CRCTProgressReporter));
        
        // Register dependency graph view
        this._register(this.instantiationService.createInstance(DependencyGraphViewContribution));
        
        // Register menus
        registerCRCTMenus();
        
        this.logService.info('CRCT UI components initialized');
    }
}

// Register the UI contribution as a workbench contribution
export function registerCRCTUIComponents(): void {
    const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
    
    workbenchRegistry.registerWorkbenchContribution(
        CRCTUIContribution,
        LifecyclePhase.Ready
    );
}