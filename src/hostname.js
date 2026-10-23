// True when the page is open on the server itself, where the address bar says nothing another device could use.
export const isLocalHostname = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
