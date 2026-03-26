// Logger Module
export const name = 'logger';
export const version = '1.0.0';

export class LoggerService {
  constructor() {
    this.logs = [];
  }

  log(level, message, ...args) {
    const entry = { level, message, args, timestamp: new Date().toISOString() };
    this.logs.push(entry);
    console[level]?.(`[Logger] ${message}`, ...args);
    return entry;
  }

  info(message, ...args) { return this.log('info', message, ...args); }
  warn(message, ...args) { return this.log('warn', message, ...args); }
  error(message, ...args) { return this.log('error', message, ...args); }
  debug(message, ...args) { return this.log('debug', message, ...args); }

  getHistory() { return [...this.logs]; }
  clear() { this.logs = []; }
}

export function activate(context) {
  console.log('[Logger] Activating...');
  const logger = new LoggerService();
  context.services.register('logger.service', logger);
  console.log('[Logger] Activated');
}

export function deactivate(context) {
  console.log('[Logger] Deactivating...');
  context.services.unregister('logger.service');
  console.log('[Logger] Deactivated');
}

export default { name, version, LoggerService, activate, deactivate };
