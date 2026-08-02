import { EventEmitter } from 'events';

// Global singleton for chat events
const chatEmitter = new EventEmitter();

// Increase limit if many admins are connected
chatEmitter.setMaxListeners(100);

export { chatEmitter };
