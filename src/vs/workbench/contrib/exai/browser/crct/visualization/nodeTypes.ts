/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DependencyType } from 'vs/workbench/contrib/exai/common/crct/types';
import { ThemeColor } from 'vs/platform/theme/common/themeService';

// Node types for the dependency graph
export enum NodeType {
    File,
    Directory,
    Group,
    Virtual
}

// Edge types for the dependency graph
export enum EdgeType {
    Direct,
    Indirect,
    Bidirectional,
    Virtual
}

// Node colors by type and tier
export const nodeColors = {
    [NodeType.File]: {
        1: new ThemeColor('crct.fileNodeTier1'),
        2: new ThemeColor('crct.fileNodeTier2'),
        3: new ThemeColor('crct.fileNodeTier3'),
        4: new ThemeColor('crct.fileNodeTier4'),
        5: new ThemeColor('crct.fileNodeTier5')
    },
    [NodeType.Directory]: {
        1: new ThemeColor('crct.directoryNodeTier1'),
        2: new ThemeColor('crct.directoryNodeTier2'),
        3: new ThemeColor('crct.directoryNodeTier3'),
        4: new ThemeColor('crct.directoryNodeTier4'),
        5: new ThemeColor('crct.directoryNodeTier5')
    },
    [NodeType.Group]: new ThemeColor('crct.groupNode'),
    [NodeType.Virtual]: new ThemeColor('crct.virtualNode')
};

// Edge colors by dependency type
export const edgeColors = {
    [DependencyType.Import]: new ThemeColor('crct.importEdge'),
    [DependencyType.Reference]: new ThemeColor('crct.referenceEdge'),
    [DependencyType.Extends]: new ThemeColor('crct.extendsEdge'),
    [DependencyType.Implements]: new ThemeColor('crct.implementsEdge'),
    [DependencyType.TypeDependency]: new ThemeColor('crct.typeDependencyEdge'),
    [DependencyType.FileInclusion]: new ThemeColor('crct.fileInclusionEdge'),
    [DependencyType.PackageDependency]: new ThemeColor('crct.packageDependencyEdge'),
    [DependencyType.ApiCall]: new ThemeColor('crct.apiCallEdge'),
    [DependencyType.EventEmitter]: new ThemeColor('crct.eventEmitterEdge'),
    [DependencyType.EventHandler]: new ThemeColor('crct.eventHandlerEdge'),
    
    // Edge types
    [EdgeType.Direct]: new ThemeColor('crct.directEdge'),
    [EdgeType.Indirect]: new ThemeColor('crct.indirectEdge'),
    [EdgeType.Bidirectional]: new ThemeColor('crct.bidirectionalEdge'),
    [EdgeType.Virtual]: new ThemeColor('crct.virtualEdge')
};

// Icons by node type
export const nodeIcons = {
    [NodeType.File]: 'codicon-file',
    [NodeType.Directory]: 'codicon-folder',
    [NodeType.Group]: 'codicon-group-by-ref-type',
    [NodeType.Virtual]: 'codicon-symbol-misc'
};

// Icons by dependency type
export const dependencyIcons = {
    [DependencyType.Import]: 'codicon-symbol-module',
    [DependencyType.Reference]: 'codicon-references',
    [DependencyType.Extends]: 'codicon-symbol-class',
    [DependencyType.Implements]: 'codicon-symbol-interface',
    [DependencyType.TypeDependency]: 'codicon-symbol-type-parameter',
    [DependencyType.FileInclusion]: 'codicon-file-submodule',
    [DependencyType.PackageDependency]: 'codicon-package',
    [DependencyType.ApiCall]: 'codicon-call-incoming',
    [DependencyType.EventEmitter]: 'codicon-broadcast',
    [DependencyType.EventHandler]: 'codicon-feedback'
};