/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { NullLogService } from 'vs/platform/log/common/log';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { MultiProviderController } from 'vs/workbench/contrib/exai/common/aiProviders/multiProviderController';
import { AIProviderType, IAIProvider, AIMessage, AIProviderConfig, AIProviderInfo, AIResponse, AIMessageContent } from 'vs/workbench/contrib/exai/common/aiProviders/types';
import { AsyncIterableSource } from 'vs/base/common/async';
import { AIProviderFactory } from 'vs/workbench/contrib/exai/common/aiProviders/aiProviderFactory';
import { ProviderSelectionStrategy, ProviderErrorHandlingStrategy } from 'vs/workbench/contrib/exai/common/aiProviders/multiProviderManager';
import { ContextManagementService, IContextManagementService } from 'vs/workbench/contrib/exai/common/aiProviders/contextManagement';
import { TestEnvironmentService } from 'vs/workbench/test/browser/workbenchTestServices';
import { BaseAIProvider } from 'vs/workbench/contrib/exai/common/aiProviders/baseProvider';
import { Emitter } from 'vs/base/common/event';

/**
 * Mock AI provider for testing
 */
class MockAIProvider extends BaseAIProvider {
	private successRate: number;
	private responseDelay: number;
	private readonly _onDidRequest = new Emitter<{ messages: AIMessage[], options?: any }>();
	readonly onDidRequest = this._onDidRequest.event;

	constructor(id: string, successRate: number = 1.0, responseDelay: number = 0) {
		super({
			id,
			name: `Mock Provider ${id}`,
			type: AIProviderType.Custom,
			availableModels: [
				{
					id: 'mock-model',
					name: 'Mock Model',
					capabilities: {
						supportsImages: false,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 10000,
					maxResponseTokens: 2000,
					pricingTier: 'free'
				}
			],
			iconPath: 'mock-icon',
			isEnabled: true,
			authStatus: 'authenticated'
		});
		
		this.successRate = successRate;
		this.responseDelay = responseDelay;
	}

	async initializeImplementation(config: AIProviderConfig): Promise<void> {
		// Nothing to do
	}

	async sendRequest(messages: AIMessage[], options?: any, token?: CancellationToken): Promise<AIResponse> {
		// Emit request event
		this._onDidRequest.fire({ messages, options });

		// Create response stream
		const stream = new AsyncIterableSource<any>();
		
		// Simulate API response delay
		if (this.responseDelay > 0) {
			await new Promise(resolve => setTimeout(resolve, this.responseDelay));
		}
		
		// Check for cancellation
		if (token?.isCancellationRequested) {
			stream.error(new Error('Request cancelled'));
			return {
				stream: stream.asyncIterable,
				result: Promise.reject(new Error('Request cancelled'))
			};
		}
		
		// Simulate success or failure based on success rate
		if (Math.random() <= this.successRate) {
			// Success - emit a response
			stream.emitOne({
				index: 0,
				part: { 
					type: 'text', 
					value: `Response from ${this.info.id}`
				}
			});
			
			// Complete the stream
			stream.resolve();
			
			return {
				stream: stream.asyncIterable,
				result: Promise.resolve()
			};
		} else {
			// Failure - emit an error
			const error = new Error(`${this.info.id} request failed`);
			stream.error(error);
			
			return {
				stream: stream.asyncIterable,
				result: Promise.reject(error)
			};
		}
	}

	async countTokens(value: string | AIMessage[], token?: CancellationToken): Promise<number> {
		if (typeof value === 'string') {
			return Math.ceil(value.length / 4);
		} else {
			return value.reduce((sum, msg) => {
				let contentLength = 0;
				for (const content of msg.content) {
					if (content.type === 'text') {
						contentLength += content.value.length;
					}
				}
				return sum + Math.ceil(contentLength / 4);
			}, 0);
		}
	}

	/**
	 * Set the success rate for this provider
	 * @param rate New success rate (0.0 - 1.0)
	 */
	setSuccessRate(rate: number): void {
		this.successRate = Math.max(0, Math.min(1, rate));
	}

	/**
	 * Set the response delay for this provider
	 * @param delay Delay in milliseconds
	 */
	setResponseDelay(delay: number): void {
		this.responseDelay = Math.max(0, delay);
	}
}

/**
 * Mock configuration service for testing
 */
class MockConfigurationService extends TestConfigurationService {
	private readonly _config: any = {
		'exai.multiProvider': {
			enable: true,
			selectionStrategy: ProviderSelectionStrategy.RoundRobin,
			errorHandlingStrategy: ProviderErrorHandlingStrategy.Fallback,
			requestTimeoutMs: 30000,
			maxRetries: 2,
			providers: {}
		},
		'exai.multiProvider.contextManagement': {
			enabled: true,
			maxContextSize: 10000,
			strategy: 'adaptive',
			countSystemMessages: true,
			enableOptimization: true
		}
	};

	constructor() {
		super();
		this.setUserConfiguration('exai.multiProvider', this._config['exai.multiProvider']);
		this.setUserConfiguration('exai.multiProvider.contextManagement', this._config['exai.multiProvider.contextManagement']);
	}

	override getValue<T>(key: string): T {
		return key.split('.').reduce((obj, k) => obj?.[k], this._config) as unknown as T;
	}

	setMultiProviderConfig(config: any): void {
		this._config['exai.multiProvider'] = {
			...this._config['exai.multiProvider'],
			...config
		};
		this.setUserConfiguration('exai.multiProvider', this._config['exai.multiProvider']);
	}

	setContextManagementConfig(config: any): void {
		this._config['exai.multiProvider.contextManagement'] = {
			...this._config['exai.multiProvider.contextManagement'],
			...config
		};
		this.setUserConfiguration('exai.multiProvider.contextManagement', this._config['exai.multiProvider.contextManagement']);
	}
}

suite('Multi-Provider Framework', () => {
	let disposables: DisposableStore;
	let instantiationService: TestInstantiationService;
	let configService: MockConfigurationService;
	let logService: NullLogService;
	let controller: MultiProviderController;
	let contextService: ContextManagementService;
	
	// Mock providers
	let provider1: MockAIProvider;
	let provider2: MockAIProvider;
	let provider3: MockAIProvider;

	setup(() => {
		disposables = new DisposableStore();
		
		// Set up instantiation service
		instantiationService = new TestInstantiationService();
		
		// Set up services
		logService = new NullLogService();
		configService = new MockConfigurationService();
		
		instantiationService.stub(IConfigurationService, configService);
		instantiationService.stub(IWorkbenchEnvironmentService, TestEnvironmentService);
		
		// Set up the context management service
		contextService = new ContextManagementService(configService, logService);
		instantiationService.stub(IContextManagementService, contextService);
		
		// Create the controller
		controller = new MultiProviderController(configService, logService);
		
		// Create mock providers
		provider1 = new MockAIProvider('provider1', 1.0, 10);  // Fast, reliable
		provider2 = new MockAIProvider('provider2', 0.8, 50);  // Medium, less reliable
		provider3 = new MockAIProvider('provider3', 0.5, 100); // Slow, unreliable
		
		// Register providers with the controller
		controller.registerProvider(provider1);
		controller.registerProvider(provider2);
		controller.registerProvider(provider3);
		
		// Register context settings
		contextService.registerProviderSettings(provider1);
		contextService.registerProviderSettings(provider2);
		contextService.registerProviderSettings(provider3);
	});

	teardown(() => {
		disposables.dispose();
	});

	test('Controller should register providers correctly', async () => {
		const providers = controller.getActiveProviders();
		assert.strictEqual(providers.length, 3, 'Should have 3 active providers');
		assert.strictEqual(providers[0].info.id, 'provider1', 'First provider should be provider1');
		assert.strictEqual(providers[1].info.id, 'provider2', 'Second provider should be provider2');
		assert.strictEqual(providers[2].info.id, 'provider3', 'Third provider should be provider3');
	});

	test('RoundRobin selection strategy should rotate through providers', async () => {
		// Set the selection strategy to RoundRobin
		configService.setMultiProviderConfig({
			selectionStrategy: ProviderSelectionStrategy.RoundRobin
		});
		
		// Track used providers
		const usedProviders: string[] = [];
		
		// Create basic message for testing
		const message: AIMessage = {
			role: 'user',
			content: [{ type: 'text', value: 'Test message' }]
		};
		
		// Track which providers receive requests
		const disposable1 = provider1.onDidRequest(e => usedProviders.push('provider1'));
		const disposable2 = provider2.onDidRequest(e => usedProviders.push('provider2'));
		const disposable3 = provider3.onDidRequest(e => usedProviders.push('provider3'));
		
		// Make 3 requests - each should go to a different provider
		await controller.sendRequest([message]);
		await controller.sendRequest([message]);
		await controller.sendRequest([message]);
		
		// Should have used all 3 providers in sequence
		assert.deepStrictEqual(usedProviders, ['provider1', 'provider2', 'provider3']);
		
		disposable1.dispose();
		disposable2.dispose();
		disposable3.dispose();
	});

	test('Fallback error handling strategy should try another provider on failure', async () => {
		// Set the error handling strategy to Fallback
		configService.setMultiProviderConfig({
			selectionStrategy: ProviderSelectionStrategy.FirstAvailable,
			errorHandlingStrategy: ProviderErrorHandlingStrategy.Fallback
		});
		
		// Make the first provider always fail
		provider1.setSuccessRate(0);
		
		// Track which providers receive requests
		const usedProviders: string[] = [];
		const disposable1 = provider1.onDidRequest(e => usedProviders.push('provider1'));
		const disposable2 = provider2.onDidRequest(e => usedProviders.push('provider2'));
		
		// Create basic message for testing
		const message: AIMessage = {
			role: 'user',
			content: [{ type: 'text', value: 'Test message' }]
		};
		
		// Make a request - should try provider1, fail, then try provider2
		await controller.sendRequest([message]);
		
		// Should have tried both providers
		assert.deepStrictEqual(usedProviders, ['provider1', 'provider2']);
		
		disposable1.dispose();
		disposable2.dispose();
	});

	test('Context management should adapt to provider context size', async () => {
		// Set up different context sizes for providers
		contextService.updateProviderSettings('provider1', { maxContextSize: 5000 });
		contextService.updateProviderSettings('provider2', { maxContextSize: 10000 });
		
		// Add messages to the context
		// Each message is roughly 25 tokens
		for (let i = 0; i < 300; i++) {
			const message: AIMessage = {
				role: i % 2 === 0 ? 'user' : 'assistant',
				content: [{ 
					type: 'text', 
					value: `Message ${i} with enough text to make it around 25 tokens in estimation`
				}]
			};
			contextService.addMessage(message);
		}
		
		// Get messages for each provider
		const messages1 = contextService.getMessagesForProvider(provider1);
		const messages2 = contextService.getMessagesForProvider(provider2);
		
		// Provider1 should have fewer messages due to smaller context
		assert.ok(messages1.length < messages2.length, 'Provider1 should have fewer messages than Provider2');
		
		// Provider1 should have less than 5000 tokens
		const tokens1 = await provider1.countTokens(messages1);
		assert.ok(tokens1 <= 5000, `Provider1 should have <= 5000 tokens (got ${tokens1})`);
		
		// Provider2 should have less than 10000 tokens
		const tokens2 = await provider2.countTokens(messages2);
		assert.ok(tokens2 <= 10000, `Provider2 should have <= 10000 tokens (got ${tokens2})`);
	});

	test('Capability-based selection should choose appropriate provider', async () => {
		// Set the selection strategy to capability-based
		configService.setMultiProviderConfig({
			selectionStrategy: ProviderSelectionStrategy.CapabilityBased
		});
		
		// Create providers with different capabilities
		const imageProvider = new MockAIProvider('imageProvider');
		imageProvider.info.availableModels[0].capabilities.supportsImages = true;
		
		const toolProvider = new MockAIProvider('toolProvider');
		toolProvider.info.availableModels[0].capabilities.supportsToolCalling = true;
		
		// Register the new providers
		controller.registerProvider(imageProvider);
		controller.registerProvider(toolProvider);
		
		// Track which providers receive requests
		const usedProviders: string[] = [];
		const disposableImage = imageProvider.onDidRequest(e => usedProviders.push('imageProvider'));
		const disposableTool = toolProvider.onDidRequest(e => usedProviders.push('toolProvider'));
		
		// Test with image content
		const imageMessage: AIMessage = {
			role: 'user',
			content: [
				{ type: 'text', value: 'Describe this image' },
				{ 
					type: 'image', 
					value: {
						uri: { toString: () => 'image://test' },
						mimeType: 'image/jpeg'
					}
				}
			]
		};
		
		// Should select the image-capable provider
		await controller.sendRequest([imageMessage], {}, { 
			requiredCapabilities: { supportsImages: true } 
		});
		
		assert.strictEqual(usedProviders[0], 'imageProvider', 'Should have used the image provider');
		
		// Clear tracking
		usedProviders.length = 0;
		
		// Test with tool calling requirement
		const toolMessage: AIMessage = {
			role: 'user',
			content: [{ type: 'text', value: 'Call a function' }]
		};
		
		// Should select the tool-capable provider
		await controller.sendRequest([toolMessage], {}, {
			requiredCapabilities: { supportsToolCalling: true }
		});
		
		assert.strictEqual(usedProviders[0], 'toolProvider', 'Should have used the tool provider');
		
		disposableImage.dispose();
		disposableTool.dispose();
	});
});

suite('Context Management Service', () => {
	let disposables: DisposableStore;
	let configService: MockConfigurationService;
	let logService: NullLogService;
	let contextService: ContextManagementService;

	setup(() => {
		disposables = new DisposableStore();
		
		// Set up services
		logService = new NullLogService();
		configService = new MockConfigurationService();
		
		// Create the context management service
		contextService = new ContextManagementService(configService, logService);
	});

	teardown(() => {
		disposables.dispose();
	});

	test('Adding messages should update context correctly', () => {
		// Add a message
		const message: AIMessage = {
			role: 'user',
			content: [{ type: 'text', value: 'Test message' }]
		};
		
		contextService.addMessage(message);
		
		// Create a mock provider
		const provider: IAIProvider = {
			info: {
				id: 'test',
				name: 'Test Provider',
				type: AIProviderType.Custom,
				availableModels: [{
					id: 'test-model',
					name: 'Test Model',
					capabilities: {
						supportsImages: false,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 10000,
					maxResponseTokens: 2000,
					pricingTier: 'free'
				}],
				iconPath: 'test-icon',
				isEnabled: true,
				authStatus: 'authenticated'
			},
			onDidChangeStatus: new Emitter<void>().event,
			initialize: async () => {},
			sendRequest: async () => ({
				stream: (async function* () {})(),
				result: Promise.resolve()
			}),
			countTokens: async () => 10,
			dispose: () => {}
		};
		
		// Register provider settings
		contextService.registerProviderSettings(provider);
		
		// Get messages for the provider
		const messages = contextService.getMessagesForProvider(provider);
		
		// Should have the message we added
		assert.strictEqual(messages.length, 1, 'Should have 1 message');
		assert.strictEqual(messages[0].role, 'user', 'Message should have user role');
		assert.strictEqual(messages[0].content[0].type, 'text', 'Message should have text content');
		assert.strictEqual(messages[0].content[0].value, 'Test message', 'Message should have correct content');
	});

	test('Context management should properly implement sliding window', () => {
		// Set sliding window strategy
		configService.setContextManagementConfig({
			strategy: 'sliding',
			maxContextSize: 100 // Small size for testing
		});
		
		// Add a bunch of messages
		for (let i = 0; i < 20; i++) {
			const message: AIMessage = {
				role: 'user',
				content: [{ type: 'text', value: `Message ${i}` }]
			};
			contextService.addMessage(message);
		}
		
		// Create a mock provider
		const provider: IAIProvider = {
			info: {
				id: 'test',
				name: 'Test Provider',
				type: AIProviderType.Custom,
				availableModels: [{
					id: 'test-model',
					name: 'Test Model',
					capabilities: {
						supportsImages: false,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 200,
					maxResponseTokens: 50,
					pricingTier: 'free'
				}],
				iconPath: 'test-icon',
				isEnabled: true,
				authStatus: 'authenticated'
			},
			onDidChangeStatus: new Emitter<void>().event,
			initialize: async () => {},
			sendRequest: async () => ({
				stream: (async function* () {})(),
				result: Promise.resolve()
			}),
			countTokens: async () => 10,
			dispose: () => {}
		};
		
		// Register provider settings
		contextService.registerProviderSettings(provider);
		
		// Get messages for the provider
		const messages = contextService.getMessagesForProvider(provider);
		
		// Should have truncated the context to fit within the size limit
		assert.ok(messages.length < 20, 'Should have fewer than 20 messages due to context limit');
		
		// The most recent messages should be preserved
		const lastMessage = messages[messages.length - 1];
		assert.strictEqual(lastMessage.content[0].value, 'Message 19', 'Should have preserved the most recent message');
	});

	test('Context export and import should preserve state', () => {
		// Add some messages
		for (let i = 0; i < 5; i++) {
			const message: AIMessage = {
				role: i % 2 === 0 ? 'user' : 'assistant',
				content: [{ type: 'text', value: `Message ${i}` }]
			};
			contextService.addMessage(message, `provider${i % 3 + 1}`, [`tag${i}`]);
		}
		
		// Export the context
		const exported = contextService.exportContext();
		
		// Create a new context service
		const newContextService = new ContextManagementService(configService, logService);
		
		// Import the context
		newContextService.importContext(exported);
		
		// Create a mock provider
		const provider: IAIProvider = {
			info: {
				id: 'test',
				name: 'Test Provider',
				type: AIProviderType.Custom,
				availableModels: [{
					id: 'test-model',
					name: 'Test Model',
					capabilities: {
						supportsImages: false,
						supportsToolCalling: false,
						supportsStreaming: true
					},
					maxContextLength: 10000,
					maxResponseTokens: 2000,
					pricingTier: 'free'
				}],
				iconPath: 'test-icon',
				isEnabled: true,
				authStatus: 'authenticated'
			},
			onDidChangeStatus: new Emitter<void>().event,
			initialize: async () => {},
			sendRequest: async () => ({
				stream: (async function* () {})(),
				result: Promise.resolve()
			}),
			countTokens: async () => 10,
			dispose: () => {}
		};
		
		// Register provider settings
		newContextService.registerProviderSettings(provider);
		
		// Get messages for the provider
		const messages = newContextService.getMessagesForProvider(provider);
		
		// Should have the same number of messages
		assert.strictEqual(messages.length, 5, 'Should have imported 5 messages');
	});
});