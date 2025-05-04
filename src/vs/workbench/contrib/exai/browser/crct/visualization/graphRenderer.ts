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
import { KeyInfo, DependencyType } from 'vs/workbench/contrib/exai/common/crct/types';
import { isAbsolute } from 'vs/base/common/path';
import { URI as VSCodeURI } from 'vscode-uri';
import { basename } from 'vs/base/common/resources';

// Interfaces for graph data
export interface GraphNode {
    id: string;
    label: string;
    type: 'file' | 'directory';
    path: string;
    tier: number;
}

export interface GraphEdge {
    source: string;
    target: string;
    type: DependencyType;
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
    
    private readonly _onNodeClick = this._register(new Emitter<string>());
    public readonly onNodeClick: Event<string> = this._onNodeClick.event;
    
    private readonly _onNodeDoubleClick = this._register(new Emitter<string>());
    public readonly onNodeDoubleClick: Event<string> = this._onNodeDoubleClick.event;
    
    constructor(
        container: HTMLElement,
        @IWebviewService webviewService: IWebviewService,
        @ICRCTService private readonly crctService: ICRCTService,
        @IFileService private readonly fileService: IFileService
    ) {
        super();
        
        // Create WebView
        this.webview = this._register(webviewService.createWebviewOverlay(this.getWebviewOptions(), {}));
        this.webview.mountTo(container);
        
        // Initialize the WebView with HTML content
        this.webview.html = this.getHtmlForWebview();
        
        // Handle messages from WebView
        this.disposables.add(this.webview.onMessage(message => {
            this.handleWebviewMessage(message);
        }));
    }
    
    private getWebviewOptions(): WebviewOptions {
        return {
            enableScripts: true,
            localResourceRoots: []
        };
    }
    
    private getHtmlForWebview(): string {
        // This would return the HTML template for rendering the graph
        // In a real implementation, this would include:
        // - D3.js or other graph visualization library
        // - CSS for styling
        // - JavaScript for interactions
        
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
                }
                
                #graph-container {
                    width: 100%;
                    height: 100%;
                    background-color: var(--vscode-editor-background);
                }
                
                .node {
                    cursor: pointer;
                }
                
                .node text {
                    font-family: var(--vscode-font-family);
                    font-size: 12px;
                    fill: var(--vscode-editor-foreground);
                }
                
                .link {
                    stroke-opacity: 0.6;
                }
                
                .selected {
                    stroke: var(--vscode-focusBorder);
                    stroke-width: 2px;
                }
            </style>
        </head>
        <body>
            <div id="graph-container"></div>
            
            <script>
                // This would be the client-side JavaScript for rendering the graph
                // In a real implementation, this would:
                // 1. Set up the visualization (e.g., using D3.js)
                // 2. Handle graph interactions
                // 3. Communicate with VS Code extension
                
                const vscode = acquireVsCodeApi();
                
                function renderGraph(data) {
                    // This would render the graph using data received from the extension
                    console.log('Rendering graph with data:', data);
                    
                    // For now, just log the data and tell the extension we're ready
                    vscode.postMessage({
                        type: 'graphRendered'
                    });
                }
                
                // Listen for messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.type) {
                        case 'updateGraph':
                            renderGraph(message.data);
                            break;
                    }
                });
                
                // Tell the extension we're ready
                vscode.postMessage({
                    type: 'ready'
                });
            </script>
        </body>
        </html>`;
    }
    
    private handleWebviewMessage(message: any): void {
        switch (message.type) {
            case 'ready':
                // WebView is ready to receive data
                break;
                
            case 'nodeClick':
                // User clicked on a node
                this._onNodeClick.fire(message.nodeId);
                break;
                
            case 'nodeDoubleClick':
                // User double-clicked on a node
                this._onNodeDoubleClick.fire(message.nodeId);
                break;
        }
    }
    
    // Public API for updating the graph
    
    public updateGraph(data: GraphData): void {
        this.webview.postMessage({
            type: 'updateGraph',
            data
        });
    }
    
    public highlightNode(nodeId: string): void {
        this.webview.postMessage({
            type: 'highlightNode',
            nodeId
        });
    }
    
    public centerOnNode(nodeId: string): void {
        this.webview.postMessage({
            type: 'centerOnNode',
            nodeId
        });
    }
    
    // Helper functions for converting CRCT data to graph data
    
    public async createGraphDataFromKey(key: KeyInfo): Promise<GraphData> {
        // This would convert CRCT data to the format needed for the graph visualization
        
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
        
        // Add dependency nodes and edges
        for (const dep of dependencies.dependencies) {
            const depKey = await this.crctService.keyManager.getKeyForString(dep.key);
            if (!depKey) continue;
            
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
            
            // Add edge
            edges.push({
                source: key.keyString,
                target: dep.key,
                type: dep.type,
                strength: dep.strength
            });
        }
        
        // Add dependent nodes and edges
        for (const dep of dependencies.dependents) {
            const depKey = await this.crctService.keyManager.getKeyForString(dep.key);
            if (!depKey) continue;
            
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
            
            // Add edge
            edges.push({
                source: dep.key,
                target: key.keyString,
                type: dep.type,
                strength: dep.strength
            });
        }
        
        return {
            nodes,
            edges,
            selected: key.keyString
        };
    }
}