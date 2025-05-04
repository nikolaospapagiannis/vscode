/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from 'vs/workbench/services/statusbar/browser/statusbar';
import { ICRCTService, CRCTPhase } from 'vs/workbench/contrib/exai/common/crct/types';
import { ThemeColor } from 'vs/platform/theme/common/themeService';
import { localize } from 'vs/nls';
import { SHOW_DEPENDENCY_GRAPH_COMMAND_ID } from '../commands/commandConstants';

export class CRCTStatusBarContribution extends Disposable {
    private static readonly CRCT_PHASE_STATUS_ID = 'crct.phaseStatus';
    private static readonly CRCT_CONTEXT_STATUS_ID = 'crct.contextStatus';
    
    private phaseStatusAccessor: IStatusbarEntryAccessor | undefined;
    private contextStatusAccessor: IStatusbarEntryAccessor | undefined;
    private readonly disposables = this._register(new DisposableStore());
    
    private currentPhase: CRCTPhase = CRCTPhase.Setup;
    private activeContextName: string | undefined;
    private isAnalyzing: boolean = false;
    
    private readonly _onPhaseChanged = this._register(new Emitter<CRCTPhase>());
    public readonly onPhaseChanged: Event<CRCTPhase> = this._onPhaseChanged.event;
    
    private readonly _onContextChanged = this._register(new Emitter<string | undefined>());
    public readonly onContextChanged: Event<string | undefined> = this._onContextChanged.event;
    
    private readonly _onAnalyzingStateChanged = this._register(new Emitter<boolean>());
    public readonly onAnalyzingStateChanged: Event<boolean> = this._onAnalyzingStateChanged.event;

    constructor(
        @IStatusbarService private readonly statusbarService: IStatusbarService,
        @ICRCTService private readonly crctService: ICRCTService
    ) {
        super();
        
        this.initialize();
    }

    private initialize(): void {
        // Create phase status item
        this.phaseStatusAccessor = this.statusbarService.addEntry(
            this.getPhaseStatusEntry(),
            CRCTStatusBarContribution.CRCT_PHASE_STATUS_ID,
            StatusbarAlignment.RIGHT,
            100
        );
        
        // Create context status item
        this.contextStatusAccessor = this.statusbarService.addEntry(
            this.getContextStatusEntry(),
            CRCTStatusBarContribution.CRCT_CONTEXT_STATUS_ID,
            StatusbarAlignment.RIGHT,
            101
        );
        
        // Listen for phase changes
        this.disposables.add(this.crctService.onPhaseChanged(phase => {
            this.currentPhase = phase;
            this._onPhaseChanged.fire(phase);
            this.updatePhaseStatus();
        }));
        
        // Listen for context changes
        this.disposables.add(this.crctService.onActiveContextChanged(contextName => {
            this.activeContextName = contextName;
            this._onContextChanged.fire(contextName);
            this.updateContextStatus();
        }));
        
        // Listen for analyzing state
        this.disposables.add(this.crctService.onAnalysisStarted(() => {
            this.isAnalyzing = true;
            this._onAnalyzingStateChanged.fire(true);
            this.updatePhaseStatus();
        }));
        
        this.disposables.add(this.crctService.onAnalysisCompleted(() => {
            this.isAnalyzing = false;
            this._onAnalyzingStateChanged.fire(false);
            this.updatePhaseStatus();
        }));
    }

    private getPhaseStatusEntry(): IStatusbarEntry {
        let text: string;
        let tooltip: string;
        let color: ThemeColor | undefined;
        
        switch (this.currentPhase) {
            case CRCTPhase.Setup:
                text = '$(gear) CRCT: Setup';
                tooltip = 'CRCT is in setup phase. Click to view dependency graph.';
                break;
            case CRCTPhase.Strategy:
                text = '$(lightbulb) CRCT: Strategy';
                tooltip = 'CRCT is in strategy phase. Click to view dependency graph.';
                color = new ThemeColor('statusBarItem.warningBackground');
                break;
            case CRCTPhase.Execution:
                text = '$(play) CRCT: Execution';
                tooltip = 'CRCT is in execution phase. Click to view dependency graph.';
                color = new ThemeColor('statusBarItem.prominentBackground');
                break;
            default:
                text = '$(question) CRCT: Unknown';
                tooltip = 'CRCT phase is unknown. Click to view dependency graph.';
        }
        
        // Add analyzing indicator if currently analyzing
        if (this.isAnalyzing) {
            text = '$(sync~spin) ' + text + ' (Analyzing)';
            tooltip = 'CRCT is analyzing the workspace. ' + tooltip;
        }
        
        return {
            name: localize('crct.phaseStatus.name', "CRCT Phase"),
            text,
            tooltip,
            command: SHOW_DEPENDENCY_GRAPH_COMMAND_ID,
            backgroundColor: color
        };
    }

    private getContextStatusEntry(): IStatusbarEntry {
        const hasContext = !!this.activeContextName;
        
        return {
            name: localize('crct.contextStatus.name', "CRCT Context"),
            text: hasContext 
                ? `$(bracket) Context: ${this.activeContextName}` 
                : '$(bracket) No Active Context',
            tooltip: hasContext
                ? `Active CRCT context: ${this.activeContextName}. Click to manage.`
                : 'No active CRCT context. Click to set one.',
            command: 'crct.manageContext'
        };
    }

    private updatePhaseStatus(): void {
        if (this.phaseStatusAccessor) {
            this.phaseStatusAccessor.update(this.getPhaseStatusEntry());
        }
    }

    private updateContextStatus(): void {
        if (this.contextStatusAccessor) {
            this.contextStatusAccessor.update(this.getContextStatusEntry());
        }
    }
    
    // Public API to update status
    
    public setPhase(phase: CRCTPhase): void {
        this.currentPhase = phase;
        this._onPhaseChanged.fire(phase);
        this.updatePhaseStatus();
    }
    
    public setActiveContext(contextName: string | undefined): void {
        this.activeContextName = contextName;
        this._onContextChanged.fire(contextName);
        this.updateContextStatus();
    }
    
    public setAnalyzing(analyzing: boolean): void {
        this.isAnalyzing = analyzing;
        this._onAnalyzingStateChanged.fire(analyzing);
        this.updatePhaseStatus();
    }
}