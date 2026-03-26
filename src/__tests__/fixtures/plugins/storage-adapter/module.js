// Storage Adapter Module - Test fixture
export const name = 'storage-adapter';
export const version = '2.0.0';

export class StorageAdapter {
  constructor(coreService) {
    this.coreService = coreService;
    this.data = new Map();
  }

  save(key, value) {
    this.data.set(key, value);
    console.log(`[StorageAdapter] Saved: ${key}`);
    return true;
  }

  load(key) {
    return this.data.get(key);
  }

  getCoreMessage() {
    return this.coreService?.getMessage() ?? 'Core not available';
  }
}

// Lifecycle hooks
export function activate(context) {
  console.log('[StorageAdapter] Activating...');

  // Get core service dependency
  const coreService = context.services.get('core.service');
  if (!coreService) {
    console.warn('[StorageAdapter] Core service not found!');
  }

  const adapter = new StorageAdapter(coreService);
  context.services.register('storage.adapter', adapter);

  console.log('[StorageAdapter] Activated');
}

export function deactivate(context) {
  console.log('[StorageAdapter] Deactivating...');
  context.services.unregister('storage.adapter');
  console.log('[StorageAdapter] Deactivated');
}

export default {
  name,
  version,
  StorageAdapter,
  activate,
  deactivate
};