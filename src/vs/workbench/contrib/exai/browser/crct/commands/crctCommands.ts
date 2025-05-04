/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { ICRCTService } from 'vs/workbench/contrib/exai/common/crct/types';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { localize } from 'vs/nls';
import * as CommandConstants from './commandConstants';

export class CRCTCommandsContribution extends Disposable {
    constructor(
        @IInstantiationService private readonly instantiationService: IInstantiationService,
        @ICRCTService private readonly crctService: ICRCTService,
        @INotificationService private readonly notificationService: INotificationService,
        @IProgressService private readonly progressService: IProgressService,
        @IFileService private readonly fileService: IFileService,
        @IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
        @IQuickInputService private readonly quickInputService: IQuickInputService
    ) {
        super();

        this.registerCommands();
    }

    private registerCommands(): void {
        // Analyze workspace dependencies
        CommandsRegistry.registerCommand(CommandConstants.ANALYZE_WORKSPACE_COMMAND_ID, async () => {
            return this.progressService.withProgress(
                {
                    location: ProgressLocation.Notification,
                    title: localize('analyzing.workspace', "Analyzing workspace dependencies..."),
                    cancellable: true
                },
                async (progress, token) => {
                    try {
                        await this.crctService.analyzeWorkspace(false, false);
                        this.notificationService.info(localize('workspace.analyzed', "Workspace dependencies analyzed successfully."));
                    } catch (error) {
                        this.notificationService.error(localize('analyze.failed', "Failed to analyze workspace: {0}", error.message));
                    }
                }
            );
        });

        // Generate keys for workspace
        CommandsRegistry.registerCommand(CommandConstants.GENERATE_KEYS_COMMAND_ID, async () => {
            return this.progressService.withProgress(
                {
                    location: ProgressLocation.Notification,
                    title: localize('generating.keys', "Generating keys for workspace..."),
                    cancellable: true
                },
                async (progress, token) => {
                    try {
                        const rootFolders = this.workspaceService.getWorkspace().folders;
                        const rootPaths = rootFolders.map(folder => folder.uri.fsPath);
                        
                        // Ask for excluded directories and extensions
                        const excludedDirs = await this.getExcludedDirs();
                        const excludedExtensions = await this.getExcludedExtensions();
                        
                        if (token.isCancellationRequested) {
                            return;
                        }
                        
                        const result = await this.crctService.keyManager.generateKeys(rootPaths, excludedDirs, excludedExtensions);
                        this.notificationService.info(localize('keys.generated', "Generated {0} keys for workspace.", result.newKeys.length));
                    } catch (error) {
                        this.notificationService.error(localize('key.generation.failed', "Failed to generate keys: {0}", error.message));
                    }
                }
            );
        });

        // Update dependency grid
        CommandsRegistry.registerCommand(CommandConstants.UPDATE_DEPENDENCY_GRID_COMMAND_ID, async () => {
            return this.progressService.withProgress(
                {
                    location: ProgressLocation.Notification,
                    title: localize('updating.grid', "Updating dependency grid..."),
                    cancellable: true
                },
                async (progress, token) => {
                    try {
                        await this.crctService.dependencyGridManager.updateGrid();
                        this.notificationService.info(localize('grid.updated', "Dependency grid updated successfully."));
                    } catch (error) {
                        this.notificationService.error(localize('grid.update.failed', "Failed to update dependency grid: {0}", error.message));
                    }
                }
            );
        });

        // Show dependency graph
        CommandsRegistry.registerCommand(CommandConstants.SHOW_DEPENDENCY_GRAPH_COMMAND_ID, async () => {
            // This will be implemented when the visualization module is built
            this.notificationService.info(localize('graph.coming.soon', "Dependency graph visualization coming soon."));
        });

        // Configure CRCT settings
        CommandsRegistry.registerCommand(CommandConstants.CONFIGURE_SETTINGS_COMMAND_ID, async () => {
            // Open settings with CRCT section focused
            await CommandsRegistry.executeCommand('workbench.action.openSettings', 'crct');
        });

        // Manage trackers
        CommandsRegistry.registerCommand(CommandConstants.MANAGE_TRACKERS_COMMAND_ID, async () => {
            const trackerOptions: IQuickPickItem[] = [
                { label: 'View Main Tracker', description: 'View the main tracker file' },
                { label: 'View Doc Tracker', description: 'View the documentation tracker file' },
                { label: 'Regenerate Main Tracker', description: 'Regenerate the main tracker file' },
                { label: 'Regenerate Doc Tracker', description: 'Regenerate the documentation tracker file' },
                { label: 'Create Mini-Tracker', description: 'Create a new mini-tracker for a specific directory' }
            ];

            const selection = await this.quickInputService.pick(trackerOptions, { 
                placeHolder: 'Select a tracker management action' 
            });

            if (!selection) return;

            switch (selection.label) {
                case 'View Main Tracker':
                    // Open main tracker in editor
                    const mainTrackerPath = await this.crctService.trackerIO.getMainTrackerPath();
                    if (mainTrackerPath) {
                        await CommandsRegistry.executeCommand('vscode.open', URI.file(mainTrackerPath));
                    } else {
                        this.notificationService.warning('Main tracker file not found.');
                    }
                    break;
                    
                case 'View Doc Tracker':
                    // Open doc tracker in editor
                    const docTrackerPath = await this.crctService.trackerIO.getDocTrackerPath();
                    if (docTrackerPath) {
                        await CommandsRegistry.executeCommand('vscode.open', URI.file(docTrackerPath));
                    } else {
                        this.notificationService.warning('Doc tracker file not found.');
                    }
                    break;
                    
                case 'Regenerate Main Tracker':
                    await this.regenerateTracker('main');
                    break;
                    
                case 'Regenerate Doc Tracker':
                    await this.regenerateTracker('doc');
                    break;
                    
                case 'Create Mini-Tracker':
                    await this.createMiniTracker();
                    break;
            }
        });

        // View file dependencies
        CommandsRegistry.registerCommand(CommandConstants.VIEW_FILE_DEPENDENCIES_COMMAND_ID, async (resource: URI) => {
            if (!resource) {
                return this.notificationService.error('No file selected.');
            }

            try {
                const key = await this.crctService.keyManager.getKeyForPath(resource.fsPath);
                if (!key) {
                    return this.notificationService.warning(`No key found for ${resource.fsPath}`);
                }

                const dependencies = await this.crctService.getDependencies(key.keyString);
                // This will be expanded when the visualization module is built
                this.notificationService.info(`Found ${dependencies.dependents.length} dependents and ${dependencies.dependencies.length} dependencies for ${key.keyString}`);
            } catch (error) {
                this.notificationService.error(`Failed to get dependencies: ${error.message}`);
            }
        });

        // Additional context menu commands will be implemented here
    }

    private async getExcludedDirs(): Promise<Set<string> | undefined> {
        const input = await this.quickInputService.input({
            placeHolder: 'Enter directories to exclude (comma separated, leave empty for defaults)',
            prompt: 'Examples: node_modules, .git, dist'
        });

        if (!input) {
            return undefined;
        }

        return new Set(input.split(',').map(dir => dir.trim()));
    }

    private async getExcludedExtensions(): Promise<Set<string> | undefined> {
        const input = await this.quickInputService.input({
            placeHolder: 'Enter file extensions to exclude (comma separated, leave empty for defaults)',
            prompt: 'Examples: .jpg, .png, .svg'
        });

        if (!input) {
            return undefined;
        }

        return new Set(input.split(',').map(ext => ext.trim()));
    }

    private async regenerateTracker(type: 'main' | 'doc'): Promise<void> {
        return this.progressService.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Regenerating ${type} tracker...`,
                cancellable: true
            },
            async (progress, token) => {
                try {
                    if (type === 'main') {
                        await this.crctService.trackerIO.regenerateMainTracker();
                    } else {
                        await this.crctService.trackerIO.regenerateDocTracker();
                    }
                    this.notificationService.info(`${type.charAt(0).toUpperCase() + type.slice(1)} tracker regenerated successfully.`);
                } catch (error) {
                    this.notificationService.error(`Failed to regenerate ${type} tracker: ${error.message}`);
                }
            }
        );
    }

    private async createMiniTracker(): Promise<void> {
        // Show folder picker
        const rootFolders = this.workspaceService.getWorkspace().folders;
        const folderItems = rootFolders.map(folder => ({
            label: folder.name,
            description: folder.uri.fsPath,
            uri: folder.uri
        }));

        const selectedFolder = await this.quickInputService.pick(folderItems, {
            placeHolder: 'Select a folder for mini-tracker'
        });

        if (!selectedFolder) return;

        // Get mini-tracker name
        const trackerName = await this.quickInputService.input({
            placeHolder: 'Enter mini-tracker name',
            validateInput: (value) => {
                return value ? null : 'Name is required';
            }
        });

        if (!trackerName) return;

        // Create mini-tracker
        return this.progressService.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Creating mini-tracker: ${trackerName}...`,
                cancellable: true
            },
            async (progress, token) => {
                try {
                    await this.crctService.trackerIO.createMiniTracker(selectedFolder.uri.fsPath, trackerName);
                    this.notificationService.info(`Mini-tracker "${trackerName}" created successfully.`);
                } catch (error) {
                    this.notificationService.error(`Failed to create mini-tracker: ${error.message}`);
                }
            }
        );
    }
}