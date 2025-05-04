/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ICRCTService } from 'vs/workbench/contrib/exai/common/crct/types';
import { IFileService } from 'vs/platform/files/common/files';
import { IWebviewService, WebviewOptions, WebviewOverlay } from 'vs/workbench/contrib/webview/browser/webview';
import { URI } from 'vs/base/common/uri';
import { KeyInfo, DependencyType, DependencyInfo } from 'vs/workbench/contrib/exai/common/crct/types';
import { isAbsolute } from 'vs/base/common/path';
import { URI as VSCodeURI } from 'vscode-uri';
import { basename } from 'vs/base/common/resources';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ILogService } from 'vs/platform/log/common/log';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IJSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditing';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import * as colorRegistry from './colorRegistry';
import { Color } from 'vs/base/common/color';
import { join } from 'vs/base/common/path';

// Interfaces for graph data
export interface GraphNode {
    id: string;
    label: string;
    type: 'file' | 'directory' | 'group' | 'virtual';
    path: string;
    tier: number;
}

export interface GraphEdge {
    source: string;
    target: string;
    type: DependencyType | string;
    strength: number;
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    selected?: string;
}

// Class for rendering the dependency graph in a WebView
export class DependencyGraphWebview extends Disposable {
    private readonly webview: WebviewOverlay;
    private readonly disposables = this._register(new DisposableStore());
    private isReady: boolean = false;
    private pendingData: GraphData | null = null;
    private pendingHighlight: string | null = null;
    private pendingCenter: string | null = null;
    
    private readonly _onNodeClick = this._register(new Emitter<string>());
    public readonly onNodeClick: Event<string> = this._onNodeClick.event;
    
    private readonly _onNodeDoubleClick = this._register(new Emitter<string>());
    public readonly onNodeDoubleClick: Event<string> = this._onNodeDoubleClick.event;
    
    private readonly _onNavigateToFile = this._register(new Emitter<{ nodeId: string, path: string }>());
    public readonly onNavigateToFile: Event<{ nodeId: string, path: string }> = this._onNavigateToFile.event;
    
    private readonly _onExportSvg = this._register(new Emitter<string>());
    public readonly onExportSvg: Event<string> = this._onExportSvg.event;
    
    constructor(
        container: HTMLElement,
        @IWebviewService private readonly webviewService: IWebviewService,
        @ICRCTService private readonly crctService: ICRCTService,
        @IFileService private readonly fileService: IFileService,
        @IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
        @ILogService private readonly logService: ILogService,
        @IEditorService private readonly editorService: IEditorService,
        @IThemeService private readonly themeService: IThemeService
    ) {
        super();
        
        // Create WebView
        this.webview = this._register(webviewService.createWebviewOverlay(this.getWebviewOptions(), {}));
        this.webview.mountTo(container);
        
        // Initialize the WebView with HTML content
        this.loadWebviewContent();
        
        // Handle messages from WebView
        this.disposables.add(this.webview.onMessage(message => {
            this.handleWebviewMessage(message);
        }));
        
        // Listen for theme changes
        this.disposables.add(this.themeService.onDidColorThemeChange(() => {
            this.updateThemeColors();
        }));
    }
    
    private getWebviewOptions(): WebviewOptions {
        const webviewRootUri = URI.joinPath(URI.parse(this.environmentService.webviewExternalEndpoint!), 'vs/workbench/contrib/exai/browser/crct/visualization/webview/');
        
        return {
            enableScripts: true,
            localResourceRoots: [
                webviewRootUri,
                URI.joinPath(URI.parse(this.environmentService.appRoot), 'out', 'vs', 'workbench', 'contrib', 'exai', 'browser', 'crct', 'visualization', 'webview')
            ]
        };
    }
    
    private async loadWebviewContent(): Promise<void> {
        try {
            // Try to load the HTML file from the extension's resources
            const htmlPath = join(__dirname, 'webview', 'graphView.html');
            this.logService.info(`Loading WebView HTML from ${htmlPath}`);
            
            const htmlUri = URI.file(htmlPath);
            const html = await this.fileService.readFile(htmlUri);
            
            this.webview.html = html.value.toString();
        } catch (error) {
            this.logService.error(`Failed to load WebView HTML: ${error}`);
            // Fallback to embedded HTML
            this.webview.html = this.getHtmlForWebview();
        }
    }
    
    private getHtmlForWebview(): string {
        // Fallback HTML for the WebView if the file can't be loaded
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>CRCT Dependency Graph</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100vh;
                    overflow: hidden;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                }
                
                h1 {
                    margin-bottom: 20px;
                }
                
                .error-message {
                    max-width: 600px;
                    padding: 20px;
                    border-radius: 6px;
                    background-color: var(--vscode-editorWidget-background);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                }
                
                button {
                    margin-top: 20px;
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 2px;
                    cursor: pointer;
                }
                
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <h1>CRCT Dependency Graph</h1>
            <div class="error-message">
                <p>The dependency graph visualization failed to load. This may be due to a missing resource file or temporary issue.</p>
                <p>Please try refreshing the view or restarting VS Code.</p>
            </div>
            <button id="reload-btn">Reload View</button>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                // Tell the extension we're ready but in error state
                vscode.postMessage({
                    type: 'ready',
                    error: true
                });
                
                // Add reload button handler
                document.getElementById('reload-btn').addEventListener('click', () => {
                    vscode.postMessage({
                        type: 'reload'
                    });
                });
            </script>
        </body>
        </html>`;
    }
    
    private handleWebviewMessage(message: any): void {
        this.logService.debug(`Received message from WebView: ${message.type}`);
        
        switch (message.type) {
            case 'ready':
                this.isReady = true;
                
                // Send theme colors
                this.updateThemeColors();
                
                // Process any pending data
                if (this.pendingData) {
                    this.updateGraph(this.pendingData);
                    this.pendingData = null;
                }
                
                if (this.pendingHighlight) {
                    this.highlightNode(this.pendingHighlight);
                    this.pendingHighlight = null;
                }
                
                if (this.pendingCenter) {
                    this.centerOnNode(this.pendingCenter);
                    this.pendingCenter = null;
                }
                break;
                
            case 'reload':
                this.loadWebviewContent();
                break;
                
            case 'nodeClick':
                this._onNodeClick.fire(message.nodeId);
                break;
                
            case 'nodeDoubleClick':
                this._onNodeDoubleClick.fire(message.nodeId);
                break;
                
            case 'navigateToFile':
                this._onNavigateToFile.fire({
                    nodeId: message.nodeId,
                    path: message.path
                });
                break;
                
            case 'exportSvg':
                this._onExportSvg.fire(message.svgData);
                break;
                
            case 'graphRendered':
                // Graph rendering is complete
                this.logService.debug('Graph rendering complete');
                this.webview.postMessage({ type: 'showLoading', show: false });
                break;
                
            case 'error':
                this.logService.error(`Error in WebView: ${message.error}`);
                break;
        }
    }
    
    // Public API for updating the graph
    
    public updateGraph(data: GraphData): void {
        if (!this.isReady) {
            this.pendingData = data;
            return;
        }
        
        this.webview.postMessage({
            type: 'showLoading',
            show: true
        });
        
        this.webview.postMessage({
            type: 'updateGraph',
            data
        });
    }
    
    public highlightNode(nodeId: string): void {
        if (!this.isReady) {
            this.pendingHighlight = nodeId;
            return;
        }
        
        this.webview.postMessage({
            type: 'highlightNode',
            nodeId
        });
    }
    
    public centerOnNode(nodeId: string): void {
        if (!this.isReady) {
            this.pendingCenter = nodeId;
            return;
        }
        
        this.webview.postMessage({
            type: 'centerOnNode',
            nodeId
        });
    }
    
    public updateThemeColors(): void {
        const themeColors = this.getThemeColors();
        
        this.webview.postMessage({
            type: 'updateTheme',
            colors: themeColors
        });
    }
    
    private getThemeColors(): Record<string, string> {
        const colors: Record<string, string> = {};
        
        // Helper function to convert Color to hex
        const toHex = (color: Color): string => {
            return `#${color.rgba.r.toString(16).padStart(2, '0')}${color.rgba.g.toString(16).padStart(2, '0')}${color.rgba.b.toString(16).padStart(2, '0')}`;
        };
        
        // Base colors
        colors.nodeBaseColor = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctNodeBaseColor) || new Color(new RGBA(108, 108, 108, 1)));
        colors.edgeBaseColor = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctEdgeBaseColor) || new Color(new RGBA(77, 77, 77, 1)));
        colors.selectedNodeColor = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctSelectedNodeColor) || new Color(new RGBA(255, 204, 0, 1)));
        colors.hoveredNodeColor = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctHoveredNodeColor) || new Color(new RGBA(136, 204, 238, 1)));
        
        // Background and text colors
        colors.backgroundColor = toHex(this.themeService.getColorTheme().getColor(colorRegistry.editorBackground) || new Color(new RGBA(255, 255, 255, 1)));
        colors.textColor = toHex(this.themeService.getColorTheme().getColor(colorRegistry.editorForeground) || new Color(new RGBA(0, 0, 0, 1)));
        
        // Node colors
        colors.fileNodeTier1 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctFileNodeTier1) || new Color(new RGBA(78, 177, 203, 1)));
        colors.fileNodeTier2 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctFileNodeTier2) || new Color(new RGBA(68, 163, 188, 1)));
        colors.fileNodeTier3 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctFileNodeTier3) || new Color(new RGBA(58, 149, 173, 1)));
        colors.fileNodeTier4 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctFileNodeTier4) || new Color(new RGBA(48, 135, 158, 1)));
        colors.fileNodeTier5 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctFileNodeTier5) || new Color(new RGBA(38, 121, 143, 1)));
        
        colors.directoryNodeTier1 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctDirectoryNodeTier1) || new Color(new RGBA(208, 115, 72, 1)));
        colors.directoryNodeTier2 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctDirectoryNodeTier2) || new Color(new RGBA(193, 105, 65, 1)));
        colors.directoryNodeTier3 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctDirectoryNodeTier3) || new Color(new RGBA(179, 95, 58, 1)));
        colors.directoryNodeTier4 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctDirectoryNodeTier4) || new Color(new RGBA(165, 85, 51, 1)));
        colors.directoryNodeTier5 = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctDirectoryNodeTier5) || new Color(new RGBA(151, 75, 44, 1)));
        
        colors.groupNode = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctGroupNode) || new Color(new RGBA(128, 128, 255, 1)));
        colors.virtualNode = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctVirtualNode) || new Color(new RGBA(128, 128, 128, 1)));
        
        // Edge colors
        colors.importEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctImportEdge) || new Color(new RGBA(124, 204, 124, 1)));
        colors.referenceEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctReferenceEdge) || new Color(new RGBA(136, 170, 221, 1)));
        colors.extendsEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctExtendsEdge) || new Color(new RGBA(204, 170, 68, 1)));
        colors.implementsEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctImplementsEdge) || new Color(new RGBA(221, 136, 204, 1)));
        colors.typeDependencyEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctTypeDependencyEdge) || new Color(new RGBA(204, 119, 170, 1)));
        colors.fileInclusionEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctFileInclusionEdge) || new Color(new RGBA(221, 153, 102, 1)));
        colors.packageDependencyEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctPackageDependencyEdge) || new Color(new RGBA(153, 204, 102, 1)));
        colors.apiCallEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctApiCallEdge) || new Color(new RGBA(102, 204, 204, 1)));
        colors.eventEmitterEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctEventEmitterEdge) || new Color(new RGBA(204, 204, 102, 1)));
        colors.eventHandlerEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctEventHandlerEdge) || new Color(new RGBA(204, 102, 204, 1)));
        
        colors.directEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctDirectEdge) || new Color(new RGBA(136, 170, 136, 1)));
        colors.indirectEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctIndirectEdge) || new Color(new RGBA(170, 170, 170, 1)));
        colors.bidirectionalEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctBidirectionalEdge) || new Color(new RGBA(221, 136, 136, 1)));
        colors.virtualEdge = toHex(this.themeService.getColorTheme().getColor(colorRegistry.crctVirtualEdge) || new Color(new RGBA(136, 136, 136, 1)));
        
        return colors;
    }
    
    // Helper functions for converting CRCT data to graph data
    
    public async createGraphDataFromKey(key: KeyInfo): Promise<GraphData> {
        // Convert CRCT data to the format needed for graph visualization
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        
        // Add the main node
        nodes.push({
            id: key.keyString,
            label: basename(VSCodeURI.parse(key.normPath)),
            type: key.isDirectory ? 'directory' : 'file',
            path: key.normPath,
            tier: key.tier
        });
        
        // Get dependencies
        const dependencies = await this.crctService.getDependencies(key.keyString);
        
        // Process dependencies and dependents
        await this.processDependencies(key, dependencies, nodes, edges);
        
        return {
            nodes,
            edges,
            selected: key.keyString
        };
    }
    
    private async processDependencies(
        key: KeyInfo,
        dependencies: DependencyInfo,
        nodes: GraphNode[],
        edges: GraphEdge[]
    ): Promise<void> {
        const processPromises: Promise<void>[] = [];
        
        // Process dependencies (outgoing edges)
        for (const dep of dependencies.dependencies) {
            processPromises.push(this.processDependencyNode(key.keyString, dep, 'outgoing', nodes, edges));
        }
        
        // Process dependents (incoming edges)
        for (const dep of dependencies.dependents) {
            processPromises.push(this.processDependencyNode(key.keyString, dep, 'incoming', nodes, edges));
        }
        
        await Promise.all(processPromises);
    }
    
    private async processDependencyNode(
        sourceKey: string,
        dep: { key: string; type: DependencyType; strength: number },
        direction: 'incoming' | 'outgoing',
        nodes: GraphNode[],
        edges: GraphEdge[]
    ): Promise<void> {
        const depKey = await this.crctService.keyManager.getKeyForString(dep.key);
        if (!depKey) return;
        
        // Add node if it doesn't exist
        if (!nodes.some(n => n.id === dep.key)) {
            nodes.push({
                id: dep.key,
                label: basename(VSCodeURI.parse(depKey.normPath)),
                type: depKey.isDirectory ? 'directory' : 'file',
                path: depKey.normPath,
                tier: depKey.tier
            });
        }
        
        // Add edge with correct direction
        edges.push({
            source: direction === 'outgoing' ? sourceKey : dep.key,
            target: direction === 'outgoing' ? dep.key : sourceKey,
            type: dep.type,
            strength: dep.strength
        });
    }
    
    public async createFullGraphData(): Promise<GraphData> {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        
        // Get all keys
        const keys = await this.crctService.keyManager.getAllKeys();
        
        // Add nodes for all keys
        for (const key of keys) {
            nodes.push({
                id: key.keyString,
                label: basename(VSCodeURI.parse(key.normPath)),
                type: key.isDirectory ? 'directory' : 'file',
                path: key.normPath,
                tier: key.tier
            });
        }
        
        // Get all dependencies
        const allDependencies = await this.crctService.getAllDependencies();
        
        // Add edges for all dependencies
        for (const dep of allDependencies) {
            edges.push({
                source: dep.sourceKey,
                target: dep.targetKey,
                type: dep.type,
                strength: dep.strength
            });
        }
        
        return { nodes, edges };
    }
}

// Helper class for RGBA colors
class RGBA {
    constructor(public r: number, public g: number, public b: number, public a: number) {}
}