/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { AIMessage, AIProviderAuthStatus, AIProviderConfig, AIProviderInfo, AIRequestOptions, AIResponse, IAIProvider } from './types';

/**
 * Base abstract class for AI providers
 */
export abstract class BaseAIProvider extends Disposable implements IAIProvider {
	private readonly _onDidChangeStatus = this._register(new Emitter<void>());
	readonly onDidChangeStatus = this._onDidChangeStatus.event;

	protected _info: AIProviderInfo;

	/**
	 * Create a new base AI provider
	 * @param info Initial provider information
	 */
	constructor(info: AIProviderInfo) {
		super();
		this._info = info;
	}

	/**
	 * Get the provider info
	 */
	get info(): AIProviderInfo {
		return this._info;
	}

	/**
	 * Initialize the provider
	 * @param config Provider configuration
	 */
	async initialize(config: AIProviderConfig): Promise<void> {
		try {
			// Update status to indicate initialization is in progress
			this.updateStatus('unauthenticated');

			// Call provider-specific initialization
			await this.initializeImplementation(config);

			// If we got here, initialization succeeded
			this.updateStatus('authenticated');
		} catch (error) {
			// If initialization failed, update status to error
			this.updateStatus('error');

			// Re-throw the error
			throw error;
		}
	}

	/**
	 * Update the provider status
	 * @param status New authentication status
	 */
	protected updateStatus(status: AIProviderAuthStatus): void {
		if (this._info.authStatus !== status) {
			this._info = { ...this._info, authStatus: status };
			this._onDidChangeStatus.fire();
		}
	}

	/**
	 * Provider-specific implementation of initialization
	 * @param config Provider configuration
	 */
	protected abstract initializeImplementation(config: AIProviderConfig): Promise<void>;

	/**
	 * Send a request to the provider
	 * @param messages Messages to send
	 * @param options Request options
	 * @param token Cancellation token
	 */
	abstract sendRequest(messages: AIMessage[], options?: AIRequestOptions, token?: CancellationToken): Promise<AIResponse>;

	/**
	 * Count tokens in a message or text
	 * @param value Message or text to count tokens for
	 * @param token Cancellation token
	 */
	abstract countTokens(value: string | AIMessage[], token?: CancellationToken): Promise<number>;

	/**
	 * Dispose resources
	 */
	override dispose(): void {
		super.dispose();
	}
}
