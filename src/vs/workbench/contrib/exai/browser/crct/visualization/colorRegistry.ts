/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerColor, transparent } from 'vs/platform/theme/common/colorRegistry';
import { Color } from 'vs/base/common/color';
import { localize } from 'vs/nls';

// Base colors
export const crctNodeBaseColor = registerColor('crct.nodeBaseColor', { dark: '#6C6C6C', light: '#888888', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.nodeBaseColor', "Base color for graph nodes"));
export const crctEdgeBaseColor = registerColor('crct.edgeBaseColor', { dark: '#4D4D4D', light: '#AAAAAA', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.edgeBaseColor', "Base color for graph edges"));
export const crctSelectedNodeColor = registerColor('crct.selectedNodeColor', { dark: '#FFCC00', light: '#FF9900', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.selectedNodeColor', "Color for selected graph nodes"));
export const crctHoveredNodeColor = registerColor('crct.hoveredNodeColor', { dark: '#88CCEE', light: '#44AADD', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.hoveredNodeColor', "Color for hovered graph nodes"));

// Node colors by type and tier
export const crctFileNodeTier1 = registerColor('crct.fileNodeTier1', { dark: '#4EB1CB', light: '#3990AB', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.fileNodeTier1', "Color for tier 1 file nodes"));
export const crctFileNodeTier2 = registerColor('crct.fileNodeTier2', { dark: '#44A3BC', light: '#348093', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.fileNodeTier2', "Color for tier 2 file nodes"));
export const crctFileNodeTier3 = registerColor('crct.fileNodeTier3', { dark: '#3A95AD', light: '#30707E', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.fileNodeTier3', "Color for tier 3 file nodes"));
export const crctFileNodeTier4 = registerColor('crct.fileNodeTier4', { dark: '#30879E', light: '#2C616C', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.fileNodeTier4', "Color for tier 4 file nodes"));
export const crctFileNodeTier5 = registerColor('crct.fileNodeTier5', { dark: '#26798F', light: '#28525A', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.fileNodeTier5', "Color for tier 5 file nodes"));

export const crctDirectoryNodeTier1 = registerColor('crct.directoryNodeTier1', { dark: '#D07348', light: '#C06338', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.directoryNodeTier1', "Color for tier 1 directory nodes"));
export const crctDirectoryNodeTier2 = registerColor('crct.directoryNodeTier2', { dark: '#C16941', light: '#B35931', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.directoryNodeTier2', "Color for tier 2 directory nodes"));
export const crctDirectoryNodeTier3 = registerColor('crct.directoryNodeTier3', { dark: '#B35F3A', light: '#A6502A', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.directoryNodeTier3', "Color for tier 3 directory nodes"));
export const crctDirectoryNodeTier4 = registerColor('crct.directoryNodeTier4', { dark: '#A55533', light: '#994723', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.directoryNodeTier4', "Color for tier 4 directory nodes"));
export const crctDirectoryNodeTier5 = registerColor('crct.directoryNodeTier5', { dark: '#974B2C', light: '#8C3E1D', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.directoryNodeTier5', "Color for tier 5 directory nodes"));

export const crctGroupNode = registerColor('crct.groupNode', { dark: '#8080FF', light: '#6060DD', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.groupNode', "Color for group nodes"));
export const crctVirtualNode = registerColor('crct.virtualNode', { dark: '#808080', light: '#A0A0A0', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.virtualNode', "Color for virtual nodes"));

// Edge colors by dependency type
export const crctImportEdge = registerColor('crct.importEdge', { dark: '#7CCC7C', light: '#5DAD5D', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.importEdge', "Color for import dependency edges"));
export const crctReferenceEdge = registerColor('crct.referenceEdge', { dark: '#88AADD', light: '#6688BB', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.referenceEdge', "Color for reference dependency edges"));
export const crctExtendsEdge = registerColor('crct.extendsEdge', { dark: '#CCAA44', light: '#AA8822', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.extendsEdge', "Color for extends dependency edges"));
export const crctImplementsEdge = registerColor('crct.implementsEdge', { dark: '#DD88CC', light: '#BB66AA', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.implementsEdge', "Color for implements dependency edges"));
export const crctTypeDependencyEdge = registerColor('crct.typeDependencyEdge', { dark: '#CC77AA', light: '#AA5588', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.typeDependencyEdge', "Color for type dependency edges"));
export const crctFileInclusionEdge = registerColor('crct.fileInclusionEdge', { dark: '#DD9966', light: '#BB7744', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.fileInclusionEdge', "Color for file inclusion edges"));
export const crctPackageDependencyEdge = registerColor('crct.packageDependencyEdge', { dark: '#99CC66', light: '#77AA44', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.packageDependencyEdge', "Color for package dependency edges"));
export const crctApiCallEdge = registerColor('crct.apiCallEdge', { dark: '#66CCCC', light: '#44AAAA', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.apiCallEdge', "Color for API call edges"));
export const crctEventEmitterEdge = registerColor('crct.eventEmitterEdge', { dark: '#CCCC66', light: '#AAAA44', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.eventEmitterEdge', "Color for event emitter edges"));
export const crctEventHandlerEdge = registerColor('crct.eventHandlerEdge', { dark: '#CC66CC', light: '#AA44AA', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.eventHandlerEdge', "Color for event handler edges"));

// Edge colors by edge type
export const crctDirectEdge = registerColor('crct.directEdge', { dark: '#88AA88', light: '#668866', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.directEdge', "Color for direct dependency edges"));
export const crctIndirectEdge = registerColor('crct.indirectEdge', { dark: '#AAAAAA', light: '#888888', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.indirectEdge', "Color for indirect dependency edges"));
export const crctBidirectionalEdge = registerColor('crct.bidirectionalEdge', { dark: '#DD8888', light: '#BB6666', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.bidirectionalEdge', "Color for bidirectional dependency edges"));
export const crctVirtualEdge = registerColor('crct.virtualEdge', { dark: '#888888', light: '#666666', hcDark: '#FFFFFF', hcLight: '#000000' }, localize('crct.virtualEdge', "Color for virtual edges"));