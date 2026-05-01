import { registerLayoutEvents } from './app-events-layout.js?v=4.3.11';
import { registerFormsEvents } from './app-events-forms.js?v=4.3.11';
import { registerToolsEvents } from './app-events-tools.js?v=4.3.11';
import { registerSystemEvents } from './app-events-system.js?v=4.3.11';

export function registerAppEventHandlers(deps) {
    // Add scannerState explicitly if not passed
    if (!deps.scannerState) {
        import('./state.js?v=4.3.4').then(({ scannerState }) => {
            deps.scannerState = scannerState;
        });
    }

    registerLayoutEvents(deps);
    registerFormsEvents(deps);
    registerToolsEvents(deps);
    registerSystemEvents(deps);
}
