/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { ICRCTService } from './types';
import { AIMessageContent, AIMessageRole, AIProviderAuthStatus, AIProviderConfig, AIProviderInfo, AIProviderType, AIRequestOptions, AIResponse, AIResponseFragment, AIResponsePart, IAIProvider, AIMessage, AIModelCapabilities, AIModelInfo, PricingTier } from '../aiProviders/types';
import { Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { VSBuffer } from 'vs/base/common/buffer';
import { localize } from 'vs/nls';
import { Schemas } from 'vs/base/common/network';

// CRCT Provider Constants
const CRCT_PROVIDER_ID = 'crct';
const CRCT_PROVIDER_NAME = 'Recursive Chain-of-Thought';
const CRCT_MODEL_ID = 'crct-v1';
const CRCT_MODEL_NAME = 'CRCT System v1.0';
const CRCT_MAX_CONTEXT_LENGTH = 100000;
const CRCT_MAX_RESPONSE_TOKENS = 8000;

/**
 * Implementation of CRCT as an AI Provider for VS Code
 */
export class CRCTProvider extends Disposable implements IAIProvider {
	private _onDidChangeStatus = new Emitter<void>();
	readonly onDidChangeStatus = this._onDidChangeStatus.event;
	
	private _authStatus: AIProviderAuthStatus = 'unauthenticated';
	private _isEnabled: boolean = false;
	private _workspaceRoot: URI | undefined;
	
	private _info: AIProviderInfo;
	
	constructor(
		private readonly crctService: ICRCTService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		
		// Create provider info
		this._info = {
			id: CRCT_PROVIDER_ID,
			name: CRCT_PROVIDER_NAME,
			type: AIProviderType.Custom,
			availableModels: [this.createModelInfo()],
			iconPath: 'crct-icon.png',
			isEnabled: this._isEnabled,
			authStatus: this._authStatus
		};
	}

	/**
	 * Provider information
	 */
	get info(): AIProviderInfo {
		return this._info;
	}

	/**
	 * Create model info with capabilities
	 */
	private createModelInfo(): AIModelInfo {
		return {
			id: CRCT_MODEL_ID,
			name: CRCT_MODEL_NAME,
			capabilities: {
				supportsImages: false,
				supportsToolCalling: false,
				supportsStreaming: true
			},
			maxContextLength: CRCT_MAX_CONTEXT_LENGTH,
			maxResponseTokens: CRCT_MAX_RESPONSE_TOKENS,
			pricingTier: 'free' as PricingTier
		};
	}

	/**
	 * Initialize the provider with configuration
	 */
	async initialize(config: AIProviderConfig): Promise<void> {
		try {
			this.logService.info('CRCTProvider: Initializing');
			
			// Extract workspace root
			if (config.customOptions?.workspaceRoot) {
				const workspacePath = config.customOptions.workspaceRoot as string;
				this._workspaceRoot = URI.parse(workspacePath);
				
				// Initialize CRCT service
				await this.crctService.initialize(this._workspaceRoot);
				
				this._authStatus = 'authenticated';
				this._isEnabled = true;
				
				// Update provider info
				this._info = {
					...this._info,
					authStatus: this._authStatus,
					isEnabled: this._isEnabled
				};
				
				this._onDidChangeStatus.fire();
				this.logService.info('CRCTProvider: Initialized successfully');
			} else {
				throw new Error(localize('crctProvider.noWorkspaceRoot', "No workspace root provided in configuration"));
			}
		} catch (error) {
			this._authStatus = 'error';
			this._isEnabled = false;
			this._info = {
				...this._info,
				authStatus: this._authStatus,
				isEnabled: this._isEnabled
			};
			
			this._onDidChangeStatus.fire();
			this.logService.error(`CRCTProvider: Initialization failed: ${error}`);
			throw error;
		}
	}

	/**
	 * Send a request to the CRCT provider
	 */
	async sendRequest(messages: AIMessage[], options?: AIRequestOptions, token?: CancellationToken): Promise<AIResponse> {
		if (!this._workspaceRoot || !this._isEnabled) {
			throw new Error(localize('crctProvider.notInitialized', "CRCT provider not initialized"));
		}
		
		// Create a cancellation token if none is provided
		const cts = new CancellationTokenSource(token);
		const localToken = cts.token;
		
		// Extract the most recent user message
		const userMessage = messages.findLast(m => m.role === 'user');
		if (!userMessage) {
			throw new Error(localize('crctProvider.noUserMessage', "No user message found in request"));
		}
		
		const messageText = this.getMessageText(userMessage);
		
		// Setting up the async iterator and result promise
		let responseResolver: () => void;
		let responseRejecter: (error: Error) => void;
		const responsePromise = new Promise<void>((resolve, reject) => {
			responseResolver = resolve;
			responseRejecter = reject;
		});
		
		// Process the response parts
		let responseIndex = 0;
		
		// Create an async iterable for the response
		const responseStream = {
			[Symbol.asyncIterator]() {
				return {
					next: async (): Promise<IteratorResult<AIResponseFragment>> => {
						if (localToken.isCancellationRequested) {
							responseResolver();
							return { done: true, value: undefined };
						}
						
						try {
							// Process based on command
							if (messageText.trim().toLowerCase() === 'start.') {
								// Initialize CRCT
								await this.handleStartCommand(
									async (part) => {
										responseIndex++;
										return { 
											done: false, 
											value: { 
												index: responseIndex, 
												part 
											} 
										};
									},
									localToken
								);
							} else if (
								messageText.toLowerCase().includes('analyze') && 
								messageText.toLowerCase().includes('workspace')
							) {
								// Analyze workspace
								await this.handleAnalyzeCommand(
									async (part) => {
										responseIndex++;
										return { 
											done: false, 
											value: { 
												index: responseIndex, 
												part 
											} 
										};
									},
									localToken
								);
							} else {
								// Just return the active context for other messages
								await this.handleDefaultCommand(
									async (part) => {
										responseIndex++;
										return { 
											done: false, 
											value: { 
												index: responseIndex, 
												part 
											} 
										};
									},
									localToken
								);
							}
							
							// Signal completion
							responseResolver();
							return { done: true, value: undefined };
						} catch (error) {
							this.logService.error(`CRCTProvider: Error processing request: ${error}`);
							responseRejecter(error instanceof Error ? error : new Error(String(error)));
							return { done: true, value: undefined };
						}
					}
				};
			}
		};
		
		return {
			stream: responseStream,
			result: responsePromise
		};
	}

	/**
	 * Handle the "start" command
	 */
	private async handleStartCommand(
		yieldResult: (part: AIResponsePart) => Promise<IteratorResult<AIResponseFragment>>,
		token: CancellationToken
	): Promise<void> {
		// Initial response
		await yieldResult({ 
			type: 'text', 
			value: 'Initializing CRCT system...\n\n'
		});
		
		if (token.isCancellationRequested) {
			return;
		}
		
		try {
			// Switch to SETUP phase if needed
			const currentPhase = this.crctService.currentPhase;
			if (currentPhase !== 'setup') {
				await yieldResult({ 
					type: 'text', 
					value: `Switching from ${currentPhase} phase to setup phase...\n`
				});
				
				await this.crctService.changePhase('setup');
			}
			
			// Get active context
			const activeContext = await this.crctService.getActiveContext();
			
			await yieldResult({ 
				type: 'text', 
				value: 'CRCT system initialized successfully. Current active context:\n\n```md\n' + activeContext + '\n```\n\n'
			});
			
			await yieldResult({ 
				type: 'text', 
				value: 'To analyze your workspace, reply with "Analyze workspace" or "Perform initial setup".'
			});
		} catch (error) {
			await yieldResult({ 
				type: 'text', 
				value: `Error initializing CRCT: ${error}\n\nPlease try again.`
			});
		}
	}

	/**
	 * Handle the analyze workspace command
	 */
	private async handleAnalyzeCommand(
		yieldResult: (part: AIResponsePart) => Promise<IteratorResult<AIResponseFragment>>,
		token: CancellationToken
	): Promise<void> {
		await yieldResult({ 
			type: 'text', 
			value: 'Starting workspace analysis...\n\n'
		});
		
		if (token.isCancellationRequested) {
			return;
		}
		
		try {
			// Analyze workspace
			await yieldResult({ 
				type: 'text', 
				value: 'Scanning files and generating dependency information...\n'
			});
			
			await this.crctService.analyzeWorkspace(false, false);
			
			// Progress updates would happen in the UI through the progress service
			
			await yieldResult({ 
				type: 'text', 
				value: 'Workspace analysis complete.\n\n'
			});
			
			// Get updated active context
			const activeContext = await this.crctService.getActiveContext();
			
			await yieldResult({ 
				type: 'text', 
				value: 'Updated active context:\n\n```md\n' + activeContext + '\n```\n\n'
			});
			
			// Execute MUP
			await yieldResult({ 
				type: 'text', 
				value: 'Executing Mandatory Update Protocol (MUP)...\n'
			});
			
			await this.crctService.executeMUP();
			
			await yieldResult({ 
				type: 'text', 
				value: 'MUP completed. The system is ready for further operations.\n\n'
			});
		} catch (error) {
			await yieldResult({ 
				type: 'text', 
				value: `Error during workspace analysis: ${error}\n\nPlease try again.`
			});
		}
	}

	/**
	 * Handle default commands with active context
	 */
	private async handleDefaultCommand(
		yieldResult: (part: AIResponsePart) => Promise<IteratorResult<AIResponseFragment>>,
		token: CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}
		
		try {
			// Get current phase and active context
			const currentPhase = this.crctService.currentPhase;
			const activeContext = await this.crctService.getActiveContext();
			
			await yieldResult({ 
				type: 'text', 
				value: `Current CRCT phase: ${currentPhase}\n\nActive context:\n\n```md\n${activeContext}\n```\n\n`
			});
			
			await yieldResult({ 
				type: 'text', 
				value: 'To perform specific CRCT operations, try commands like:\n\n' +
					'- "Analyze workspace"\n' +
					'- "Change phase to strategy"\n' +
					'- "Show dependencies for [key]"\n'
			});
		} catch (error) {
			await yieldResult({ 
				type: 'text', 
				value: `Error retrieving CRCT information: ${error}\n\nPlease try again.`
			});
		}
	}

	/**
	 * Extract text content from a message
	 */
	private getMessageText(message: AIMessage): string {
		const textContents = message.content
			.filter(content => content.type === 'text')
			.map(content => (content as { type: 'text'; value: string }).value);
		
		return textContents.join('\n');
	}

	/**
	 * Count tokens in a message or text
	 */
	async countTokens(value: string | AIMessage[], token?: CancellationToken): Promise<number> {
		// Implementation of token counting
		// This is a naive implementation - for a real system, use a proper tokenizer
		
		if (Array.isArray(value)) {
			// Count tokens in messages
			let totalTokens = 0;
			for (const message of value) {
				const textContent = message.content
					.filter(content => content.type === 'text')
					.map(content => (content as { type: 'text'; value: string }).value)
					.join('\n');
				
				totalTokens += Math.ceil(textContent.length / 4); // Naive estimation
			}
			return totalTokens;
		} else {
			// Count tokens in a string
			return Math.ceil(value.length / 4); // Naive estimation
		}
	}
}