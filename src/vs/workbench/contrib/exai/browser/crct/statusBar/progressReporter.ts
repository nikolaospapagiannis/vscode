/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { ICRCTService } from 'vs/workbench/contrib/exai/common/crct/types';
import { CancellationToken } from 'vs/base/common/cancellation';
import { localize } from 'vs/nls';

export class CRCTProgressReporter extends Disposable {
    constructor(
        @IProgressService private readonly progressService: IProgressService,
        @ICRCTService private readonly crctService: ICRCTService
    ) {
        super();
        
        this.registerListeners();
    }
    
    private registerListeners(): void {
        // Listen for analysis events
        this._register(this.crctService.onAnalysisStarted(() => {
            this.reportAnalysisProgress();
        }));
        
        // Listen for key generation events
        this._register(this.crctService.onKeyGenerationStarted(() => {
            this.reportKeyGenerationProgress();
        }));
        
        // Listen for grid update events
        this._register(this.crctService.onGridUpdateStarted(() => {
            this.reportGridUpdateProgress();
        }));
        
        // Listen for batch processing events
        this._register(this.crctService.batchProcessor.onBatchStarted(({ total }) => {
            this.reportBatchProgress(total);
        }));
    }
    
    private reportAnalysisProgress(): void {
        this.progressService.withProgress(
            {
                location: ProgressLocation.Notification,
                title: localize('analyzing.workspace', "Analyzing workspace dependencies..."),
                cancellable: true
            },
            async (progress, token) => {
                // Create a promise that resolves when analysis is complete
                return new Promise<void>((resolve) => {
                    const disposable = this.crctService.onAnalysisCompleted(() => {
                        disposable.dispose();
                        resolve();
                    });
                    
                    // Also resolve if cancelled
                    token.onCancellationRequested(() => {
                        disposable.dispose();
                        resolve();
                    });
                });
            }
        );
    }
    
    private reportKeyGenerationProgress(): void {
        this.progressService.withProgress(
            {
                location: ProgressLocation.Notification,
                title: localize('generating.keys', "Generating keys for workspace..."),
                cancellable: true
            },
            async (progress, token) => {
                // Create a promise that resolves when key generation is complete
                return new Promise<void>((resolve) => {
                    const disposable = this.crctService.onKeyGenerationCompleted(({ total }) => {
                        disposable.dispose();
                        resolve();
                    });
                    
                    // Also resolve if cancelled
                    token.onCancellationRequested(() => {
                        disposable.dispose();
                        resolve();
                    });
                });
            }
        );
    }
    
    private reportGridUpdateProgress(): void {
        this.progressService.withProgress(
            {
                location: ProgressLocation.Notification,
                title: localize('updating.grid', "Updating dependency grid..."),
                cancellable: true
            },
            async (progress, token) => {
                // Create a promise that resolves when grid update is complete
                return new Promise<void>((resolve) => {
                    const disposable = this.crctService.onGridUpdateCompleted(() => {
                        disposable.dispose();
                        resolve();
                    });
                    
                    // Also resolve if cancelled
                    token.onCancellationRequested(() => {
                        disposable.dispose();
                        resolve();
                    });
                });
            }
        );
    }
    
    private reportBatchProgress(totalItems: number): void {
        this.progressService.withProgress(
            {
                location: ProgressLocation.Notification,
                title: localize('processing.batch', "Processing batch operations..."),
                cancellable: true,
                total: totalItems
            },
            async (progress, token) => {
                let processed = 0;
                
                // Report progress as items are processed
                const progressDisposable = this.crctService.batchProcessor.onItemProcessed(() => {
                    processed++;
                    progress.report({ 
                        increment: 1, 
                        message: localize('items.processed', "{0} of {1} items processed", processed, totalItems) 
                    });
                });
                
                // Create a promise that resolves when batch processing is complete
                return new Promise<void>((resolve) => {
                    const completionDisposable = this.crctService.batchProcessor.onBatchCompleted(() => {
                        progressDisposable.dispose();
                        completionDisposable.dispose();
                        resolve();
                    });
                    
                    // Also resolve if cancelled
                    token.onCancellationRequested(() => {
                        progressDisposable.dispose();
                        completionDisposable.dispose();
                        resolve();
                    });
                });
            }
        );
    }
}