# Multi-Provider Framework for ExAI

## Overview

The Multi-Provider Framework is a core component of the ExAI system that enables seamless integration with multiple AI providers, including OpenAI, Anthropic Claude, and Perplexity. The framework provides a unified interface for interacting with different AI models while abstracting away the complexities of provider-specific APIs.

This document describes the architecture, components, and usage of the Multi-Provider Framework.

## Architecture

The Multi-Provider Framework follows a layered architecture:

```
┌───────────────────────────────────────────────────┐
│                VS Code Extension                  │
└───────────────┬───────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────┐
│            Multi-Provider Service                 │
│  ┌─────────────────────┐  ┌────────────────────┐  │
│  │ Provider Management │  │ Context Management │  │
│  └─────────────────────┘  └────────────────────┘  │
└───────────────┬───────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────┐
│            Provider Adapters                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  OpenAI  │  │  Claude  │  │  Perplexity      │ │
│  └──────────┘  └──────────┘  └──────────────────┘ │
└───────────────┬───────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────┐
│            AI Provider APIs                       │
└───────────────────────────────────────────────────┘
```

### Key Components

1. **Multi-Provider Service**
   - Entry point for all AI interactions
   - Manages provider selection and fallback strategies
   - Coordinates cross-provider context preservation

2. **Provider Management**
   - Handles provider registration and initialization
   - Implements provider selection strategies
   - Manages provider lifecycles

3. **Context Management**
   - Preserves conversation context across providers
   - Optimizes context to fit within provider constraints
   - Implements context truncation strategies

4. **Provider Adapters**
   - Translates between unified interface and provider-specific APIs
   - Handles provider-specific authentication and configuration
   - Normalizes response formats

5. **Core Providers**
   - OpenAI Provider
   - Claude Provider
   - Perplexity Provider

## Provider Selection Strategies

The framework supports multiple strategies for selecting which provider to use for a given request:

1. **First Available**: Uses the first available provider that meets the criteria
2. **Round Robin**: Rotates through all available providers to balance load
3. **Lowest Latency**: Selects the provider with the lowest average response time
4. **Random**: Randomly selects among available providers
5. **Cost-Based**: Selects the provider with the lowest estimated cost
6. **Capability-Based**: Selects the provider that best matches the required capabilities

## Error Handling Strategies

When a provider request fails, the framework can handle the error in different ways:

1. **Fail**: Returns the error from the failed provider
2. **Fallback**: Tries to use a fallback provider if available
3. **Retry**: Retries with the same provider

## Context Management Strategies

The framework includes sophisticated context management to preserve conversation history:

1. **Adaptive**: Adapts context size based on the provider's capabilities
2. **Fixed Size**: Uses a fixed context size for all providers
3. **Sliding Window**: Uses a sliding window approach for context management

## Provider Capabilities

Each provider exposes its capabilities through a standardized interface:

- **Model Information**: Available models and their capabilities
- **Authentication Status**: Current authentication state
- **Context Window Size**: Maximum context size in tokens
- **Response Limits**: Maximum response size in tokens
- **Special Capabilities**: Support for images, function calling, etc.

## Integration with VS Code

The Multi-Provider Framework integrates with VS Code through:

1. **Configuration**: User settings for provider configuration
2. **Commands**: VS Code commands for interacting with the framework
3. **Events**: Events for tracking provider status and request progress
4. **UI Components**: UI components for provider management

## Configuration

Users can configure the Multi-Provider Framework through VS Code settings:

```json
"exai.multiProvider.enable": true,
"exai.multiProvider.selectionStrategy": "capabilityBased",
"exai.multiProvider.errorHandlingStrategy": "fallback",
"exai.multiProvider.defaultProvider": "auto",
"exai.multiProvider.providers.openai": {
    "enabled": true,
    "baseUrl": "https://api.openai.com/v1",
    "defaultModel": "gpt-4-turbo"
},
"exai.multiProvider.providers.claude": {
    "enabled": true,
    "baseUrl": "https://api.anthropic.com",
    "defaultModel": "claude-3-sonnet"
},
"exai.multiProvider.providers.perplexity": {
    "enabled": true,
    "baseUrl": "https://api.perplexity.ai",
    "defaultModel": "pplx-70b-online"
}
```

API keys are stored securely using VS Code's secret storage:

```typescript
// Store API key securely
await secretStorageService.store(`exai.apiKey.${providerId}`, apiKey);

// Retrieve API key
const apiKey = await secretStorageService.get(`exai.apiKey.${providerId}`);
```

## Usage Examples

### Sending a Request

```typescript
// Get the multi-provider service
const multiProviderService = this.instantiationService.get(IMultiProviderService);

// Create a message
const message: AIMessage = {
    role: 'user',
    content: [{ type: 'text', value: 'What is the capital of France?' }]
};

// Send the request
const response = await multiProviderService.sendRequest([message], {
    model: 'gpt-4',
    temperature: 0.7
});

// Process the response
for await (const fragment of response.stream) {
    if (fragment.part.type === 'text') {
        console.log(fragment.part.value);
    }
}

// Wait for completion
await response.result;
```

### Using Capability-Based Selection

```typescript
// Create a message with an image
const imageMessage: AIMessage = {
    role: 'user',
    content: [
        { type: 'text', value: 'Describe this image' },
        { 
            type: 'image', 
            value: {
                uri: URI.file('/path/to/image.jpg'),
                mimeType: 'image/jpeg',
                data: imageBuffer
            }
        }
    ]
};

// Create provider selection criteria
const selector: AIProviderSelector = {
    requiredCapabilities: { supportsImages: true }
};

// Send the request - will automatically choose a provider that supports images
const response = await multiProviderService.sendRequest([imageMessage], {}, selector);
```

### Adding a Custom Provider

```typescript
// Create a custom provider
class MyCustomProvider extends BaseAIProvider {
    // Implement provider interface...
}

// Register the provider
const provider = new MyCustomProvider();
multiProviderService.registerProvider(provider);

// Initialize the provider
await provider.initialize({
    type: AIProviderType.Custom,
    apiKey: 'my-api-key'
});
```

## Testing

The Multi-Provider Framework includes comprehensive tests:

1. **Unit Tests**: Tests for individual components
2. **Integration Tests**: Tests for component interactions
3. **End-to-End Tests**: Tests for complete workflows

Example test:

```typescript
test('Fallback error handling strategy should try another provider on failure', async () => {
    // Set the error handling strategy to Fallback
    configService.setMultiProviderConfig({
        errorHandlingStrategy: ProviderErrorHandlingStrategy.Fallback
    });
    
    // Make the first provider always fail
    provider1.setSuccessRate(0);
    
    // Track which providers receive requests
    const usedProviders = [];
    provider1.onDidRequest(() => usedProviders.push('provider1'));
    provider2.onDidRequest(() => usedProviders.push('provider2'));
    
    // Make a request - should try provider1, fail, then try provider2
    await controller.sendRequest([message]);
    
    // Should have tried both providers
    assert.deepStrictEqual(usedProviders, ['provider1', 'provider2']);
});
```

## Future Enhancements

Planned future enhancements include:

1. **Enhanced Cost Tracking**: More accurate cost estimation and tracking
2. **Performance Analytics**: Dashboard for monitoring provider performance
3. **Model Caching**: Caching model outputs for improved performance
4. **Custom Provider SDK**: SDK for creating custom providers
5. **Dynamic Provider Discovery**: Automatic discovery of new providers

## Conclusion

The Multi-Provider Framework provides a robust, flexible foundation for integrating multiple AI providers into the ExAI system. By abstracting away provider-specific details and providing sophisticated selection, fallback, and context management capabilities, it ensures that users can always access the best AI capabilities for their needs.