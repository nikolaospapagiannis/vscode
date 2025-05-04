/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBatchProcessor } from '../types';
import { localize } from 'vs/nls';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';

/**
 * Batch Processor implementation for TypeScript
 * Processes items in parallel batches with progress reporting
 */
export class BatchProcessor extends Disposable implements IBatchProcessor {
	private readonly maxWorkers: number;
	private readonly batchSize: number | undefined;
	private readonly showProgress: boolean;
	
	private totalItems = 0;
	private processedItems = 0;
	private startTime = 0;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IProgressService private readonly progressService: IProgressService,
		maxWorkers?: number,
		batchSize?: number,
		showProgress: boolean = true
	) {
		super();
		
		// Calculate max workers based on available CPUs
		const cpuCount = navigator.hardwareConcurrency || 4;
		this.maxWorkers = Math.max(1, maxWorkers || Math.min(32, cpuCount * 2));
		this.batchSize = batchSize;
		this.showProgress = showProgress;
	}

	/**
	 * Process a list of items in parallel batches
	 */
	async processItems<T, R>(
		items: T[],
		processorFunc: (item: T, ...args: any[]) => Promise<R>,
		...args: any[]
	): Promise<R[]> {
		if (typeof processorFunc !== 'function') {
			this.logService.error('BatchProcessor: processorFunc must be a function');
			throw new Error(localize('batchProcessor.invalidProcessor', "processorFunc must be a function"));
		}

		this.totalItems = items.length;
		if (this.totalItems === 0) {
			this.logService.info('BatchProcessor: No items to process');
			return [];
		}

		this.processedItems = 0;
		this.startTime = Date.now();

		const actualBatchSize = this.determineBatchSize();
		this.logService.info(`BatchProcessor: Processing ${this.totalItems} items with batch size: ${actualBatchSize}, workers: ${this.maxWorkers}`);

		// Create a results array pre-filled with undefined to maintain order
		const results: (R | undefined)[] = new Array(this.totalItems).fill(undefined);
		let itemsProcessed = 0;

		// Progress reporting
		const progressTitle = localize('batchProcessor.processingItems', "Processing items");
		const progress = this.showProgress ? 
			this.progressService.withProgress({
				location: ProgressLocation.Notification,
				title: progressTitle,
				cancellable: true
			}, (progress, token) => {
				// Return a promise that resolves when all processing is done
				return new Promise<void>(resolve => {
					// Store the resolve function for later
					this._register({ dispose: () => resolve() });
					
					// Report initial progress
					progress.report({ 
						message: localize('batchProcessor.initializing', "Initializing..."),
						increment: 0 
					});

					// Cancel token handling
					if (token.isCancellationRequested) {
						resolve();
					}
					token.onCancellationRequested(() => resolve());
				});
			}) : undefined;

		try {
			// Process items in batches
			for (let i = 0; i < this.totalItems; i += actualBatchSize) {
				// Extract batch
				const batchIndices = Array.from(
					{ length: Math.min(actualBatchSize, this.totalItems - i) },
					(_, idx) => i + idx
				);
				const batchItems = batchIndices.map(idx => items[idx]);

				if (batchItems.length === 0) continue;

				// Process this batch
				const batchResultsMap = await this.processBatch(
					batchItems, batchIndices, processorFunc, progress?.token || CancellationToken.None, 
					...args
				);

				// Place results back into main array
				for (const [batchIdx, originalIdx] of batchIndices.entries()) {
					if (batchResultsMap.has(batchIdx)) {
						results[originalIdx] = batchResultsMap.get(batchIdx);
					}
				}

				itemsProcessed += batchItems.length;
				this.processedItems = itemsProcessed;

				// Update progress
				if (progress && this.showProgress) {
					const progressIncrement = (batchItems.length / this.totalItems) * 100;
					const progressPercent = (itemsProcessed / this.totalItems) * 100;
					const elapsedSec = (Date.now() - this.startTime) / 1000;
					const itemsPerSecond = itemsProcessed / Math.max(0.1, elapsedSec);
					const remainingItems = this.totalItems - itemsProcessed;
					const etaSeconds = itemsPerSecond > 0 ? remainingItems / itemsPerSecond : 0;
					
					let etaMessage = '';
					if (etaSeconds > 3600) {
						etaMessage = localize('batchProcessor.etaHours', "{0} hours remaining", (etaSeconds / 3600).toFixed(1));
					} else if (etaSeconds > 60) {
						etaMessage = localize('batchProcessor.etaMinutes', "{0} minutes remaining", (etaSeconds / 60).toFixed(1));
					} else {
						etaMessage = localize('batchProcessor.etaSeconds', "{0} seconds remaining", etaSeconds.toFixed(0));
					}

					progress.report({
						increment: progressIncrement,
						message: localize(
							'batchProcessor.progress', 
							"{0}/{1} ({2}%) at {3} items/sec - {4}",
							itemsProcessed,
							this.totalItems,
							progressPercent.toFixed(1),
							itemsPerSecond.toFixed(1),
							etaMessage
						)
					});
				}

				// Check for cancellation
				if (progress?.token.isCancellationRequested) {
					this.logService.info('BatchProcessor: Processing cancelled by user');
					break;
				}
			}
		} finally {
			// Clean up progress
			if (progress) {
				progress.report({ increment: 100, message: localize('batchProcessor.complete', "Complete") });
			}
		}

		const finalTime = (Date.now() - this.startTime) / 1000;
		this.logService.info(`BatchProcessor: Processed ${itemsProcessed}/${this.totalItems} items in ${finalTime.toFixed(2)} seconds`);

		// Filter out undefined values from failed processing
		const successfulResults = results.filter((r): r is R => r !== undefined);
		if (successfulResults.length !== results.length) {
			this.logService.warning(
				localize(
					'batchProcessor.incompleteResults',
					"Some items failed processing ({0} errors). Results list contains only successful items.",
					results.length - successfulResults.length
				)
			);
		}

		return successfulResults;
	}

	/**
	 * Process items and collect results with a collector function
	 */
	async processWithCollector<T, R, C>(
		items: T[],
		processorFunc: (item: T, ...args: any[]) => Promise<R>,
		collectorFunc: (results: R[]) => C,
		...args: any[]
	): Promise<C> {
		// Process all items
		const allResults = await this.processItems(items, processorFunc, ...args);
		
		// Call collector function with all results
		this.logService.info('BatchProcessor: Calling collector function with all results');
		return collectorFunc(allResults);
	}

	/**
	 * Determine the optimal batch size based on total items and available workers
	 */
	private determineBatchSize(): number {
		// If explicitly set, use the provided batch size
		if (this.batchSize !== undefined) {
			return Math.max(1, this.batchSize);
		}

		// Adaptive sizing
		if (this.totalItems === 0) return 1;

		const effectiveWorkers = Math.max(1, this.maxWorkers);
		const minSensibleBatch = 4;

		// For very small item counts, adjust batch size
		if (this.totalItems < effectiveWorkers * minSensibleBatch) {
			return Math.max(1, Math.ceil(this.totalItems / effectiveWorkers));
		}

		// Aim for a reasonable number of batches per worker
		const targetBatchesPerWorker = 5;
		const denominator = effectiveWorkers * targetBatchesPerWorker;
		const calculatedBatchSize = Math.max(1, Math.ceil(this.totalItems / denominator));

		// Define a max batch size to avoid huge batches
		const maxSensibleBatch = 100;
		const maxBatch = Math.min(this.totalItems, maxSensibleBatch);

		// Combine calculations within min/max bounds
		const finalBatchSize = Math.min(maxBatch, Math.max(minSensibleBatch, calculatedBatchSize));

		const numBatches = Math.ceil(this.totalItems / finalBatchSize);
		this.logService.debug(
			`BatchProcessor: Adaptive sizing - Total: ${this.totalItems}, Workers: ${effectiveWorkers}, ` +
			`Target: ${targetBatchesPerWorker}, Calculated: ${calculatedBatchSize}, ` +
			`Final: ${finalBatchSize}, Batches: ${numBatches}`
		);

		return finalBatchSize;
	}

	/**
	 * Process a single batch of items with parallel promises
	 */
	private async processBatch<T, R>(
		batch: T[],
		batchIndices: number[],
		processorFunc: (item: T, ...args: any[]) => Promise<R>,
		cancellationToken: CancellationToken,
		...args: any[]
	): Promise<Map<number, R>> {
		if (batch.length === 0) {
			return new Map();
		}

		const batchResults = new Map<number, R>();
		const effectiveWorkers = Math.min(this.maxWorkers, batch.length);
		
		// Create a queue of work
		const queue = batch.map((item, index) => ({ item, index }));
		const promises: Promise<void>[] = [];
		const tokenSource = new CancellationTokenSource(cancellationToken);

		// Process queue with limited workers
		for (let i = 0; i < effectiveWorkers; i++) {
			// Each worker processes items from the queue until it's empty
			const workerPromise = (async () => {
				while (queue.length > 0 && !tokenSource.token.isCancellationRequested) {
					const { item, index } = queue.shift()!;
					const originalIndex = batchIndices[index];
					
					try {
						const result = await processorFunc(item, ...args);
						batchResults.set(index, result);
					} catch (error) {
						// Log error but continue processing
						const itemStr = typeof item === 'object' ? JSON.stringify(item).substring(0, 100) : String(item);
						this.logService.error(
							localize(
								'batchProcessor.itemError',
								"Error processing item at index {0}: {1} - {2}",
								originalIndex,
								itemStr,
								error
							)
						);
					}
				}
			})();
			
			promises.push(workerPromise);
		}

		// Wait for all workers to complete
		await Promise.all(promises);
		tokenSource.dispose();
		
		return batchResults;
	}
}