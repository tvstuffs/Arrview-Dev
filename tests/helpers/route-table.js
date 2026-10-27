// Walks an Express 4 app's router stack and lists every route and middleware layer, recursing into mounted routers.
// Nothing is listed by hand: a route added to server.js later shows up here.

// The mount prefix of a layer, decoded from Express 4's `^\/prefix\/?(?=\/|$)` regexp source.
function decodePrefix(layer) {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const match = /^\^(.*)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
  if (!match) throw new Error(`cannot decode the mount prefix of layer "${layer.name}": ${layer.regexp.source}`);
  const body = match[1].replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, '1').replace(/\\\//g, '/');
  if (/[\\^$*+?()[\]{}|]/.test(body)) throw new Error(`cannot decode the mount prefix of layer "${layer.name}": ${layer.regexp.source}`);
  return body;
}

function walkStack(stack, prefix = '', top = null, out = []) {
  stack.forEach((layer, index) => {
    const topIndex = top === null ? index : top;
    if (layer.route) {
      const route = layer.route;
      if (typeof route.path !== 'string') throw new Error(`route with a non-string path: ${String(route.path)}`);
      const methods = Object.keys(route.methods).filter(m => m !== '_all' && route.methods[m]);
      if (!methods.length) throw new Error(`route ${route.path} has no methods`);
      for (const method of methods) {
        out.push({ kind: 'route', method: method.toUpperCase(), template: prefix + route.path,
          path: (prefix + route.path).replace(/:[A-Za-z]+/g, '1'), topIndex });
      }
    } else if (layer.name === 'router' || (layer.handle && layer.handle.stack)) {
      walkStack(layer.handle.stack, prefix + decodePrefix(layer), topIndex, out);
    } else {
      out.push({ kind: 'middleware', name: layer.name, handle: layer.handle.name, prefix: decodePrefix(layer), index, topIndex });
    }
  });
  return out;
}

const routeTable = app => walkStack(app._router.stack);

module.exports = { walkStack, routeTable, decodePrefix };
