import { createActionUtils } from './items-actions-utils.js';
import { createShareActions } from './items-actions-share.js';
import { createUploadActions } from './items-actions-upload.js';
import { createAddActions } from './items-actions-add.js';
import { createUpdateActions } from './items-actions-update.js';

export function createItemsActionsController(deps) {
    const utils = createActionUtils(deps);
    const extendedDeps = { ...deps, ...utils };

    const shareActions = createShareActions(extendedDeps);
    
    // uploadActions is needed by addActions
    const uploadActions = createUploadActions(extendedDeps);
    const depsWithUpload = { ...extendedDeps, ...uploadActions };
    
    const addActions = createAddActions(depsWithUpload);
    const updateActions = createUpdateActions(depsWithUpload);

    return {
        ...shareActions,
        ...uploadActions,
        ...addActions,
        ...updateActions,
    };
}
