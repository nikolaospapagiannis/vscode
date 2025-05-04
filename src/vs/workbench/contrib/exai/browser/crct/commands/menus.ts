/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import * as CommandConstants from './commandConstants';

export function registerCRCTMenus(): void {
    // Register commands in the command palette
    MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
        command: {
            id: CommandConstants.ANALYZE_WORKSPACE_COMMAND_ID,
            title: {
                value: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.ANALYZE_WORKSPACE_COMMAND_TITLE}`,
                original: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.ANALYZE_WORKSPACE_COMMAND_TITLE}`
            },
            category: CommandConstants.CRCT_COMMAND_CATEGORY
        }
    });

    MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
        command: {
            id: CommandConstants.GENERATE_KEYS_COMMAND_ID,
            title: {
                value: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.GENERATE_KEYS_COMMAND_TITLE}`,
                original: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.GENERATE_KEYS_COMMAND_TITLE}`
            },
            category: CommandConstants.CRCT_COMMAND_CATEGORY
        }
    });

    MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
        command: {
            id: CommandConstants.UPDATE_DEPENDENCY_GRID_COMMAND_ID,
            title: {
                value: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.UPDATE_DEPENDENCY_GRID_COMMAND_TITLE}`,
                original: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.UPDATE_DEPENDENCY_GRID_COMMAND_TITLE}`
            },
            category: CommandConstants.CRCT_COMMAND_CATEGORY
        }
    });

    MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
        command: {
            id: CommandConstants.SHOW_DEPENDENCY_GRAPH_COMMAND_ID,
            title: {
                value: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.SHOW_DEPENDENCY_GRAPH_COMMAND_TITLE}`,
                original: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.SHOW_DEPENDENCY_GRAPH_COMMAND_TITLE}`
            },
            category: CommandConstants.CRCT_COMMAND_CATEGORY
        }
    });

    MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
        command: {
            id: CommandConstants.CONFIGURE_SETTINGS_COMMAND_ID,
            title: {
                value: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.CONFIGURE_SETTINGS_COMMAND_TITLE}`,
                original: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.CONFIGURE_SETTINGS_COMMAND_TITLE}`
            },
            category: CommandConstants.CRCT_COMMAND_CATEGORY
        }
    });

    MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
        command: {
            id: CommandConstants.MANAGE_TRACKERS_COMMAND_ID,
            title: {
                value: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.MANAGE_TRACKERS_COMMAND_TITLE}`,
                original: `${CommandConstants.CRCT_COMMAND_CATEGORY}: ${CommandConstants.MANAGE_TRACKERS_COMMAND_TITLE}`
            },
            category: CommandConstants.CRCT_COMMAND_CATEGORY
        }
    });

    // Register commands in the explorer context menu
    MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
        group: '9_crct',
        order: 1,
        command: {
            id: CommandConstants.VIEW_FILE_DEPENDENCIES_COMMAND_ID,
            title: localize('viewDependencies', "CRCT: View Dependencies")
        }
    });

    MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
        group: '9_crct',
        order: 2,
        command: {
            id: CommandConstants.GENERATE_MINI_TRACKER_COMMAND_ID,
            title: localize('generateMiniTracker', "CRCT: Generate Mini-Tracker")
        },
        when: 'explorerResourceIsFolder'
    });

    MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
        group: '9_crct',
        order: 3,
        command: {
            id: CommandConstants.EXCLUDE_FROM_TRACKING_COMMAND_ID,
            title: localize('excludeFromTracking', "CRCT: Exclude from Dependency Tracking")
        }
    });

    MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
        group: '9_crct',
        order: 4,
        command: {
            id: CommandConstants.INCLUDE_IN_TRACKING_COMMAND_ID,
            title: localize('includeInTracking', "CRCT: Include in Dependency Tracking")
        }
    });

    // Register commands in the editor context menu
    MenuRegistry.appendMenuItem(MenuId.EditorContext, {
        group: 'crct',
        order: 1,
        command: {
            id: CommandConstants.VIEW_FILE_DEPENDENCIES_COMMAND_ID,
            title: localize('showDependencies', "CRCT: Show Dependencies for Current File")
        }
    });

    MenuRegistry.appendMenuItem(MenuId.EditorContext, {
        group: 'crct',
        order: 2,
        command: {
            id: CommandConstants.ADD_TO_ACTIVE_CONTEXT_COMMAND_ID,
            title: localize('addToContext', "CRCT: Add to Active Context")
        }
    });

    MenuRegistry.appendMenuItem(MenuId.EditorContext, {
        group: 'crct',
        order: 3,
        command: {
            id: CommandConstants.GENERATE_KEY_FOR_FILE_COMMAND_ID,
            title: localize('generateKey', "CRCT: Generate Key for File")
        }
    });

    // Register commands in the editor title menu
    MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
        group: 'navigation',
        order: 100,
        command: {
            id: CommandConstants.VIEW_FILE_DEPENDENCIES_COMMAND_ID,
            title: localize('viewDependenciesIcon', "$(references) View Dependencies"),
            iconLocation: {
                dark: 'resources/icons/dark/dependency-graph.svg',
                light: 'resources/icons/light/dependency-graph.svg'
            }
        }
    });
}