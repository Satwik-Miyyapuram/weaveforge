// Error reporting is off in the workshop: these calls do nothing.
type Hook = (...args: any[]) => any
export function init(_options: { beforeSend?: Hook; [key: string]: any }) {}
export function setUser(_user: any) {}
export function setTag(_name: string, _value: any) {}
export function captureException(_error: any, _context?: any) {}
export function captureMessage(_message: string, _context?: any) {}
