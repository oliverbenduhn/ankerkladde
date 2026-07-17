import { createActionUtils } from './items-actions-utils.js?v=5.1.14';
import { createShareActions } from './items-actions-share.js?v=5.1.14';
import { createUploadActions } from './items-actions-upload.js?v=5.1.14';
import { createAddActions } from './items-actions-add.js?v=5.1.14';
import { createUpdateActions } from './items-actions-update.js?v=5.1.14';

export function createItemsActionsController(deps) {
    const utils = createActionUtils(deps);
    const extendedDeps = { ...deps, ...utils };

    const shareActions = createShareActions(extendedDeps);
    
    // uploadActions is needed by addActions
    const uploadActions = createUploadActions(extendedDeps);
    const depsWithUpload = { ...extendedDeps, ...uploadActions };
    
    const addActions = createAddActions(depsWithUpload);
    const updateActions = createUpdateActions(extendedDeps);

    return {
        ...shareActions,
        ...uploadActions,
        ...addActions,
        ...updateActions,
    };
}
