// Core Module - Test fixture
export const name = 'core';
export const version = '1.0.0';

export class CoreService {
  constructor() {
    this.initialized = false;
  }

  initialize() {
    this.initialized = true;
    console.log('[Core] Initialized');
  }

  getMessage() {
    return 'Hello from Core!';
  }
}

// Lifecycle hooks
export function activate(context) {
  console.log('[Core] Activating...');
  const service = new CoreService();
  service.initialize();
  context.services.register('core.service', service);
  console.log('[Core] Activated');
}

export function deactivate(context) {
  console.log('[Core] Deactivating...');
  context.services.unregister('core.service');
  console.log('[Core] Deactivated');
}

export default {
  name,
  version,
  CoreService,
  activate,
  deactivate
};