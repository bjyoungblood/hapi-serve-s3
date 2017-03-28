const Joi = require('joi');

const Schemas = require('./schemas');
const Serve = require('./serve');
const Pkg = require('../package.json');

const internals = {};


/**
 * Handler Lookup based on `route.method`
 */
internals.handlers = {
  get: Serve.handler
};


/**
 * s3 meta-handler definition
 */
internals.handler = function (route, routeOptions) {

  const handler = internals.handlers[route.method];

  if (!handler) {
    throw new Error(`s3 handler currently only supports: ${Object.keys(internals.allowedMethods)}`);
  }

  const valid = Joi.attempt(routeOptions, Schemas.routeOptionsSchema);

  route.settings.plugins.s3 = valid;
  route.settings.plugins.s3.getMode = Schemas.getMode;

  return internals.handlers[route.method];
};


internals.handler.defaults = (method) => {
  return internals.handlers[method].defaults;
};


/**
 * plugin definition
 */
const register = module.exports = function (server, options, next) {

  server.handler('s3', internals.handler);
  next();
};


register.attributes = {
  name: Pkg.name,
  version: Pkg.version,
  multiple: false
};
