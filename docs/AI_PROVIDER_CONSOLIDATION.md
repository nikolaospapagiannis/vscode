# AI Provider Implementation Consolidation Plan

## Overview

The ExAI project currently has two separate AI provider implementations:

1. **Enhanced Implementation** (`/common/aiProviders/`) - The current standard implementation with advanced features such as streaming responses, provider selection strategies, and robust VS Code integration.

2. **Legacy Implementation** (`/common/ai/`) - An earlier, simpler implementation that should be phased out.

This document outlines the plan to consolidate on the enhanced implementation to eliminate duplication, reduce maintenance burden, and ensure consistent behavior across the codebase.

## Current State

- Both implementations exist in parallel in the codebase
- The enhanced implementation (`/common/aiProviders/`) is more sophisticated with event handling, cancellation tokens, streaming responses, and better VS Code integration
- Documentation has been updated to recommend using the enhanced implementation for all new development
- Some existing code may still reference the legacy implementation

## Consolidation Tasks

### Phase 1: Documentation and Standards

- [x] Update `MULTI_PROVIDER_FRAMEWORK.md` to document the standard implementation
- [x] Update `SYSTEM_ARCHITECTURE.md` to reference the correct implementation
- [x] Update `CRCT_IMPLEMENTATION.md` to reference the standard implementation
- [x] Update `IMPLEMENTATION_CHECKLIST.md` to reflect the current status
- [x] Create this consolidation plan document

### Phase 2: Code Refactoring

- [ ] Identify all service registrations and usages of the legacy implementation
- [ ] Create adapter classes or functions to help with migration if needed
- [ ] Update import statements in all files to use the enhanced implementation
- [ ] Update service initialization code to use the enhanced implementation
- [ ] Update AI-dependent features to work with the enhanced implementation

### Phase 3: Testing and Validation

- [ ] Create tests to verify all functionality works with the enhanced implementation
- [ ] Ensure all AI provider configurations work correctly
- [ ] Validate that provider switching and fallback mechanisms work as expected
- [ ] Verify streaming responses and cancellation handling
- [ ] Test error handling and recovery mechanisms

### Phase 4: Removal of Legacy Implementation

- [ ] Deprecate all legacy implementation classes and interfaces
- [ ] Add deprecation warnings to all legacy implementation files
- [ ] Gradually remove references to the legacy implementation
- [ ] Remove the legacy implementation entirely

## Migration Guide for Developers

When migrating from the legacy implementation to the enhanced implementation, follow these guidelines:

### Import Statements

**Legacy Implementation:**
```typescript
import { AIProvider } from '../common/ai/providerInterface';
import { AIProviderService } from '../common/ai/providerService';
```

**Enhanced Implementation:**
```typescript
import { IAIProvider } from '../common/aiProviders/types';
import { IMultiProviderService } from '../common/aiProviders/multiProviderService';
```

### Service Registration

**Legacy Implementation:**
```typescript
registerSingleton(IAIProviderService, AIProviderService, true);
```

**Enhanced Implementation:**
```typescript
// The enhanced implementation is already registered as a singleton through the EnhancedAIProviderServiceImpl
```

### Request Handling

**Legacy Implementation:**
```typescript
const result = await aiProviderService.generateCompletion(prompt, options);
```

**Enhanced Implementation:**
```typescript
const message = { role: 'user', content: [{ type: 'text', value: prompt }] };
const response = await multiProviderService.sendRequest([message], options);

for await (const fragment of response.stream) {
    if (fragment.part.type === 'text') {
        // Process text fragment
    }
}

// Wait for completion
await response.result;
```

### Provider Selection

**Legacy Implementation:**
```typescript
const provider = aiProviderService.getBestProviderForTask('completion');
```

**Enhanced Implementation:**
```typescript
const selector = {
    requiredCapabilities: { supportsStreaming: true }
};
const providers = await multiProviderService.selectProviders(selector);
```

## Timeline

- **Phase 1 (Documentation)**: Completed
- **Phase 2 (Code Refactoring)**: Q3 2024
- **Phase 3 (Testing)**: Q3 2024
- **Phase 4 (Removal)**: Q4 2024

## Conclusion

Standardizing on the enhanced implementation will improve code quality, reduce duplication, and ensure consistent behavior across the ExAI project. This consolidation plan provides a clear path forward for unifying the AI provider infrastructure and simplifying future development and maintenance.