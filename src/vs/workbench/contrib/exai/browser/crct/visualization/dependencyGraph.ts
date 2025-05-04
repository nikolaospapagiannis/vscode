/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ICRCTService } from 'vs/workbench/contrib/exai/common/crct/types';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IViewContainerRegistry, Extensions as ViewContainerExtensions, ViewContainer, IViewsRegistry, ViewContainerLocation, IView, IViewDescriptorService } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IWebviewService, WebviewOverlay } from 'vs/workbench/contrib/webview/browser/webview';
import { DependencyGraphWebview } from './graphRenderer';
import { KeyInfo } from 'vs/workbench/contrib/exai/common/crct/types';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IFileService } from 'vs/platform/files/common/files';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IQuickInputService, QuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { $, append, clearNode, createCSSRule, h } from 'vs/base/browser/dom';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import * as icons from 'vs/base/common/codicons';
import { registerCodicon } from 'vs/base/common/codicons';
import * as colorRegistry from './colorRegistry';
import { generateUuid } from 'vs/base/common/uuid';
import { SHOW_DEPENDENCY_GRAPH_COMMAND_ID } from '../commands/commandConstants';

// Register the codicon for the dependency graph
const dependencyGraphIcon = registerCodicon('dependency-graph', icons.Codicon.references);

// Register the dependency graph view
export class DependencyGraphViewContribution extends Disposable {
    private static readonly DEPENDENCY_GRAPH_VIEW_ID = 'crct.dependencyGraph';
    private viewContainer: ViewContainer | undefined;
    private dependencyGraphView: DependencyGraphView | undefined;
    private readonly disposables = this._register(new DisposableStore());
    
    constructor(
        @IInstantiationService private readonly instantiationService: IInstantiationService,
        @ICRCTService private readonly crctService: ICRCTService,
        @ICommandService private readonly commandService: ICommandService,
        @IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
        @INotificationService private readonly notificationService: INotificationService
    ) {
        super();
        
        this.registerViewContainer();
        this.registerCommands();
    }
    
    private registerViewContainer(): void {
        // Register view container for dependency graph
        const viewContainerRegistry = Registry.as<IViewContainerRegistry>(ViewContainerExtensions.ViewContainersRegistry);
        this.viewContainer = viewContainerRegistry.registerViewContainer(
            {
                id: DependencyGraphViewContribution.DEPENDENCY_GRAPH_VIEW_ID,
                title: localize('crct.dependencyGraph.title', "CRCT Dependency Graph"),
                icon: dependencyGraphIcon,
                ctorDescriptor: new SyncDescriptor(DependencyGraphViewContainer)
            },
            ViewContainerLocation.Sidebar
        );
        
        // Register views within container
        const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);
        
        // Register dependency graph view
        viewsRegistry.registerViews(
            [
                {
                    id: 'crct.dependencyGraphView',
                    name: localize('crct.dependencyGraphView.title', "Dependency Graph"),
                    containerIcon: dependencyGraphIcon,
                    canToggleVisibility: true,
                    canMoveView: true,
                    when: undefined,
                    ctorDescriptor: new SyncDescriptor(DependencyGraphView)
                }
            ],
            this.viewContainer
        );
    }
    
    private registerCommands(): void {
        // Register command to show the dependency graph
        this.disposables.add(this.commandService.registerCommand(SHOW_DEPENDENCY_GRAPH_COMMAND_ID, async (keyId?: string) => {
            try {
                await this.showDependencyGraph(keyId);
            } catch (error) {
                this.notificationService.error(localize('crct.dependencyGraph.error', "Failed to show dependency graph: {0}", error.message));
            }
        }));
    }
    
    private async showDependencyGraph(keyId?: string): Promise<void> {
        if (!this.viewContainer) {
            throw new Error(localize('crct.dependencyGraph.noContainer', "Dependency graph view container not found"));
        }
        
        // Focus the view container
        await this.viewDescriptorService.openViewContainer(this.viewContainer.id, true);
        
        // Get the view
        const viewDescriptor = this.viewDescriptorService.getViewDescriptorById('crct.dependencyGraphView');
        if (!viewDescriptor) {
            throw new Error(localize('crct.dependencyGraph.noView', "Dependency graph view not found"));
        }
        
        // Get the view instance
        const view = this.viewDescriptorService.getViewInstanceById(viewDescriptor.id) as DependencyGraphView;
        
        if (!view) {
            throw new Error(localize('crct.dependencyGraph.viewNotReady', "Dependency graph view is not ready"));
        }
        
        // Show dependencies for the specified key, or prompt user to select a key
        if (keyId) {
            const key = await this.crctService.keyManager.getKeyForString(keyId);
            if (key) {
                await view.showDependenciesForKey(key);
            } else {
                this.notificationService.warn(localize('crct.dependencyGraph.keyNotFound', "Key not found: {0}", keyId));
            }
        } else {
            await view.promptAndShowDependencies();
        }
    }
}

export class DependencyGraphViewContainer extends Disposable {
    // View container implementation
    static readonly ID = 'crct.dependencyGraph';
    
    constructor() {
        super();
    }
}

export class DependencyGraphView extends Disposable implements IView {
    static readonly ID = 'crct.dependencyGraphView';
    
    private readonly _container: HTMLElement;
    private readonly _webviewContainer: HTMLElement;
    private _graphRenderer: DependencyGraphWebview | undefined;
    private readonly _disposables = this._register(new DisposableStore());
    private readonly _onDidFocusViewEmitter = this._register(new Emitter<void>());
    
    readonly onDidFocus = this._onDidFocusViewEmitter.event;
    readonly onDidBlur = Event.None;
    readonly onDidChangeBodyVisibility = Event.None;
    
    private _selectedKeyId: string | undefined;
    
    constructor(
        @ICRCTService private readonly crctService: ICRCTService,
        @IWebviewService private readonly webviewService: IWebviewService,
        @IInstantiationService private readonly instantiationService: IInstantiationService,
        @IProgressService private readonly progressService: IProgressService,
        @IEditorService private readonly editorService: IEditorService,
        @IFileService private readonly fileService: IFileService,
        @INotificationService private readonly notificationService: INotificationService,
        @IQuickInputService private readonly quickInputService: IQuickInputService,
        @IThemeService private readonly themeService: IThemeService
    ) {
        super();
        
        // Create container
        this._container = $('.dependency-graph-container');
        this._webviewContainer = append(this._container, $('.webview-container'));
        
        // Initialize the webview
        this._initializeWebview();
    }
    
    private _initializeWebview(): void {
        // Create the graph renderer
        this._graphRenderer = this._disposables.add(this.instantiationService.createInstance(
            DependencyGraphWebview,
            this._webviewContainer
        ));
        
        // Listen for node events
        this._disposables.add(this._graphRenderer.onNodeClick(nodeId => this.handleNodeClick(nodeId)));
        this._disposables.add(this._graphRenderer.onNodeDoubleClick(nodeId => this.handleNodeDoubleClick(nodeId)));
        this._disposables.add(this._graphRenderer.onNavigateToFile(({nodeId, path}) => this.navigateToFile(nodeId, path)));
        this._disposables.add(this._graphRenderer.onExportSvg(svgData => this.handleExportSvg(svgData)));
    }
    
    // IView implementation
    public get element(): HTMLElement {
        return this._container;
    }
    
    public focus(): void {
        if (this._webviewContainer) {
            this._webviewContainer.focus();
            this._onDidFocusViewEmitter.fire();
        }
    }
    
    public layout(width: number, height: number): void {
        // Update container size
        this._webviewContainer.style.width = `${width}px`;
        this._webviewContainer.style.height = `${height}px`;
    }
    
    // Public methods
    public async showDependenciesForKey(key: KeyInfo): Promise<void> {
        if (!this._graphRenderer) {
            return;
        }
        
        this._selectedKeyId = key.keyString;
        
        return this.progressService.withProgress(
            {
                location: ProgressLocation.Notification,
                title: localize('crct.dependencyGraph.loading', "Loading dependencies for {0}...", key.keyString),
                cancellable: true
            },
            async (progress, token) => {
                const cts = new CancellationTokenSource(token);
                
                try {
                    // Generate graph data from key
                    const graphData = await this._graphRenderer!.createGraphDataFromKey(key);
                    
                    // Update the graph
                    this._graphRenderer!.updateGraph(graphData);
                    
                    // Highlight the node
                    this._graphRenderer!.highlightNode(key.keyString);
                    
                    // Center on the node
                    this._graphRenderer!.centerOnNode(key.keyString);
                } catch (error) {
                    this.notificationService.error(localize('crct.dependencyGraph.loadError', "Failed to load dependencies: {0}", error.message));
                } finally {
                    cts.dispose();
                }
            }
        );
    }
    
    public async showFullDependencyGraph(): Promise<void> {
        if (!this._graphRenderer) {
            return;
        }
        
        this._selectedKeyId = undefined;
        
        return this.progressService.withProgress(
            {
                location: ProgressLocation.Notification,
                title: localize('crct.dependencyGraph.loadingFull', "Loading full dependency graph..."),
                cancellable: true
            },
            async (progress, token) => {
                const cts = new CancellationTokenSource(token);
                
                try {
                    // Generate full graph data
                    const graphData = await this._graphRenderer!.createFullGraphData();
                    
                    // Update the graph
                    this._graphRenderer!.updateGraph(graphData);
                } catch (error) {
                    this.notificationService.error(localize('crct.dependencyGraph.loadFullError', "Failed to load full dependency graph: {0}", error.message));
                } finally {
                    cts.dispose();
                }
            }
        );
    }
    
    public async promptAndShowDependencies(): Promise<void> {
        // Create quick pick items for options
        const options: QuickPickItem[] = [
            {
                label: localize('crct.dependencyGraph.fullGraph', "Show Full Dependency Graph"),
                description: localize('crct.dependencyGraph.fullGraphDesc', "Display the entire dependency graph"),
                detail: localize('crct.dependencyGraph.fullGraphDetail', "Warning: This may be very large for complex projects")
            },
            {
                label: localize('crct.dependencyGraph.selectKey', "Select Key"),
                description: localize('crct.dependencyGraph.selectKeyDesc', "Choose a specific key to visualize"),
                detail: localize('crct.dependencyGraph.selectKeyDetail', "Show dependencies for a specific file or directory")
            }
        ];
        
        // Show quick pick
        const selected = await this.quickInputService.pick(options, {
            placeHolder: localize('crct.dependencyGraph.selectOption', "Select dependency graph visualization option")
        });
        
        if (!selected) {
            return;
        }
        
        if (selected.label === options[0].label) {
            // Show full graph
            await this.showFullDependencyGraph();
        } else {
            // Select key
            await this.promptForKeyAndShow();
        }
    }
    
    private async promptForKeyAndShow(): Promise<void> {
        // Get all keys
        const keys = await this.crctService.keyManager.getAllKeys();
        
        // Create quick pick items for keys
        const keyItems: QuickPickItem[] = keys.map(key => ({
            label: key.keyString,
            description: key.isDirectory ? localize('crct.dependencyGraph.directory', "Directory") : localize('crct.dependencyGraph.file', "File"),
            detail: key.normPath
        }));
        
        // Show quick pick
        const selected = await this.quickInputService.pick(keyItems, {
            placeHolder: localize('crct.dependencyGraph.selectKey', "Select a key to visualize dependencies"),
            matchOnDescription: true,
            matchOnDetail: true
        });
        
        if (!selected) {
            return;
        }
        
        // Find the corresponding key
        const key = keys.find(k => k.keyString === selected.label);
        if (key) {
            await this.showDependenciesForKey(key);
        }
    }
    
    // Event handlers
    private handleNodeClick(nodeId: string): void {
        if (!this._graphRenderer) {
            return;
        }
        
        // Highlight the node
        this._graphRenderer.highlightNode(nodeId);
    }
    
    private handleNodeDoubleClick(nodeId: string): void {
        if (!this._graphRenderer) {
            return;
        }
        
        // Get the key
        this.crctService.keyManager.getKeyForString(nodeId).then(key => {
            if (key) {
                // Show dependencies for this key
                this.showDependenciesForKey(key);
            }
        });
    }
    
    private navigateToFile(nodeId: string, path: string): void {
        // Open the file in the editor
        if (path) {
            this.editorService.openEditor({ resource: URI.file(path) });
        }
    }
    
    private handleExportSvg(svgData: string): void {
        // Generate a temporary file name
        const fileName = `crct-dependency-graph-${generateUuid()}.svg`;
        const filePath = `/tmp/${fileName}`;
        
        // Write SVG to file
        this.fileService.writeFile(URI.file(filePath), new Uint8Array(Buffer.from(svgData))).then(() => {
            this.notificationService.info(localize('crct.dependencyGraph.exported', "Dependency graph exported to {0}", filePath));
        }).catch(error => {
            this.notificationService.error(localize('crct.dependencyGraph.exportError', "Failed to export dependency graph: {0}", error.message));
        });
    }
}

// Register CSS
registerThemingParticipant((theme, collector) => {
    // Container styling
    collector.addRule(`
        .dependency-graph-container {
            height: 100%;
            display: flex;
            flex-direction: column;
        }
        
        .webview-container {
            flex: 1;
            position: relative;
        }
    `);
});